# Graphics Asset Library reconciliation schedule

The Graphics Asset Library compares what the catalogue expects to reach against
what the canonical byte store actually holds, on the same Worker scheduled
trigger as the retention sweep (`17 * * * *`, declared once in
`wrangler.jsonc`). The Nitro `cloudflare:scheduled` hook is handled by
`server/plugins/graphics-reconciliation-schedule.ts`; a failed pass is logged and
swallowed so it can never take the Worker down.

A reconciliation pass is a comparison, not a correction. It never creates,
redirects, or removes a Graphic Asset identity, revision, or reference, so a
missed or delayed run leaves an incident undetected for longer but can never
lose anything. Everything it observes is durable, in the Evidence ledger and in
the discrepancy queue.

## The authority contract

This is the question #42 left open, and the answer both readers and
reconciliation now follow:

- **D1 is authoritative for expected reachability.** It decides which Graphic
  Asset Content the library should be able to resolve. An observation of the
  byte store never creates catalogue state.
- **The canonical byte store is authoritative for present bytes.** Every reader
  that needs bytes asks it directly and compares the answer against the
  catalogue's recorded size and canonical media type. Template Package export
  does this too, which is why it never trusted the flag.
- **`graphic_asset_contents.availability` is advisory reconciliation state, not
  a reader authority.** D1 can still say `available` between a byte loss and the
  next pass, and `unavailable` after the bytes came back, so trusting it would
  either serve content that is not there or deny content that is. The flag
  exists so a known incident stays visible, alertable, and repairable between
  passes.

Coherence comes from making readers feed the flag rather than read it. When a
reader observes the byte store _answering_ and disagreeing — the object is
missing, or its size or media type contradicts the catalogue — it reconciles
exactly that content immediately, so the incident becomes durable operational
state without waiting for the schedule. A byte store that could not answer at
all proves nothing about any individual object and is deliberately ignored.

Reconciliation is the only writer of the flag, and it clears the flag as soon as
the byte store agrees again.

## What a pass does

1. **Compares every expectation**, least recently compared first, so one bounded
   pass eventually covers the whole catalogue.
   - Object missing, reached by a revision → Unavailable Graphic Asset Content
     with a persistent open discrepancy. Every identity and reference is
     untouched, and the revision resolves as retryably unavailable, never as
     missing.
   - Object missing, reached only by a Graphics Derivative → a missing-derivative
     discrepancy, which can be regenerated rather than repaired.
   - Object present but its size, canonical media type, or redundant digest
     metadata contradicts the catalogue → a **critical integrity incident**. It
     fails closed, is isolated, and offers no action but a recheck.
   - Object agrees → any non-isolated incident about it is resolved and the
     advisory flag is cleared.
2. **Scans the canonical byte store** for bytes the catalogue never asked for,
   from a cursor persisted between passes.
   - A digest-owned key the catalogue does not account for is quarantined for
     the same seven-day recheck the retention path enforces, and is **never
     adopted**. The retention sweep deletes it only after re-proving it is still
     unreachable; if an ordinary publication claims those bytes in the meantime,
     the quarantine is released instead.
   - A key that is not a digest-owned identity is isolated as a critical
     integrity incident and never deleted automatically.
3. **Reclaims stale working copies** left by a repair or regeneration that never
   finished, using the same durable-claim-outlives-the-byte-work pattern the
   retention path uses for quarantine deletion.

## Administrator actions

Every discrepancy reports exactly the actions valid in its state, and the API
offers nothing else. There is deliberately no adopt action.

- `GET /api/admin/graphics-assets/reconciliation` — the authority contract, open
  counts by kind, and every open discrepancy with its structured evidence,
  affected pinned usage, and valid actions.
- `POST /api/admin/graphics-assets/reconciliation` — runs the identical pass on
  demand. Safe at any time; it cannot change what the catalogue expects.
- `GET /api/admin/graphics-assets/discrepancies/<id>` — one discrepancy's detail.
- `POST /api/admin/graphics-assets/discrepancies/<id>/actions` — `recheck`,
  `restore-quarantined-copy`, or `regenerate-derivative`.
- `PUT /api/admin/graphics-assets/discrepancies/<id>/repair` — exact-byte repair.
  The raw body is the exact content; the expected length comes from the
  discrepancy, so a body of any other length is refused before it is stored.

All of them require the `x-graphics-admin-token` administrator header.

### What repair will and will not accept

Exact-byte repair stages the supplied bytes first and proves, in order, that
they are exactly `expected.byteLength`, hash to the exact expected SHA-256, pass
Graphic Asset Validation, carry the same canonical media type, and reproduce the
validation facts the revision recorded. Only then are they written under their
digest-owned identity with create-if-absent and the same redundant digest
metadata publication writes.

A successful repair creates no Graphic Asset Revision and changes no Graphic
Asset Reference; it restores bytes the catalogue already expected.

Runtime attestations — browser decode, muted inline playback, transparency
rendering, font loading, glyph rendering — are excluded from the facts
comparison. They were made about these exact bytes at ingestion, and an exact
SHA-256 match already proves the bytes are the same ones.

**Isolated critical integrity incidents are never repaired.** Repair, restoration,
and regeneration all refuse them, and the availability flag cannot be cleared
while one is open. Resolving a digest-key conflict is a deliberate operator
decision made with knowledge this system does not have.

### Restoring a quarantine copy

`restore-quarantined-copy` is offered when quarantined bytes are still holding an
exact copy of content the catalogue has marked unavailable. It re-reads and
re-hashes the copy in full — metadata agreeing is not proof of the bytes — and
only then releases the quarantine and clears the flag. A copy that hashes to
anything other than the digest owning its key is isolated as a critical
integrity incident and left exactly where it is.

### Regenerating a derivative

`regenerate-derivative` reproduces a missing thumbnail, video poster, or font
specimen from available canonical source content, and is offered only while that
source resolves. The result must reproduce the exact bytes the catalogue already
recorded for that derivative; anything else is a determinism failure, is isolated
as a critical integrity incident, and nothing is written. The source revision is
never mutated.

Silent-video posters are reproduced through the pinned validation runtime, which
reads staged sources, so regeneration streams a working copy of the canonical
source into staging under the identity it has already claimed. A crashed
regeneration leaves that claim behind and the next pass reclaims the bytes.

## Why this is a direct Cloudflare dependency

The pinned `@nuxthub/core` 0.10.8 public runtime interface exposes no scheduled
trigger and no object-store listing with the conditional and metadata semantics
this path needs. This is the same approved scheduled-trigger exception recorded
in the NuxtHub Integration Guardrail in #28, and the same Graphics Object Store
exception:

- all authoritative reconciliation state stays in `hub:db` (discrepancies, the
  scan cursor, content quarantine, and the Evidence ledger are ordinary D1
  tables);
- all byte access, including the new bounded paginated listing, stays behind the
  Graphics Object Store interface; and
- the library's public interface is provider-independent, so the same pass runs
  from the administrator API route and from module tests with no Cloudflare
  involvement.

Reassess this exception when `@nuxthub/core` is upgraded.
