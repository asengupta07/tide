> Planning notes from Sep 25, kept for history. They predate the fee bound, the guardrails and MongoDB; the shipped design is in `MATHEMATICS_MODEL.md`, `docs/DEPLOYMENT.md` and the whitepaper.

# Tide × World ID

## Simple role

**World ID is Tide's human safety key.** The agent may analyze the market and recommend a new risk setting, but it cannot apply that change until the bound owner completes a fresh verification.

## Target track

**Target: Best Use of World ID for Agents.**

Tide should focus on the Agents track rather than adding a separate IDKit flow. Its meaningful trust moment is an autonomous agent asking to change how much of the owner's inventory is exposed to market risk.

## Protected action

World ID approval must authorize one exact proposal, for example:

```text
Strategy: eth-usdc.tide.eth
Current lambda: 50%
Proposed lambda: 33%
Reason: measured volatility increased
Expires: three minutes after creation
Proposal: unique ID and action hash
```

Changing any field must invalidate the approval.

## How Tide integrates World ID

1. The on-chain owner signs a wallet message and begins the identity-binding flow.
2. The backend stores the verified World subject against that owner.
3. The agent calculates and creates a parameter proposal.
4. World requests fresh authentication for that proposal.
5. The backend verifies the issuer, audience, nonce, subject, `auth_time`, proposal, and expiration.
6. A successful result unlocks the ENS and `TideParams` writes.
7. Cancellation, denial, expiry, replay, or a mismatched owner leaves both parameter stores unchanged.

## What is working

- The authorization-code flow uses PKCE, state, and nonce.
- ID tokens are validated on the server against the issuer's signing keys.
- The backend checks the issuer, audience, nonce, subject, token age, and authentication freshness.
- Denied, replayed, expired, and forged-code paths are represented in the test harness.
- The agent writes only after the approval branch is reached.

## What needs to be fixed or added

- Complete and record one successful end-to-end World ID approval.
- Bind World identity to a wallet signature from the actual `TideParams.owner`.
- Require owner authorization before rebinding the World subject.
- Reject step-up tokens that do not contain an explicit `auth_time`.
- Bind verification to an immutable hash of the exact action.
- Store proposals and authentication requests in a transactional database.
- Finish the integration debrief with real time-to-success, friction, and requested improvements.

## Winning demo

### Successful path

```text
Agent proposes lambda 50% -> 33%
        -> owner completes fresh verification
        -> backend validates the result
        -> ENS and TideParams update
        -> Tide uses 33% in the next block
```

### Unsuccessful path

```text
Agent proposes lambda 33% -> 60%
        -> owner cancels or the request expires
        -> proposal is marked blocked
        -> ENS remains 33%
        -> TideParams remains 33%
```

## One-line pitch

> World ID is the point where human responsibility meets autonomous financial action: the agent recommends risk, but only the owner can authorize it.
