# Graphics Asset Library Operations Cockpit

The cockpit is the administrator-only surface that answers two questions in one
reading: is the Graphics Asset Library safe, and what needs attention. It lives
at `/admin/graphics-assets` and reads `GET
/api/admin/graphics-assets/operations-cockpit`.

It holds no state of its own. Everything it shows is composed from durable
catalogue state the library already owns, so any reading can be reproduced, and
an incident it reports stays reported until the incident itself is resolved.

## Why it is one endpoint

The page could have fanned out to the five existing admin surfaces — health,
capacity, retention, reconciliation, and evidence. It does not, for two reasons.

A cockpit assembled from independently timed reads shows a torn picture: a quota
from one instant beside a backlog from another, which is exactly what an
administrator must not be given while deciding whether the library is safe.
And the rules that turn raw state into a triage answer — which discrepancy kinds
are critical, which alerts persist, which Evidence categories are which outcome —
are domain rules. They belong in the module beside the state they classify, not
in a page.

Inspecting and acting on one discrepancy, deadline, or Evidence entry stays on
the existing per-concern routes. The cockpit summarises; it is not a replacement
for the reconciliation queue.

## Why it is bounded

Every catalogue read behind one cockpit reading is an aggregate or a bounded,
ordered sample. Nothing expands rows in order to count them, so a reading costs
the same against a library holding a handful of assets and one holding a large
backlog. Concretely:

- Lifecycle counts and their nearest deadlines come from four `COUNT`/`MIN`
  aggregates, not from the capped deadline lists the retention overview returns.
- The reconciliation backlog is `countOpenDiscrepancies()` plus an isolated-
  incident count. The cockpit never expands discrepancy rows; the reconciliation
  overview remains the place that does.
- Unfinished ingestion is one `GROUP BY` for the complete counts plus one
  bounded, risk-ordered sample of at most 20 operations.
- Recent outcomes read one bounded window of the Evidence ledger.

The cost of a reading is therefore constant in the size of the library. The one
query that binds a list binds a fixed one — the thirteen Evidence categories the
outcome groups map — and the one query that returns more than a handful of rows
returns a fixed 200-row window. Neither grows with the catalogue, so neither
approaches the D1 bound-parameter ceiling that
`test/unit/server/modules/graphicsAssetCatalogueD1Limits.test.ts` guards, and
there is nothing new for that suite to cover.

## Two conditions, never one number

D1 catalogue condition and canonical byte-store condition are always reported
separately, and each is judged on its own durable evidence:

- **The catalogue** is `degraded` when it answers while recording Unavailable
  Graphic Asset Content — that is, when it knows part of what it lists cannot be
  served. It is `unavailable` only when it cannot answer at all.
- **The canonical byte store** is `degraded` when it answers while open Graphics
  Discrepancies say its bytes disagree with what the catalogue expects. It is
  `unavailable` only when it cannot answer at all.

Keeping the two sources apart is what makes the two answers independently
meaningful rather than one signal reported twice. It also follows the authority
contract in `graphics-reconciliation-schedule.md`: the catalogue decides what the
library expects to reach, the byte store decides which bytes exist, and the
availability flag is advisory reconciliation state that the cockpit reports as
the catalogue's own condition rather than as a reader authority.

The staging byte store carries only provisional transfers, so its condition is
liveness alone; it never degrades.

## When the catalogue cannot answer

A reading is still produced. The response discriminates on `outcome`:
`catalogue-unavailable` carries the condition and the alerts explaining it, and
omits every section that genuinely requires the catalogue. This is deliberate —
the moment D1 is down is exactly when the safety question matters most, and a
cockpit that returned an error then would answer it least.

## Alert severities

| Severity   | Meaning                                                                             |
| ---------- | ----------------------------------------------------------------------------------- |
| `critical` | The library cannot be trusted to serve or protect what it holds until someone acts. |
| `warning`  | A guarantee is at risk, or a retryable incident is open.                            |
| `info`     | State is being held safely and is only worth knowing about.                         |

A **persistent** alert is backed by a durable record that only an administrator
action or a byte-store recovery can clear, so it survives navigation and reload.
Critical integrity incidents, Unavailable Graphic Asset Content, missing
derivatives, quarantined objects, and expired staged input are all persistent.
A liveness or quota alert is a live condition and clears itself when the reading
changes.

## Capacity boundaries

The Canonical Graphics Quota is shown against its exact boundaries — warning at
80%, critical at 95%, blocked at 100% — in bytes as well as fractions, so the
surface never recomputes where a threshold sits. The fractions come from
`GRAPHICS_CANONICAL_QUOTA_BOUNDARY_FRACTIONS`, which is also what
`graphicsCanonicalCapacityPressure` uses, so the pressure a caller is told and
the boundaries an administrator is shown cannot drift apart.

The Graphics Staging Allowance is a separate budget. It is never borrowed from
or lent to the canonical quota and carries no canonical boundary or pressure of
its own.

## Actions

The cockpit offers exactly two installation-wide actions, both of which already
existed and neither of which can shorten a recovery guarantee:

- `POST /api/admin/graphics-assets/reconciliation` — run one reconciliation pass.
- `POST /api/admin/graphics-assets/retention` — run one retention sweep.

Capacity limits are changed on `/admin/graphics-assets/health`, which the cockpit
links to. Early Purge, repair, regeneration, and deep verification remain on the
per-subject surfaces that can prove what they need to prove.

Storage pressure never shortens Trash, revision, quarantine, or staged-input
guarantees, and no cockpit action offers to trade one for capacity.

## Operating it

Every route above requires the `x-graphics-admin-token` header, matching the
other `/api/admin/graphics-assets` surfaces. The page holds the token in memory
for the session only and never persists it.

## Leakage

A cockpit reading is domain-shaped throughout. It carries no provider key,
bucket, object key, content digest, filename, raw URL, capability secret,
database row, or provider error message. Ingestion failures are reported by
stable code alone — the free-text message a failure also carries is for the
author who caused it, not for an installation-wide surface. The module-seam and
integration suites both assert this on the serialised payload.
