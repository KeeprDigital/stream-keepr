# ADR-0013: Two-runtime-var local bypass activation is an accepted residual

- **Status**: Accepted
- **Date**: 2026-08-23
- **Issue**: [#460](https://github.com/KeeprDigital/stream-keepr/issues/460)

## Context

The local developer session bypass activates only when two runtime values are
both exact-string-true: `NUXT_LOCAL_AUTH_BYPASS` (the developer's choice) and
`STREAM_KEEPR_LOCAL_RUNTIME` (the attestation only supported local launchers
supply). Every guard against the pair reaching production is deploy-side — the
build refusal in `build/localConfiguration.ts`, the generated-config scan in
the worker dry run, the staging gate in `scripts/stage-preview-secrets.mjs`.
Nothing runtime-side stops someone with Cloudflare Workers edit access from
setting both values directly on the deployed Worker (dashboard or
`wrangler secret put`) and receiving a never-expiring admin-equivalent
session. [#460](https://github.com/KeeprDigital/stream-keepr/issues/460) asked
for a decision: close that scenario with a runtime signal, or accept it.

## Decision

**Accepted residual.** No runtime-side closure is built. Two grounds:

1. **The attacker gains nothing they lack.** Setting Worker vars or secrets —
   dashboard or `wrangler secret put` — requires the same Workers Scripts edit
   permission that deploying code does, and either route ships a new Worker
   version. Anyone who can stage this attack can already deploy an arbitrary
   Worker; the bypass crosses no privilege boundary that access has not
   already crossed. This is a capability-equivalence acceptance, not a
   likelihood bet.
2. **The bypass activating on a production-built artifact is load-bearing test
   infrastructure.** The worker-smoke runner authenticates its probes by
   setting exactly these two values on the production `.output/` bundle under
   local workerd — including the `local-auth-unattested-refusal` probe that
   proves the bypass-var-alone case refuses 401. A build-time constant that
   hard-disabled the bypass in production builds would either break that
   suite's authenticated probes or push smoke onto a specially-built bundle,
   surrendering the "test the exact upload artifact" guarantee the suite
   exists for (the #302 class).

## Alternatives rejected

- **Build-time constant compiled into the production bundle** — ground 2: the
  smoke suite authenticates through the bypass on the production artifact, and
  a special smoke build un-tests the artifact actually deployed.
- **Refusing bypass when a production-only binding is present** — contradicts
  the recorded design principle in the `localDeveloperAuth` docblock that
  environment shape is never inferred from bindings ("none of those facts
  proves who can reach the process"), and the same edit access that sets the
  two vars can remove the sentinel binding anyway.

## Consequences

- The `localDeveloperAuth` docblock's threat-model claim now states the
  residual: a single leaked value stays closed; both values set by someone
  with Worker edit access is deploy-equivalent access and out of scope.
- The deploy-side guards remain the whole defence against _accidental_
  activation, which is the failure mode they were built for. This record is
  not a reason to weaken them.
- If Cloudflare access is ever split so that var/secret editing no longer
  implies deploy rights (or such a role is granted to anyone untrusted with
  deploys), ground 1 collapses and this decision must be revisited.

## Related

ADR-0010 (the authentication boundary the bypass substitutes for) ·
`shared/utils/localDeveloperAuth.ts` (the gate and its threat-model docblock) ·
`scripts/worker-smoke/runner.mjs` (the suite that depends on activation) ·
[#302](https://github.com/KeeprDigital/stream-keepr/issues/302) (why smoke
must test the exact upload artifact)
