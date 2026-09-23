# ADR-0017: The local auth bypass is one launcher-owned name

- **Status**: Accepted
- **Date**: 2026-08-25
- **Issue**: [#519](https://github.com/KeeprDigital/stream-keepr/issues/519)
- **Supersedes**: [ADR-0013](./0013-two-runtime-var-local-bypass-activation-is-an-accepted-residual.md)
- **Amended**: by [ADR-0018](./0018-a-lan-bypassed-launcher-is-an-accepted-local-exposure.md), which adds `pnpm dev:local:bypass`

## Context

Activation took two exact runtime values: `NUXT_LOCAL_AUTH_BYPASS=true`, which a
developer set in `.env` and left there, and `STREAM_KEEPR_LOCAL_RUNTIME=true`,
which only supported launchers supplied. The pair existed so that the value a
developer keeps in a file is inert on its own — a leaked, copied, or
bulk-uploaded `.env` could not open a deployed installation. ADR-0013 accepted
the both-values-on-a-deployed-Worker case as a residual and recorded the
deploy-side guards as the defence against the accidental one.

The scheme worked and cost more than it protected, in a way that only showed up
in daily use:

- `assertLocalAuthBypassDisarmedForBuild` refused any non-dev build that saw the
  `.env` name armed. So a checkout that wanted a bypassed dev server could not
  run `pnpm build` — and therefore could not run `pnpm verify`, which is this
  repository's mandated pre-push gate. Every developer using the bypass hit this.
- The refusal had already been carved out once, launcher by launcher:
  [#504](https://github.com/KeeprDigital/stream-keepr/issues/504) exempted
  `nuxt prepare` after an armed `.env` broke `pnpm install`'s postinstall.
- `pnpm preview` had to defensively prefix its own build with
  `NUXT_LOCAL_AUTH_BYPASS=` to get past the refusal it would otherwise trip.
- Two names, five documents explaining which one did what, and a recurring
  question about whether either had to be set for a build or a suite to pass.
  The answer was always no, and the machinery kept implying otherwise.

## Decision

**One name, owned by the launcher, assigned in no file.**
`STREAM_KEEPR_LOCAL_AUTH_BYPASS=true` activates the Local Developer Session, and
nothing else does. `pnpm dev:bypass` and `pnpm preview:bypass` set it on the
command line they launch; `.env` does not carry it and `.env.example` does not
name it.

Deliberately not `NUXT_`-prefixed: no `runtimeConfig` key ever answered to this
name, so the prefix advertised membership of the family `.env` exists to hold —
which is precisely the file it must never be in.

**The build-time refusal is removed.** A build has no opinion about local
authentication, and says nothing about it.

**The generated-configuration scan is kept and retargeted.**
`pnpm worker:dry-run` refuses a generated Wrangler configuration containing the
name, anywhere, including named environment branches. It reads deployment output
rather than the environment a command ran in, so it cannot refuse a build, a
suite, or a bypassed local launcher.

## Grounds

1. **The single name is safer than the pair, because no file holds it.** The
   second value existed to keep a file's value inert. A value that is never
   written to a file has nothing to keep inert: the accidental paths the pair
   was defending — `.env` copied between worktrees, piped into a secret store,
   or committed — no longer have anything to carry. This is structural rather
   than a policy anyone has to remember.
2. **The build refusal guarded nothing the artifact could carry.** Measured, not
   reasoned: the generated `.output/server/wrangler.json` declares no `vars`; the
   server bundle reads the name from the Worker environment at request time
   rather than inlining a build-time value; and `pnpm deploy` runs `pnpm build`,
   which wipes `.output`, before it uploads — so nothing a preview stages can
   survive into a deploy. The smoke suite measures the same claim against the
   real bundle every run: the production artifact answers 401 by default and
   admits the Local Developer Session only when the name is present in its
   environment.
3. **Cost fell entirely on correct use.** The refusal never fired on an attack
   or an accident. It fired on developers running the pre-push gate they are
   required to run.

## Residual

Setting the name on a deployed Worker activates the bypass, and no runtime
signal guards against it. Accepted, on ADR-0013's ground 1, which the collapse
to one name does not weaken: editing Worker vars or secrets takes the same
Workers Scripts edit permission that deploying code does, and either route ships
a new Worker version. Anyone who can stage this can already deploy an arbitrary
Worker. This is a capability-equivalence acceptance, not a likelihood bet.

ADR-0013's ground 2 also survives intact: `pnpm worker:smoke` authenticates its
probes by setting this name on the production `.output/` bundle under local
workerd, and a build-time constant that hard-disabled the bypass in production
builds would either break those probes or push smoke onto a specially-built
bundle — surrendering the "test the exact upload artifact" guarantee the suite
exists for (the [#302](https://github.com/KeeprDigital/stream-keepr/issues/302)
class).

If Cloudflare access is ever split so that var/secret editing no longer implies
deploy rights, or such a role is granted to anyone untrusted with deploys, that
ground collapses and this decision must be revisited.

## What changed for a reader of ADR-0013

- The `local-auth-unattested-refusal` smoke probe is gone. It proved that the
  bypass name alone refused; there is no longer a second value for it to be
  alone without. Deny-by-default on the untouched artifact is still proven, by
  the `api-boundary` probe in the same run.
- "Both values" in ADR-0013's residual reads as "the name" here.
- The deploy-side guards it named are now one: the dry run's generated-config
  scan. The staging gate it also named still verifies the decision, but the
  decision now arrives from the launcher rather than from a file.

## Related

ADR-0010 (the authentication boundary the bypass substitutes for) ·
ADR-0013 (superseded) ·
`shared/utils/localDeveloperAuth.ts` (the gate and its threat-model docblock) ·
`build/localAuthDeployment.ts` (the generated-configuration scan) ·
`scripts/worker-smoke/runner.mjs` (the suite that depends on activation)
