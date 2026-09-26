# Deployment and operations guide

Everything you need to redeploy Tide, rotate credentials, or move the client to a public host without
rediscovering the traps. Keep this current when the process changes; log what changed in `CHANGELOG.md`.

## 1. Environment

`.env` at the repo root (gitignored) is loaded by Foundry scripts via `source` and by Next through
`next.config.ts`. `.env.example` is the checked-in template.

| Var | Used by | Notes |
| --- | --- | --- |
| `SEPOLIA_RPC_URL`, `MAINNET_RPC_URL` | contracts, client | Alchemy free tier caps `eth_getLogs` at 10 blocks; the dashboard reads logs through `LOGS_RPC_URL` (defaults to publicnode) |
| `OWNER_PRIVATE_KEY`, `OWNER_ADDRESS` | deploy scripts, ENS registrar, wizard backend | the tide.eth owner; funds everything |
| `AGENT_PRIVATE_KEY`, `AGENT_ADDRESS` | manager agent | `TideParams.manager` and the EAC role holder |
| `ENS_*` | ENS scripts | parent name, labels, resolver, role id |
| `WORLD_ISSUER`, `WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET`, `WORLD_REDIRECT_URI` | World step-up | see §5 |
| `PUBLIC_APP_URL` | ENS agent records (`agent-endpoint*`) | rewrite records with `pnpm ens:setup` after changing it |
| `AGENT_TICK_MINUTES`, `AGENT_MIN_MOVE_BPS` | autopilot | defaults 15 and 500 |
| `MONGODB_URI` | everything off-chain | database name in the path; collections below. Needs a server restart to pick up |
| `AGENT_TICK_SECRET` | `POST /api/agent/tick` | operator secret in the `x-tide-secret` header; without it the manual tick is refused |

Foundry scripts read `OWNER_ADDRESS`/`AGENT_ADDRESS` with `vm.envAddress`, which needs **exported**
variables. `source .env` alone is not enough in a script; use `set -a; source .env; set +a`.

## 2. Local development

```bash
cd client && pnpm install
mkcert -key-file certificates/localhost-key.pem -cert-file certificates/localhost.pem localhost 127.0.0.1 ::1
pnpm dev            # https://localhost:3000 (pnpm dev:http for plain http; the World callback then fails with ERR_SSL_PROTOCOL_ERROR)
```

HTTPS is required because the World ID sandbox only accepts HTTPS callbacks (§5). `next dev
--experimental-https` alone tries `mkcert -install`, which needs the machine password, and silently
falls back to HTTP when it fails; passing the key and cert explicitly (what `dev` does) avoids that.
Run `mkcert -install` once if you want the browser to trust the certificate. The mkcert binary Next
downloads lives at `~/Library/Caches/mkcert/`.

The Claude desktop preview config is `.claude/launch.json` (same command).

## 3. Contracts

```bash
cd contracts
forge test                         # 46 tests; forge fmt src test script before committing
forge test --match-contract BaselineGas -vv   # gas numbers quoted in README / whitepaper
```

### 3.1 Redeploy on Sepolia, in order

```bash
cd contracts && set -a && source ../.env && set +a
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $OWNER_PRIVATE_KEY
SEPOLIA_STEP=ship forge script script/SepoliaDemo.s.sol --tc SepoliaDemo --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $OWNER_PRIVATE_KEY
SEPOLIA_STEP=fill forge script script/SepoliaDemo.s.sol --tc SepoliaDemo --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $OWNER_PRIVATE_KEY
forge script script/DeployHook.s.sol --tc DeployHook --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $OWNER_PRIVATE_KEY
forge script script/DeployHook.s.sol --tc SwapHook   --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $OWNER_PRIVATE_KEY
```

`Deploy` writes `deployments/11155111.json` (params, router, app); `forge script script/DeployTaker.s.sol --tc DeployTaker ...`
adds `tideTaker` to it (the wallet-facing taker the dashboard trades through); `DeployHook` writes
`deployments/11155111-hook.json` (hook, pool id). Transaction hashes are in `broadcast/` (gitignored);
copy the ones you cite into README / whitepaper / CHANGELOG.

What a redeploy changes:

- **Order hash.** The SwapVM program embeds the `TideParams` address, so a new `TideParams` means a new
  order hash for every strategy (`maker`, tokens, salt unchanged). `SepoliaDemo ship` re-inits params
  and re-ships; user-created strategies from the wizard must be re-created. The Aqua fill in `ship`
  checks `rawBalances` before shipping, so it is idempotent.
