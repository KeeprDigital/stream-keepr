# Graphics Asset Library retention schedule

The Graphics Asset Library reclaims storage on a Worker scheduled trigger. Every
deadline it enforces is evaluated inside the library against durable catalogue
state, so a missed, delayed, or repeated run only ever retains state for longer.
There is no reclamation the schedule can do that a later run cannot.

`wrangler.jsonc` declares the trigger, so **`pnpm deploy` installs an hourly cron
(`17 * * * *`) on the `stream` Worker**. Deploying a build without that entry
removes the trigger and silently stops all automatic reclamation; the library
keeps working and keeps accruing deadlines, and the operational retention view
is where that backlog becomes visible.

The Nitro `cloudflare:scheduled` hook is handled by
`server/plugins/graphics-retention-schedule.ts`, which calls
`runGraphicsRetention()` on the library built from Worker bindings rather than
from a request. A failed sweep is logged and swallowed so it can never take the
Worker down; the next run retries from durable state.

The same trigger also runs the reconciliation pass, from its own plugin and its
own hook handler, so neither can fail the other. The two meet at Content
Quarantine: reconciliation puts unexpected canonical objects into it, and this
sweep is what deletes them after the seven-day recheck. See
[the reconciliation schedule](./graphics-reconciliation-schedule.md).

## Why this is a direct Cloudflare dependency

The pinned `@nuxthub/core` 0.10.8 public runtime interface exposes no way to
declare or receive a scheduled trigger. NuxtHub covers configuration, bindings,
migrations, and local development for D1 and KV, but has no scheduled-trigger
module interface at all, so there is nothing to wrap and no NuxtHub capability
being bypassed for convenience.

This is the approved scheduled-trigger exception recorded in the NuxtHub
Integration Guardrail in #28. The dependency is confined to one Nitro plugin and
the `triggers.crons` entry:

- all authoritative retention state stays in `hub:db` (revision retention,
  tombstones, content quarantine, and the Evidence ledger are ordinary D1
  tables);
- all byte access stays behind the Graphics Object Store adapter; and
- the library's public interface is provider-independent, so the same sweep runs
  from the administrator API route and from module tests with no Cloudflare
  involvement.

Reassess this exception when `@nuxthub/core` is upgraded.

## Operating it

- `GET /api/admin/graphics-assets/retention` returns every exact deadline the
  installation is holding: staged input, Trash, revision pruning, and content
  quarantine, alongside current canonical pressure. It also states explicitly
  that pressure does not shorten guarantees.
- `POST /api/admin/graphics-assets/retention` runs the identical pass on demand.
  Use it to drain a backlog after downtime. It cannot shorten a deadline, so it
  is safe to run at any time.
- `GET /api/admin/graphics-assets/evidence` returns the Evidence ledger, which is
  the durable record of what the schedule did and why. A successful sweep logs
  nothing; the ledger is the audit trail.
- `POST /api/admin/graphics-assets/<assetId>/purge` is the only way to reclaim
  Trash before its 30-day window elapses, and requires an explicit
  `{"confirmation":"purge-now"}` body.

All four require the `x-graphics-admin-token` administrator header.

## Byte deletion safety

Content deletion is two-phase on purpose. A sweep claims a quarantined content
row, deletes the bytes, re-checks reachability, and only then removes the
catalogue trace. If the byte store is unavailable mid-deletion the claim is
released and the row stays queued, so an object can never be stranded without a
catalogue record of it. A sweep that dies between claiming and confirming leaves
the claim in place; it becomes reclaimable after a one-hour lease.

If content becomes reachable while its bytes are being deleted, the sweep marks
it Unavailable Graphic Asset Content and records a `content-deletion-conflict`
Evidence entry rather than losing a reachable identity silently. That is a repair
case, not a data-loss case: the identity and its references stay intact.

## Staged input the sweep could not release

Staged input expiry cannot be two-phase the same way. Expiring the operation is
what claims it — the update only lands if no durable checkpoint advanced since
the candidate was listed — so releasing the staging objects first would delete
the input of an operation that had just resumed. The claim therefore commits
before the objects go, and an unavailable staging store leaves them behind with
the operation already expired.

What the sweep guarantees instead is that it never reports those bytes as
reclaimed, and that it stops:

- the `staged-input-expired` entry records **Bytes reserved** rather than
  **Bytes freed**, meaning the operation is over but its staged bytes may still
  be occupying the staging store;
- the rest of that batch is left untouched for the next sweep, because a store
  that cannot release one candidate will not release the next twenty either.

So an expiry entry showing reserved bytes is the one case where the staging
store holds objects the catalogue no longer accounts for. Nothing else reclaims
them: reconciliation scans canonical objects, not staging ones. Check staging
usage against the operational retention view after a staging outage, and clear
any leftover `ingestion/<operationId>/…` objects by hand.
