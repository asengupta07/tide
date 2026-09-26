/**
 * World ID for Agents (official dev environment, https://sandbox.auth.world.org): OpenID Connect with
 * pairwise subjects and RFC 9470 step-up. Two flows share this module:
 *
 *   bind     the owner signs in once; we store (issuer, sub) as the human bound to manager.tide.eth
 *   step-up  before every protected write the backend asks for FRESH authentication
 *            (prompt=login, max_age=0) and only accepts an ID token whose
 *              - signature verifies against the issuer's JWKS (RS256)
 *              - iss / aud / nonce match the request we made
 *              - auth_time is not older than the step-up request (the human really authenticated now)
 *              - sub equals the bound owner (pairwise, so it cannot be replayed from another app)
 *            Anything else is a denied path and the protected action does not happen.
 *
 * The client secret only ever lives in this server-side module.
 */
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  device_authorization_endpoint?: string;
};

export type AuthRequest = {
  purpose: "bind" | "stepup";
  proposalId?: string;
  /** wallet being bound (bind) or whose binding must match (stepup) */
  owner?: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  requestedAt: number; // unix seconds
};

export type VerifiedIdentity = {
  issuer: string;
  subject: string;
  authTime: number;
  issuedAt: number;
  acr?: string;
};

export class WorldAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new WorldAuthError("config", `missing env ${k}`);
  return v;
};

export const worldConfig = () => ({
  issuer: env("WORLD_ISSUER", "https://sandbox.auth.world.org"),
  clientId: env("WORLD_CLIENT_ID"),
  clientSecret: env("WORLD_CLIENT_SECRET"),
  redirectUri: env("WORLD_REDIRECT_URI", "http://localhost:3000/api/world/callback"),
  maxTokenAge: Number(env("WORLD_MAX_TOKEN_AGE", "120")),
});

let discoveryCache: { at: number; value: Discovery } | undefined;
export async function discover(): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.at < 10 * 60_000) return discoveryCache.value;
  const { issuer } = worldConfig();
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { cache: "no-store" });
  if (!res.ok) throw new WorldAuthError("discovery", `discovery failed: ${res.status}`);
  const value = (await res.json()) as Discovery;
  discoveryCache = { at: Date.now(), value };
  return value;
}

const b64url = (b: Buffer) => b.toString("base64url");

/** Build a new authorization request. Fresh authentication is demanded for step-ups. */
export async function beginAuth(purpose: AuthRequest["purpose"], opts: { proposalId?: string; owner?: string } = {}) {
  const d = await discover();
  const { clientId, redirectUri } = worldConfig();
  const req: AuthRequest = {
    purpose,
    proposalId: opts.proposalId,
    owner: opts.owner?.toLowerCase(),
    state: b64url(randomBytes(24)),
    nonce: b64url(randomBytes(24)),
    codeVerifier: b64url(randomBytes(48)),
    requestedAt: Math.floor(Date.now() / 1000),
  };
  const challenge = b64url(createHash("sha256").update(req.codeVerifier).digest());
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid",
    state: req.state,
    nonce: req.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (purpose === "stepup") {
    // RFC 9470 / OIDC core: force re-authentication and require auth_time in the token
    params.set("prompt", "login");
    params.set("max_age", "0");
  }
  return { request: req, url: `${d.authorization_endpoint}?${params.toString()}` };
}

/** Exchange the code and verify the ID token against the request. Throws WorldAuthError on any failure. */
export async function completeAuth(req: AuthRequest, code: string): Promise<VerifiedIdentity> {
  const d = await discover();
  const { clientId, clientSecret, redirectUri, maxTokenAge } = worldConfig();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: req.codeVerifier,
  });
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.id_token) {
    throw new WorldAuthError(json.error ?? "token", json.error_description ?? `token endpoint ${res.status}`);
  }

  const jwks = createRemoteJWKSet(new URL(d.jwks_uri));
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(json.id_token, jwks, {
      issuer: d.issuer,
      audience: clientId,
      algorithms: ["RS256"],
      clockTolerance: 30,
    }));
  } catch (e) {
    throw new WorldAuthError("invalid_token", `ID token rejected: ${(e as Error).message}`);
  }
  if (payload.nonce !== req.nonce) throw new WorldAuthError("nonce", "nonce mismatch");
  if (typeof payload.sub !== "string") throw new WorldAuthError("sub", "missing subject");

  const now = Math.floor(Date.now() / 1000);
  const iat = Number(payload.iat ?? 0);
  const authTime = Number(payload.auth_time ?? iat);
  if (now - iat > maxTokenAge) throw new WorldAuthError("stale", `token issued ${now - iat}s ago, max ${maxTokenAge}s`);
  if (req.purpose === "stepup" && authTime + 30 < req.requestedAt) {
    throw new WorldAuthError("not_fresh", `auth_time ${authTime} predates the step-up request ${req.requestedAt}`);
  }
  return { issuer: d.issuer, subject: payload.sub, authTime, issuedAt: iat, acr: payload.acr as string | undefined };
}