- **Old liquidity.** Aqua keys balances by router. Dock the old strategy so the wallet is not pledged
  twice: `cast send $AQUA "dock(address,bytes32,address[])" $OLD_ROUTER $OLD_ORDER_HASH "[$WETH,$USDC]"`.
- **Hook.** New hook address = new `PoolId`; `DeployHook` initialises the pool, inits params for the new
  id and seeds 0.2 WETH + 600 USDC.
- **Claiming keys.** `Deploy` calls `params.setApp(app)`, `DeployHook` calls `params.setHook(hook)` before
  `initialize`; the hook claims its PoolId for the deployer wallet (`OWNER` constructor argument, needed
  because CREATE2 runs the constructor from the deployer contract). Makers claim order hashes through
  `TideApp.init(cfg, ...)`; a direct `TideParams.initFor` from anyone else reverts with `NotVenue`.
- **Parameter box.** `init` reverts unless `(N − 1)·δ ≤ 2·fee`. Scripts use λ 5000, N 4, δ 20, fee 30.
  A δ of 45 % (buffer top-up demo) needs a 67.5 % fee; see `MATHEMATICS_MODEL.md` § 8.
- **Guardrails.** `init` sets defaults for the manager (λ 1000 to 9000, step ≤ 2500 bps, N ≤ 8, cooldown
  3600 s). Owner changes them with `setBounds` (dashboard card or `cast`). Manager writes outside them
  revert with `OutsideBounds`; `withinBounds(key, λ, N)` is the same check as a view.

### 3.2 After a redeploy, in the client

```bash
cd client
pnpm sync:contracts        # rewrites ADDR in src/lib/chain.ts, copies ABIs from contracts/out
```

Then by hand:

1. `pnpm ens:setup`: rewrites `strategyHash`, `delta`, `fee` records if stale (idempotent; env
   `TIDE_LAMBDA_BPS / TIDE_N / TIDE_DELTA_BPS / TIDE_FEE_BPS` override the defaults 5000/4/20/30), then
   `pnpm reindex` so the `strategies` collection picks up the new hash.
2. `README.md` deployments table and sponsor sections, `docs/whitepaper/whitepaper.typ` (addresses,
   tx hashes, gas, test count) then `typst compile --root . docs/whitepaper/whitepaper.typ WHITEPAPER.pdf
   && cp WHITEPAPER.pdf client/public/`, `CLAUDE.md` status, `CHANGELOG.md`.
   `grep -rn <old address prefix> --include='*.md' --include='*.typ' --include='*.ts*'` finds stragglers.
3. Open the dashboard and check the fee card, the split and the fill list come from the new router.

The landing page's "On-chain, now" table reads `ADDR` from `chain.ts`, so it follows the sync.

### 3.3 Mainnet fork demos

`contracts/script/fork-demo.sh` starts anvil (`--chain-id 31337`, `nohup`), funds the maker with real
WETH/USDC via `anvil_setStorageAt`, deploys, ships and fills against the official Aqua registry.

`contracts/script/side-by-side.sh [--fast]` is the comparison demo: plain Aqua strategy vs Tide, same
maker, inventory, router, registry and price path, eight blocks, every leg a real fill in one transaction
per block (`Bench.round`). `SideBySide.s.sol` writes `deployments/sidebyside.json` (gitignored);
`side_by_side.py` decodes the `Swapped` events from `broadcast/SideBySide.s.sol/31337/run-latest.json`
and renders. Re-running reuses the anvil already on :8545 and redeploys fresh. Kill anvil with
`pkill anvil` to start from a clean fork.

### 3.4 Example strategies and templates

Explore (`/app/explore`) reads the `publications` collection, so a fresh database shows nothing. With the dev
server up and the owner key in `.env`:

```bash
cd client && pnpm seed:examples
```

Creates `calm-eth-usdc`, `storm-eth-usdc` and `retail-link-usdc` from the owner wallet if they do not exist
(name, `TideApp.init` with the manager, `setBounds`, `Aqua.ship`, resolver grants), then publishes those and
`eth-usdc` / `link-usdc-tide` as live listings and templates. Re-running only refreshes the listings. Presets
and copy live at the top of `client/scripts/seed-examples.ts`; every preset satisfies `(N - 1) * delta <= 2 * fee`.
LINK is not mintable: the owner wallet needs LINK from the Chainlink faucet before the LINK preset can ship.

## 4. ENS (Sepolia, ENSv2 beta)

