> Planning notes from Sep 25, kept for history. They predate the fee bound, the guardrails and MongoDB; the shipped design is in `MATHEMATICS_MODEL.md`, `docs/DEPLOYMENT.md` and the whitepaper.

# Tide × ENSv2

## Simple role

**ENSv2 is Tide's public identity, settings, and permission system.** It gives the strategy and its manager agent readable names while limiting exactly which settings the agent may change.

## How Tide integrates ENSv2

- `eth-usdc.tide.eth` identifies the liquidity strategy.
- `manager.tide.eth` identifies the manager agent.
- The strategy's text records publish `lambda`, `N`, `delta`, `strategyHash`, and venue information.
- A Permissioned Resolver and Enhanced Access Control let the agent edit only `lambda`, `N`, and `delta`.
- The agent cannot edit the strategy hash, ownership, resolver, or its own permissions.
- Approved ENS values are mirrored into `TideParams`, which the trading contracts read.

ENS is the public policy and audit layer; `TideParams` is the execution copy used by Aqua.

## What is working

- ENSv2 names and resolvers are deployed on Sepolia.
- Strategy records are read through the Universal Resolver.
- The agent has per-key permissions for the three governed parameters.
- Tests/scripts demonstrate allowed and forbidden record changes.
- The dashboard compares ENS values with `TideParams` and reports whether they are synchronized.

## What needs to be fixed or added

- Make revocation authoritative across both ENS and `TideParams`; the manager wallet must not retain a separate path to update parameters.
- Detect stale proposals before an approved change is applied.
- Add safe retry and reconciliation when the ENS write succeeds but the `TideParams` write fails.
- Add owner-facing enable, revoke, and repair controls to the UI.
- Ensure every displayed setting is resolved live rather than copied from configuration.

## Prize target

**Target: Best Use of ENSv2.**

ENSv2 is central when it defines the agent's identity, editable resources, and revocation—not merely when it supplies a `.eth` label.

## Winning demo

1. Resolve `eth-usdc.tide.eth` and display its live parameters.
2. Resolve `manager.tide.eth` and display its agent records.
3. Let the agent update `lambda` after approval.
4. Attempt to update `strategyHash` and show the transaction fail.
5. Revoke the agent's authority.
6. Attempt another `lambda` update and show that it fails without changing `TideParams`.

## One-line pitch

> ENS does not merely name Tide's agent; it defines what the agent may control and gives the owner a public, revocable safety switch.
