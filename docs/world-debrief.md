# World ID for Agents integration debrief

Project: Tide, ETHGlobal Tokyo 2026. Written as the integration was built (Sep 25-26, 2026).

## What the protected action is

The manager agent (`manager.tide.eth`, wallet `0xedbA…9647`) proposes new values of the three
strategy parameters (`lambda`, `N`, `delta`) for `eth-usdc.tide.eth`. Writing them is the protected
action: it changes how much of the owner's inventory the AMM exposes each block. The write is an ENSv2
`setText` through an EAC role scoped to those three keys, followed by `TideParams.set` on Sepolia.

## Flow (client/src/lib/world.ts, client/src/lib/agent.ts)

1. **Bind** (`GET /api/world/bind`): the owner signs in once through the OIDC authorization-code flow
   (PKCE, `scope=openid`). The backend validates the ID token and stores `(iss, sub)`; `sub` is pairwise
   so it identifies the owner to this app only.
2. **Request** (`POST /api/agent/propose`): the agent reads the activeness frontier and creates a
   proposal. The backend starts a step-up request with `prompt=login` and `max_age=0` and hands the
   owner the authorization URL.
3. **Completion** (`GET /api/world/callback`): the code is exchanged server-side with the client secret
   (never in the browser). The ID token is verified against the JWKS (RS256), `iss`, `aud`, `nonce`,
   `iat` (max age 120 s) and `auth_time` (must not predate the step-up request: fresh authentication).
4. **Validated result → protected action**: only if the verified `sub` equals the bound owner's does the
   agent call `setText` and `TideParams.set`. Every other outcome marks the proposal `blocked` and writes
   nothing.
5. **Denied / expired / cancelled**: `error=access_denied` from the IdP, a timed-out approval window,
   a replayed `state`, or a forged code all take the blocked path. `client/scripts/test-agent-flow.ts`
   drives these four paths and asserts the ENS records are unchanged afterwards.

## Environment

Official dev environment `https://sandbox.auth.world.org`. Discovery document read at runtime. The
client `Tide manager` was registered through the World ID MCP (`request_oidc_client_registration`, approved
by the owner in the portal) with redirect `https://localhost:3000/api/world/callback`,
`client_secret_post`. Sandbox applies the production callback policy, HTTPS only, and the registration
tool answers a plain `invalid_request` for an `http://localhost` callback, so local dev runs
`next dev --experimental-https`. Only local/test/staging environments accept HTTP loopback callbacks; the
getting-started guide says so, the error does not. The redirect hostname is the immutable pairwise
sector, so a public deployment on another hostname is a second client and a re-bind of the owner.

## Time to first success

- Discovery, PKCE, token exchange and JWKS validation: about 1 hour with `jose`, no SDK needed.
- Denied-path harness: 30 minutes.
- First successful step-up end to end (Sep 26): proposal `3509d7d32778` on `eth-usdc.tide.eth`, λ 5000 → 3300,
  δ 20 → 15 bps at a what-if σ = 80%. Authorization with `prompt=login&max_age=0`, code exchanged with
  `client_secret_post`, ID token validated, pairwise `sub` matched the bound owner, then ENS `setText`
  `0xfec2442d4827b8edfb40e7008ef295b466aadfee3f039252b4d077eec4bffdcb` and `TideParams.set`
  `0xe032df2b19b204d411dd50724f5a9bd5af20fd8d47a6d1df27e1070be03069a5`. Records and chain agree.
  From "client registered" to "first write" about 25 minutes, most of it the HTTPS callback detour below.

## Live run notes

- Client registration through the World ID MCP worked on the first HTTPS attempt: the agent stages the
  request, the human approves it in the portal, the public client config comes back through
  `get_portal_credential_request`. Secrets are shown once in the human's browser only.
- The owner missed copying the first secret. Secrets overlap, so a second one was staged with
  `request_oidc_client_secret_creation`, saved, and a revocation of the first staged for portal approval.
  Nothing had to be re-registered.
- `next dev --experimental-https` tries `mkcert -install`, which needs the machine password, and silently
  falls back to HTTP when it fails. Generating the certificate without `-install` and passing
  `--experimental-https-key/-cert` gives a working HTTPS callback; installing the CA later makes the
  browser stop warning.
- The bind step completed without a prompt because the owner already had a sandbox browser session from
  the portal sign-in. The step-up did not: `prompt=login&max_age=0` produced a new authentication event
  (the sandbox shows "Approved, finishing sign-in") and a fresh `auth_time`, which is what the backend
  checks. Session reuse for bind, fresh proof for the write: the intended split.

## Friction

- The docs page describes concepts (pairwise subjects, fresh authentication, RFC 9470) but the concrete
  request parameters had to be inferred from the discovery document (`prompt_values_supported`,
  `claims_supported`). A one-page "step-up recipe" (`prompt=login`, `max_age=0`, check `auth_time`)
  would have saved the inference.
- `scopes_supported` is `["openid"]` only; there is no scope that says "this is a step-up for action X".
  We bind the action to the request through our own `state` → proposal mapping. A standard
  `authorization_details` (RAR) or a `purpose` claim echoed in the ID token would let the human see
  *what* they are approving in the World prompt, not just *that* they are authenticating.
- Mocked proofs in the hackathon environment mean the human step is a click, which is fine for a demo but
  makes it hard to rehearse the real phone tap timing for the video.

## Missing capability / one improvement

Let the relying party attach a short human-readable message to the step-up request ("Tide manager wants
to change λ on eth-usdc.tide.eth from 50% to 33%") that World displays during authentication and echoes
back signed in the ID token. Today the human authenticates "fresh" but the binding between that
authentication and the specific action lives only in our backend.

## Where to look

- `client/src/lib/world.ts`: discovery, `beginAuth`, `completeAuth` (all validation)
- `client/src/lib/agent.ts`: `handleCallback` (approved vs blocked branches), `writeApproved`
- `client/src/app/api/world/*`: routes
- `client/scripts/test-agent-flow.ts`: denied, replayed, expired and forged-code paths