`pnpm ens:setup` is idempotent: registry under `tide.eth`, `eth-usdc.tide.eth` and `manager.tide.eth`
resolvers, records, `grantSetterRoles` for the agent on exactly `lambda`, `N`, `delta`. State in
`client/data/ens.json`. `scripts/ens-agent-check.ts` proves the role scope; `scripts/ens-revoke.ts` revokes.
Records on a strategy name: `lambda`, `N`, `delta`, `fee`, `strategyHash`, `venue`, `description`.
The fee record is informational and owner-only; the agent has no role on it.

New strategies from `/app/new` get their own resolver (owner = the user's wallet) and subname; the
backend (owner key) is the registrar, nothing else.

Off-chain state lives in MongoDB (`MONGODB_URI`), one database, six collections, indexes created on first
use by `client/src/lib/db.ts`:

| Collection | Holds | Rebuildable from chain? |
| --- | --- | --- |
| `strategies` | index of names created through the app (label, owner, resolver, order hash, tokens, salt, tx hashes) | yes, `pnpm reindex` (`ETHRegistry.getSubregistry`, `LabelRegistered` events, `strategyHash` records) |
| `proposals` | the manager's proposals and what happened to them | applied ones yes (`ParamsUpdated`, records); requests themselves are off-chain by nature |
| `authRequests` | pending OIDC requests (state, nonce, PKCE verifier), TTL one hour, deleted on use | no, and must not be |
| `bound` | owner wallet → pairwise World ID subject | no; re-bind |
| `log` | the agent's audit trail | no |
| `ens` | tide.eth setup state (registry, resolvers, tx hashes), written by `ens:setup` | yes |

`pnpm db:import` loads the old `client/data/*.json` files into these collections (upserts, safe to re-run).
`pnpm db:check` prints the counts and the dashboard snapshot the API would serve. The app never reads the
files any more. Scripts call `process.exit` when done; the driver's pool would otherwise keep them alive.

Beta contract addresses and ABIs: `client/src/lib/ens/config.ts` (contracts-v2 commit `71a3b733`).

## 5. World ID for Agents

Sandbox issuer `https://sandbox.auth.world.org`. One OIDC client per redirect hostname (the hostname is
the immutable pairwise-subject sector).

### 5.1 Register a client (agent-driven)

1. World ID sandbox MCP plugin installed and authorised with **both** scopes: `world-id:read` (World ID
   sign-in) and `developer-portal:manage` (Google sign-in). If a portal tool answers `insufficient_scope`,
   re-authenticate the MCP in an interactive `claude` session (`/mcp`).
2. `request_oidc_client_registration` with a UUID `requestId`, name, **HTTPS** redirect URIs,
   `tokenEndpointAuthMethod: client_secret_post` (the backend posts `client_secret` in the token body).
   `http://localhost` returns a bare `invalid_request`: the sandbox applies the production callback policy.
3. The human approves the returned `portalUrl` (requests expire after 20 minutes). Then
   `get_portal_credential_request` → `clientId` → `WORLD_CLIENT_ID`.
4. `request_oidc_client_secret_creation` → human approves and **copies the secret in the browser** →
   `WORLD_CLIENT_SECRET` in `.env`. Secrets are shown once. If one is lost, create another (they overlap)
   and stage `request_oidc_client_secret_revocation` for the lost one; the last secret cannot be revoked.
5. `WORLD_REDIRECT_URI` must equal a registered redirect exactly (scheme, host, port, path).

Current sandbox client: `Tide manager`, id `1f15d369-99c8-475a-94f8-c387dcb075aa`, redirect
`https://localhost:3000/api/world/callback`.

### 5.2 Test the flow

- Bind: the dashboard button signs `Tide: bind World ID to <owner> at <ts>` with the connected wallet and
  opens `GET /api/world/bind?owner=<wallet>&ts=<ms>&sig=<0x…>` → sandbox → `/approved?purpose=bind`.
  Reuses an existing sandbox browser session (no `prompt`). From a shell:
  `TS=$(date +%s000); SIG=$(cast wallet sign --private-key $OWNER_PRIVATE_KEY "Tide: bind World ID to $OWNER_ADDRESS at $TS")`
  then open `https://localhost:3000/api/world/bind?owner=$OWNER_ADDRESS&ts=$TS&sig=$SIG`. Unsigned or
  stale requests get 401. Every strategy owner binds their own World ID; one app client serves all of them.
- Inside guardrails: `POST /api/agent/propose {"strategy":"eth-usdc.tide.eth","sigma":0.42}` applies at
  once (ENS + `TideParams.set` by the agent), proposal status `applied`, `auto: true`. A second call within
  the cooldown escalates instead.
- Outside guardrails (step-up): same POST with a σ whose λ* is far away → `approvalUrl` → sandbox demands
  fresh proof (`prompt=login&max_age=0`) → `/approved?purpose=stepup`; the agent writes ENS, status
  `approved`; the owner presses "Apply on-chain" (wallet `set`), `/api/agent/applied` verifies on-chain and
  marks it `applied`. From a shell the owner step is
  `cast send $TIDE_PARAMS "set(bytes32,uint32,uint32,uint32)" $HASH λ N δ --private-key $OWNER_PRIVATE_KEY`
  followed by `POST /api/agent/applied {"id","tx"}`.
- Denied / expired / replayed / forged: `pnpm tsx scripts/test-agent-flow.ts` (no credentials needed).

## 6. Public deployment (Vercel)

The app is `client/` (Next 16, Node runtime). MongoDB Atlas is already remote, so the only host-specific
parts are the manager's clock and the World client. `client/vercel.json` carries a cron that calls
`GET /api/agent/tick` every 15 minutes (Vercel sends `Authorization: Bearer $CRON_SECRET`) and raises the
function limit to 60 s, because `/api/state` scans fill logs. `instrumentation.ts` skips the in-process
scheduler when `VERCEL` is set, so the cron is the only clock there.

1. **Import the repo** at vercel.com/new. Root directory `client`, framework Next.js, install command
   `pnpm install` (the lockfile is committed; Vercel reads `packageManager`). Leave build as `next build`.
2. **Environment variables** (Production + Preview): every key from §1 except `MAINNET_RPC_URL`,
   `ETHERSCAN_API_KEY` and `REINDEX_FROM_BLOCK`. Must-haves: `SEPOLIA_RPC_URL`, `LOGS_RPC_URL` (a node without
   a `getLogs` range cap, publicnode works), `OWNER_ADDRESS`, `AGENT_PRIVATE_KEY`, `AGENT_ADDRESS`, the `ENS_*`
   keys, `MONGODB_URI`, `AGENT_TICK_SECRET`, `CRON_SECRET` (any random string), `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
   if mobile wallets matter. `OWNER_PRIVATE_KEY` is not needed by the app, only by scripts; leave it out.
   `next.config.ts` also reads `../.env`, which does not exist on Vercel, so nothing leaks from the repo.
3. **Deploy once** to learn the hostname (`<project>.vercel.app`, or add a custom domain first).
4. **World client for that hostname**: register a second sandbox client (§5.1) with redirect
   `https://<host>/api/world/callback`, set `WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET`, `WORLD_REDIRECT_URI` and
   `PUBLIC_APP_URL=https://<host>` in Vercel, redeploy. The owner binds again on that host (different sector,
   different `sub`).
5. **ENS agent records**: locally, with `PUBLIC_APP_URL=https://<host>` in `.env`, run `pnpm ens:setup` once
   so `agent-endpoint*` on `manager.tide.eth` point at the public host.
6. **Atlas network access**: allow `0.0.0.0/0` (Vercel egress IPs are not fixed) or use a Vercel-Atlas
   integration. The `test:test` user is hackathon-only.
7. **Check**: `https://<host>/app/explore` lists the seeded strategies, `/api/agent/status` returns JSON,
   Vercel → Project → Cron Jobs shows the tick and its last run, a trade quote loads on `/trade`.
8. Put the URL in README (ENS live-demo link) and in the World redirect list.

Any other Node host (Railway, Fly, a VPS) works too: run `pnpm build && pnpm start`, keep `VERCEL` unset so
the in-process scheduler runs, skip the cron.

## 7. Traps, in one place

- SwapVM and v4 have no block hook: the re-split is lazy on the first quote of a block. Tested.
- The program embeds the `TideParams` address: new params = new order hashes = re-init, re-ship,
  new `strategyHash` records.
- `vm.envAddress` needs exported env vars.
- `forge` caches by chain id: the fork uses `--chain-id 31337`, and `vm.store` is not broadcast
  (funding is done with `anvil_setStorageAt`).
- PoolManager is pinned to solc 0.8.26: compiled as its own unit (`test/v4/PoolManagerArtifact.sol`,
  `compilation_restrictions` in `foundry.toml`) and deployed from artifact bytes in tests.
- OZ `BaseCustomCurve._getSwapFeeAmount` only feeds the `HookSwap` event; the fee is netted inside
  `_getUnspecifiedAmount` and reported from a transient variable.
- Alchemy free tier: `eth_getLogs` capped at 10 blocks; logs go through `LOGS_RPC_URL`.
- World sandbox: HTTPS callbacks only; `mkcert -install` needs a password; secrets shown once; hostname
  is the sector.
- `(N − 1)·δ ≤ 2·fee` or `init`/`set`/`setFee` revert. The frontier's fee term is only valid near 1 bp.
