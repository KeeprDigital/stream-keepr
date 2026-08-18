# Context

Domain vocabulary for Stream Keepr. Use these terms when naming modules, seams, tests, and architecture notes.

## Language

**Event**:
A competitive gaming tournament managed by Stream Keepr.

**Phase**:
A segment of an Event structure, such as Swiss or Top Cut.

**Round**:
A unit of tournament play within a Phase, containing Matches and optional tournament-state metadata synced from Melee.

**Match**:
A pairing between Players in a Round, including results and records used for standings and broadcast workflows.

**Round Results Overview**:
The operator-facing summary of Match results for a Round.

**Round Standings**:
The standings for Players as of a specific Round.

**Player**:
A competitor in an Event.

**Talent**:
An Event-scoped broadcast presenter or commentator who may be selected for production graphics.

**Deck List**:
A Player's submitted cards for a game and Phase.

**Melee Sync**:
The workflow that imports and refreshes Event structure, Players, Deck Lists, standings, Matches, and Rounds from Melee.gg.

**Provenance**:
The Melee-owned identity and lifecycle facts on a synced record: its external identity, sync status, activity, and last-seen time. Only Melee Sync writes Provenance; manual operator edits never carry it — the server resolves it itself.
_Avoid_: external fields, sync metadata.

**Feature Match Slot**:
A reusable production control lane for showing one featured Match at a time, using mutable display/control snapshot data. The converse also holds: a Match occupies at most one Slot, enforced by the database.
_Avoid_: Feature Match when referring to the reusable lane.

**Feature Match Assignment**:
A Round-scoped selection of which Match appears in which Feature Match Slot.
_Avoid_: Feature Match when referring to the saved Round selection.

**Feature Match Note**:
A free-text production note attached to a Feature Match Assignment.

**Feature Match Session**:
The live state timeline for a Feature Match Slot.

**Feature Match Slot Promotion**:
The workflow that promotes a Match into a Feature Match Slot for production controls and saves the Round-scoped Feature Match Assignment.

**Screen**:
A broadcast or control surface that can show Feature Match Slot output, decks/cards, standings, or other prepared content.

**Screen Mode**:
A rendering mode for a Screen, such as Idle, Card, Deck, Standings, Top Cut, Feature Match, Feature Match Overlay, Metagame, or Player History.

**Metagame**:
Analysis of Players, Deck Lists, cards, archetypes, and standings within an Event or scoped Player group.

**Archetype**:
A strategic Deck classification assigned to Players and used for Metagame analysis.

**Realtime Event Session**:
The client-side subscription for Event messages.

**Reconnect Resync**:
The client-side module owning the invariant "coming back from a disconnection is itself a reason to re-read authoritative state." A realtime message is a notification and the server holds the authority, so a client that was away was told nothing and is told nothing late — no notification arrives to say it fell behind, and only announcements carrying a sequence number can reveal a gap at all. A resync re-reads, and never clears: a disconnected Screen Output holds its last accepted rendering, because a dropped websocket is not an instruction to blank the show. It exposes the disconnection rather than acting on it, so a control surface can disable its actions and say so while an output on program does neither.
_Avoid_: reconnect handler, resubscribe hook.

**Guarded Sequence**:
The client-side module owning the invariant "discard the result of async work that newer work has superseded." Scoped or keyed; issues Flights.
_Avoid_: generation counter, version guard, latest-wins map.

**Flight**:
A ticket for one unit of supersedable async work, checked for staleness after each await. Staleness is monotonic.
_Avoid_: request id, generation.

**Field Ownership**:
The set of fields one action may write, derived from the change the action predicts. The term is load-bearing on both sides of the wire and governs a different thing on each.
Client-side it is a scope rule: one optimistic action owns the fields its predicted change writes, result merges and rollbacks write only owned fields, and remote updates never overwrite fields another action currently owns.
Server-side it is an acceptance rule, carried as a Field Ownership claim: a Set Input or Set Override states the value it believes it replaces, and the authoritative side compares that claim against the effective value Live Control showed its operator — an override first, then a resolving Graphic Input Binding, then the working value resolved against the declared default. A claim that still describes what its operator saw is applied; one another operator has overtaken is refused, so the loser is shown what landed rather than silently erasing a colleague's correction. A command carrying no claim is making none and is applied unconditionally.
The claim is checked inside the reduction rather than before it, so a command that is re-reduced onto a newer state has its claim re-checked against the state that won.
_Avoid_: owns array, field mask, declared ownership.

**Sequenced Live State**:
The server-side module owning the invariant "one authoritative order of accepted commands per live aggregate." Loads an aggregate and executes a command; owns monotonic sequencing, compare-and-swap protection, Command Receipts, and the decision to announce a committed command. Domain reducers, merge policies, and what a notification says stay with the feature that uses it.
It tells the announcement which aggregate the command was reduced onto, because only this module knows: a merge retry re-reduces onto a reloaded aggregate, and a command recognised as a repeat is answered with a snapshot that may be newer than the command being repeated, so for that one there is no such aggregate to name.
_Avoid_: event store, event sourcing, command bus, write-ahead log.

**Command Receipt**:
The record that one command ID was already accepted for a live aggregate, holding the command's canonical content so a retry of the same command can be answered with the current authoritative snapshot and a reuse of the ID with different content can be rejected. Retained for a bounded window of recent commands, not as history.
_Avoid_: event row, command log, audit record, idempotency key.

**Event Data**:
The client-side access path for Event-scoped data such as Players, Phases, Rounds, Matches, Feature Match Slots, Feature Match Assignments, Screens, Talents, Archetypes, and Player Lists.

**Screen Mode Definition**:
The definition of a Screen Mode, including defaults, configuration shape, data preparation, and rendering contract.
It also owns the Screen host contract: whether the mode renders as an overlay or control surface, how screen-level width, height, padding, background, alignment, viewport-fit scaling, and theme policy apply, and any mode-specific host defaults.
Generic Screen configuration UI policy, such as container controls, dimension defaults, reset defaults, and output options, belongs with the Screen Mode Definition rather than the Screen configuration page.

**Feature Match Overlay**:
A Screen Mode that renders a production-ready Feature Match Layout for a Feature Match Slot, including external video source areas, Graphic Items, frame graphics, and fill/key outputs.
_Avoid_: Generic overlay editor

**Broadcast Graphics Screen**:
A Screen in Broadcast Graphics mode whose output composes an ordered stack of concurrently visible Broadcast Graphics.

**Broadcast Graphics Live Session**:
The continuous playout epoch of a Broadcast Graphics Screen. It survives reloads, disconnections, and restarts, but ends when the Screen changes away from Broadcast Graphics mode or its live state is explicitly reset.
Commands from an ended Broadcast Graphics Live Session can never affect a later one.

**Broadcast Graphics Live State Change**:
What one accepted command changed about a **Broadcast Graphics Live Session**'s live state, named per **Broadcast Graphic** for each of the maps live state is keyed by, and carried by the realtime notification instead of the live state itself.
A peer holding the sequence immediately before applies it and lands on exactly the state the authoritative side committed; a peer that is offered none reloads the authoritative snapshot, which is what it already does for a sequence gap. It is offered none when the change is too large to deliver, when the command was a recognised repeat, and when live state holds something a change cannot describe — so the notification is bounded whatever the show's size, and the settled rule that realtime is notification and snapshots are authority is kept without a reload between an operator pressing Take and program showing it.
_Avoid_: patch, delta, diff, partial state, incremental update.

**Broadcast Graphics Recovery Fault**:
Why the durable live state behind a Broadcast Graphics Live Session snapshot could not be trusted, when it could not: it is missing, it is corrupt — present but not the shape of live state — or it is incompatible, the right shape holding a value of a type this build cannot interpret, which is what state written under a different vocabulary looks like from here. It carries the detail of what could not be read so an operator can report it.
It is derived from the stored state on every read rather than recorded, and while it stands the state every reader acts on is replaced by one with nothing on air and no accepted values, so no output renders half an unreadable session. The first command the session accepts clears it, because every reduction starts from that replacement and the write that commits the command replaces the state nobody could read; in practice that command is the explicit Take that puts the show back on air.
A stale animation start time is not a fault. Graphic Animation projections are monotone in the current instant and saturate at the **Graphic Resting State**, so a start time from before a restart has already passed its phase duration and settles there without anything detecting or clearing it. Only a non-numeric start time is incompatible, because it leaves every phase comparison false and nothing to settle at.
_Avoid_: corrupt state flag, live state validation error.

**Broadcast Graphic**:
An authored visual composition that an operator shows, hides, and controls as one unit on a Broadcast Graphics Screen.

**Broadcast Graphic Template**:
A user-created reusable Broadcast Graphic that can be copied into a Broadcast Graphics Screen and transferred between Events. Templates are not live Screen state.
Each library Template has a stable identity and an automatically managed revision. Importing or placing one creates an independent copy with no update link; an import retains the source identity and revision only to recognise related packages.

**Graphics Authoring Lease**:
The exclusive, session-scoped right to edit one graphics authoring artifact: a Screen's complete graphics Edit workspace or one reusable graphics Template.
Other sessions may observe accepted authoring changes but cannot modify the leased artifact.

**User**:
An account an administrator created for one person, holding the credential they sign in with and the name every surface shows for them.
It is the installation's only durable identity and the one that owns work: a Graphics Ingestion Operation records the user as its initiator, idempotency keys are unique within the user, and the Evidence Ledger names the user as actor with the display name resolved when the ledger is read.
Because ownership belongs to the person rather than to a browser, an operation survives the browser that started it and is resumed by signing in anywhere; the same idempotency key sent from a second browser continues the first operation instead of starting a second.
There is no self-signup: an administrator creates the account, and a single-use expiring reset link is how its password is first set (ADR-0010).
_Avoid_: author, graphics author — those name a role a user may be acting in, not the identity; account is acceptable when the subject is the credential rather than the person.

**Session**:
One signed-in browser: server-side, revocable, and expiring seven days after its last day of use.
It is what admits a request — the deny-by-default API boundary over `/api/**` requires one (ADR-0010, which supersedes ADR-0008's perimeter-trust stance) — and it is the granularity of a Graphics Authoring Lease, because one person signed in from two browsers is two concurrent editors and a lease held per user would let them overwrite each other in silence.
A session never owns work; it says which browser is asking, and the takeover surface resolves it back to a user for display.
_Avoid_: Graphics Author Session — the anonymous self-issued identity this replaced, retired at ADR-0010's cutover; login, which names the act rather than the thing.

**Graphic Style Set**:
A named reusable authoring resource in the shared scope of the graphics template libraries that maintains a cohesive visual and motion language across independently portable Broadcast Graphic Templates and Feature Match Layout Templates.
Events consume Graphic Style Sets through either template kind but do not own them.
It contains named values and bounded presets for the shared graphics vocabulary, but never reusable Graphic Item trees or layout structure.
Its initial entry kinds are named palette colours, typography presets, Graphic Fill and Graphic Surface Style presets, media treatment presets, Shape Geometry presets, and Graphic Animation Recipe presets.
Its palette is an open-ended collection of freely named entries with stable identities; each entry stores one opaque colour rather than a fixed application role or whole-Style-Set colour.
Opacity belongs to the consuming style property, and presets may reference multiple palette entries.
Its typography presets contain a font reference, weight, style, size, case transform, letter spacing, line height, and palette-linked text colour.
A Text Graphic Item's base typography or Graphic Placeholder Style may reference one, while alignment, Text Overflow Policy, content, and placeholder mappings remain item-specific.
Its Graphic Fill presets are either a solid palette reference or a linear gradient of two to four palette references with stop positions, stop opacities, and an angle.
Its Graphic Surface Style presets may reference one Graphic Fill preset and add fill opacity, uniform outline treatment, and glow treatment; Shape Geometry remains a separate preset.
Its media treatment presets contain fitting, focal position, opacity, an optional Shape Geometry preset reference for clipping, and optional silent-video playback-rate and looping defaults.
They never select a media asset, and image items ignore their video-only properties.
Its Shape Geometry presets contain only per-corner square, rounded, or cut treatment and bounded left or right edge slants.
Bounds, position, size, Graphic Anchor Point, and Graphic Rotation remain item-specific.
Each Graphic Animation Recipe preset contains one bounded fade, slide, scale, and reveal combination with duration, easing, optional delay, and on-screen-only repetition defaults.
Templates assign presets to lifecycle phases and retain item selection, staggering, and cross-item choreography locally.
Its typography presets reference application fonts only, because a Graphic Style Set Package carries no asset files; a Graphic Item's own typography may instead reference a font asset from the Graphics Asset Library.
It references no Graphics Asset Library content at all, and never owns or duplicates asset files.
Media treatment presets define presentation without selecting an image or video; each graphics template selects its actual media from the Graphics Asset Library.
Each Graphic Style Set has a stable identity and managed revision; each entry has a stable identity, kind, and schema version.
Renaming a Graphic Style Set or entry preserves its identity, while an entry's kind cannot change in place.
Edits accumulate in a working draft; one explicit atomic publish validates entry references, cycles, schemas, and asset availability before creating a Style Set revision and identifying affected templates.
Publishing is the only way a draft edit becomes published, with one exception: deleting a published entry removes it from the published entries and creates a Style Set revision without a publish, because an entry left published would keep every linked template resolving against something already deleted. For the same reason a replacement entry must itself already be published.
Graphics templates linked to a changed Graphic Style Set receive an available style update that an author must explicitly review and apply as a new template revision.
An update is available only when a referenced entry or one of its transitive dependencies changes in resolved style, schema, or asset dependency; unused changes and renames do not revise a template.
Placed Broadcast Graphics and Screen-owned Feature Match Layouts never receive Graphic Style Set changes automatically.
A linked graphics template retains references to Graphic Style Set entries and records local deviations as explicit property-level overrides.
Applying a Graphic Style Set update changes inherited properties while preserving those overrides.
Applying an update is atomic for one template and creates one new template revision.
During review, an author may preserve a previous resolved property as a new local override, but cannot leave inherited references on a mixture of Style Set revisions.
Each Broadcast Graphic Template or Feature Match Layout Template links to at most one Graphic Style Set.
Graphic Style Set entries may reference entries in the same set but never entries in another Style Set, and Style Sets do not inherit from or compose one another.
A template adopts a Graphic Style Set without a bulk-mapping workflow: authors select entries directly in existing property controls, and every unselected property remains local.
Deleting a referenced entry offers one atomic operation to replace its references with another entry of the same kind or detach them by freezing their resolved values into new template revisions.
Deleting a whole Graphic Style Set offers detachment only: replacing one Style Set with another would mean matching entries between two independently authored sets, which is the bulk-mapping workflow adopting a Style Set already rules out.
Either deletion occurs only if every affected template update succeeds.
Export resolves every used entry into a self-contained template snapshot while retaining the source Graphic Style Set and entry identities, revisions, kinds, schemas, and value hashes as provenance.
Importing a Broadcast Graphic Template or Feature Match Layout Template never requires, creates, or modifies a Graphic Style Set; it may explicitly relink the template to an installed Style Set with matching identity and structurally compatible entries after showing the resulting differences.

**Graphic Style Set Package**:
A single-Style-Set portable artifact, using a separate `.skstyle` archive, that transfers one Graphic Style Set without containing a Broadcast Graphic Template or Feature Match Layout Template.
It declares the application fonts its typography presets require rather than carrying asset files, and a receiver missing one refuses the package.
It uses the Template Package principles of data-only contents, strict validation, stable identity and revision provenance, conflict-safe installation, and atomic import.
The first import preserves the packaged Style Set identity and revision; an exact identity, revision, and content hash is already installed.
A newer related revision may explicitly update the installed Style Set through its ordinary publish and affected-template review flow, while an older revision never silently downgrades it.
The same identity and revision with different content is a conflict, and any related or conflicting package may instead install as an independent copy with a new identity; imports never field-merge Style Sets.
A package carries the published revision frozen whole, so a Graphic Style Set that has never been published has nothing to export.
An installed Style Set that has never been published has no revision a package can be newer, older, or the same as, so an import over it is refused and the independent copy is offered instead.
Unpublished draft changes an update would discard are named in what its author confirms rather than refusing the update, and the write is conditional on that exact draft.
An independent copy is published at its own first revision, and the packaged identity and revision travel with it only as the import's own report.

**Template Package**:
A single-template portable artifact used to transfer either one Broadcast Graphic Template or one Feature Match Layout Template.
Both template kinds share the package envelope, asset handling, validation, migration, conflict, and atomic installation contract while retaining separate payloads, libraries, and import/export workflows.
_Avoid_: Mixed template package, Event-wide template package

**Graphic Input**:
A named, required-or-optional presentation value declared by a Broadcast Graphic Template, with a type of text, number, toggle, choice, color, or media. It may be entered manually or resolved from a type-compatible Event Data field, but never exposes a whole Event Data entity to the Broadcast Graphic.

**Graphic Source Selection**:
A named, single-entity Event Data selection owned by a placed Broadcast Graphic. It resolves from the current Event, an operator selection, or a fixed relationship from another Graphic Source Selection; it is not a collection query.

**Graphic Input Binding**:
An Event-specific, type-compatible mapping from a Graphic Input to one broadcast-facing field on a Graphic Source Selection. Binding fields come from a curated stable catalog rather than directly exposing Event Data storage or API properties.

**Graphic Input Override**:
An operator-supplied typed value that takes precedence over a Graphic Input Binding without replacing it. It persists across hide/show cycles until cleared, while the binding continues resolving underneath it.

**Graphic Input Status**:
What Live Control reports about one Graphic Input's value: manual, bound, overridden, pending, unavailable, superseded, or stale.
Manual has no Graphic Input Binding and shows what an operator typed or the declared default. Bound has one resolving it that program already agrees with. Overridden has a Graphic Input Override masking a binding that keeps resolving underneath. Pending means the value that would go on air differs from the one that is. Unavailable means there is nothing that could go on air — an unresolved binding, or a value violating its declared type or constraints. Superseded means this operator's last edit lost a field-scoped race and the field has been refreshed to the value that won. Stale means on air and holding a last accepted value its Graphic Input Binding no longer provides, which is program having outlived its source rather than a value to fix; it needs a binding, so an operator's own unusable edit or override is unavailable instead, and it is reported for any bound input rather than only a required one.
One Graphic Input can be in several of these positions at the same instant, so the reported status is the first that applies in order of urgency: superseded, stale, unavailable, overridden, pending, bound, manual. Superseded outranks even stale because "look again, someone beat you" is the one an operator can act on immediately.
Command rejection codes are a separate vocabulary: they describe a command's fate rather than a value's.
_Avoid_: stale-input-edit, command rejection codes when naming a value's status.

**Live Control**:
The operator-facing controls generated for a placed Broadcast Graphic from its Graphic Source Selections and Graphic Inputs. It selects declared sources, edits values and overrides, stages updates, and controls playout without authoring bindings, custom controls, queries, or expressions.

**On-air Update Policy**:
The rule that determines whether a Graphic Input change is staged for operator confirmation or applied immediately to an on-air Broadcast Graphic. Staged values are accepted atomically through Update Graphic; a template recommends the policy and the operator may override it for a placed graphic.

**Graphic Text Template**:
A string that combines literal text with `{inputKey}` placeholders for Graphic Inputs, rendered by a text Graphic Item. Placeholders reference stable input keys and do not contain property access, formatting, fallbacks, conditionals, or expressions.
_Avoid_: Expression when referring to placeholder substitution

**Graphic Placeholder Style**:
An optional typography-only override for one `{inputKey}` placeholder in a Text Graphic Item.
Literal text uses the Text Graphic Item's base typography, and placeholder styles do not add rich-text ranges, markup, fills, outlines, or other surface styling.

**Graphic Font Selection**:
Which font a Graphic Item's typography or Graphic Placeholder Style paints with: one application font that ships with Stream Keepr, or one exact font Graphic Asset Revision from the Graphics Asset Library.
The library choice is an ordinary Graphic Asset Reference, so a Screen Output resolves it through its Screen Output Asset Capability and a Template Package embeds it; an application choice is declared rather than carried.
_Avoid_: Font family, font stack

**Text Overflow Policy**:
The bounded behaviour when a Text Graphic Item's rendered text exceeds its authored bounds: clip, ellipsis, or shrink to an author-set minimum font size and then ellipsis.
Text does not render with visible overflow beyond its authored bounds.

**Graphic Item**:
A visual part within a Broadcast Graphic or Feature Match Layout, such as text, media, or a shape. Graphic Items are edited individually but are not taken on or off air independently of their containing composition.
_Avoid_: Element

**Graphic Item Definition**:
The application-owned contract for one Graphic Item kind: its stable identifier and configuration version, schema and defaults, editor metadata and bounded controls, renderer behaviour for every output, configuration migration, and asset-reference discovery.
New Definitions ship with Stream Keepr and are reserved for behaviour that cannot be composed from the shared base Graphic Item kinds; templates never provide executable definitions.
Importing a Broadcast Graphic Template fails atomically when any referenced Definition or configuration version is unsupported.
A Definition may declare a required host or data context; editors offer it only where that context can be supplied.

**Shared Graphics Foundation**:
The Graphic Item, geometry, styling, grouping, animation, definition, and rendering vocabulary used by both Broadcast Graphics and Feature Match Overlay.
It unifies their composition model without merging their Screen Modes, live context, or template artifacts.

**Host Contract**:
The declaration a graphics Screen Mode supplies when embedding the shared compositor: its available context kinds, top-level host extras, canvas rules, and write semantics.
The definition palette, binding catalogue, and editor behaviour follow from it; capability outside the contract stays host-owned.

**Graphics Asset Library**:
The shared graphics-specific module that ingests, validates, stores, resolves, deduplicates, and lifecycle-manages images, silent videos, fonts, and generated thumbnails used by Broadcast Graphics and Feature Match Overlay.
Its interface is consumed by both graphics editors and their Template Package workflows; it is not a general application file manager.

**Graphics Asset Library Capacity**:
The installation-wide storage envelope comprising the Canonical Graphics Quota and Graphics Staging Allowance.

**Canonical Graphics Quota**:
The limit on deduplicated retained Graphic Asset Content and Graphics Derivative bytes, including retained revision history and Trash.

**Graphics Staging Allowance**:
The separate limit on provisional bytes reserved or held by incomplete Graphics Ingestion Operations.

**Canonical Capacity Pressure**:
The normal, warning, critical, or full state derived from use of the Canonical Graphics Quota.

**Graphics Administrator**:
An installation operator authorised to inspect Graphics Asset Library health and change installation-wide Graphics Asset Library Capacity limits.

**Library Workspace**:
The graphics-author-facing surface over the Graphics Asset Library, where an author discovers and ingests Graphic Assets, renames and re-associates them with Events, inspects their recovery and cleanup state, and moves them through Retire, Trash, and Restore.
It works as the signed-in User and is the author-facing counterpart to the administrator-only Operations Cockpit.
_Avoid_: Graphics Asset Library Workspace, asset manager, library page

**Graphic Asset**:
A stable-identity library resource for a validated image, silent video, or font owned by the installation-wide Graphics Asset Library and reusable across Events.
Events may associate with or reference a Graphic Asset but never own it.

**Retired Graphic Asset**:
A Graphic Asset hidden from normal discovery and unavailable for new references while every existing pinned Graphic Asset Reference continues to resolve.
It may be restored to active selection and is not deleted or considered unreferenced merely because it is retired.

**Trashed Graphic Asset**:
An unreferenced Graphic Asset removed from discovery and protected from new references while its identity, revisions, metadata, origins, and Event associations remain restorable for 30 days.
It becomes eligible for irreversible purge only after that recovery window and a fresh proof that no Graphic Asset Reference points to any revision.

**Graphic Asset Content**:
One immutable validated byte payload and its technical media facts, identified by an application-computed SHA-256 digest of its exact stored bytes.
Its identity excludes filenames, declared media types, and other library metadata.

**Graphic Asset Revision**:
An immutable content-bearing version of one Graphic Asset, created when that asset's file content changes.
Changing its library-wide descriptive, organisational, or origin metadata does not create a revision.

**Graphic Asset Reference**:
A persisted link from one graphics artifact to one exact Graphic Asset identity and revision, identifying the owning artifact and its Event context when applicable.
An asset revision is in use exactly when at least one Graphic Asset Reference points to it.

**Graphic Asset Origin**:
The immutable source asset identity, source revision, and content digest attached to the exact local Graphic Asset Revision created when a Template Package installs Graphic Asset content.
It recognises exact or related later imports without creating a cross-installation identity, ownership, or update link.

**Missing Graphic Asset Reference**:
A Graphic Asset Reference whose asset identity or pinned revision does not exist.
It is an integrity failure and never follows another revision or substitutes content automatically.

**Unavailable Graphic Asset Content**:
The retryable state in which a referenced Graphic Asset and revision exist but their content cannot currently be resolved.
It never changes or redirects the Graphic Asset Reference.
The catalogue's record of it is advisory state that Graphics Reconciliation maintains and readers never treat as authority; a caller that needs bytes always asks the byte store, which is the only current source.

**Graphic Asset Validation**:
The strict acceptance process that proves exact source bytes are safe, supported, decodable, and internally consistent without converting, normalising, repairing, or otherwise changing them.
Unsupported source content is rejected; generated previews remain separate Graphics Derivatives.

**Graphic Asset Compatibility Profile**:
The versioned contract of accepted source formats, technical bounds, validation rules, and output requirements applied uniformly to every Graphic Asset ingestion path.
Each accepted Graphic Asset Revision records the profile and verified technical facts under which it was accepted.

**Graphics Ingestion Operation**:
A durable, reconnectable workflow through which the Graphics Asset Library receives a local upload, approved remote copy, file replacement, or Template Package and either publishes the complete result atomically or publishes nothing.
Its provisional content is never discoverable or referenceable.

**Template Package Preflight**:
The complete inspection a received Template Package passes before anything may be installed from it, run as a Graphics Ingestion Operation over durably staged archive bytes.
It proves archive safety and envelope limits, migrates a supported older schema deterministically in staging, revalidates every embedded source under the receiver's current Graphic Asset Compatibility Profile, regenerates the required Graphics Derivatives locally, and produces one Template Package Preflight Report.
It only ever proposes: preflight never installs a Graphic Asset, revision, origin, reference, or Template.

**Template Package Preflight Report**:
The one immutable result of Template Package Preflight, carrying migrations, revalidation outcomes, compatibility profiles, naming and metadata differences, Template Package Mapping Proposals, quota impact, envelope limits, and every issue with a stable code and remediation.
Errors about the package itself terminate the operation permanently; an error about this installation's own exhausted canonical capacity is retryable and leaves the operation resumable. Warnings pause it exactly once for a confirmation bound to the report's Preflight Report Fingerprint.
_Avoid_: Import preview, dry-run result

**Preflight Report Fingerprint**:
The immutable identity of one exact preflight proposal, covering the received archive bytes, the compatibility profiles the content was judged under, the proposed mappings, and the issues they carry — and deliberately not the clock.
A confirmation is valid only for the fingerprint it names, so changed bytes, mappings, profiles, or proposals require a new report and a new confirmation, while a retry reaching an identical conclusion keeps the existing one.

**Template Package Mapping Proposal**:
How one packaged identity would become a local Graphic Asset, decided by provenance rather than by content alone.
An exact Graphic Asset Origin match reuses the existing local revision untouched; a related source revision, a digest-only content match, or entirely new content each create a separate local Graphic Asset that reuses canonical bytes when the digest already exists.
The same origin identity and revision carrying a different digest is an immutable-provenance conflict that rejects the complete package.

**Template Package Installation**:
The one atomic act that turns a confirmed Template Package Preflight Report into local state.
It re-derives the report from the same staged bytes and installs only while the conclusion is still the one the author confirmed; a changed library, compatibility profile, or proposal returns the operation for a new confirmation instead.
Canonical bytes and Graphics Derivatives are written and verified first, then one transaction publishes every new Graphic Asset, Graphic Asset Revision, Graphic Asset Origin, Event association, rewritten Graphic Asset Reference, the Installed Graphics Template, and the operation's terminal result together.
Repeating it answers with the installation that already committed rather than publishing a second one.

**Installed Graphics Template**:
The independent local copy of the single graphics Template a Template Package carried, created by Template Package Installation with its own installation-owned identity and managed revision.
Its Graphic Asset References are already rewritten to exact local identity and revision pairs, so it is valid the instant it becomes visible, and those references are the authoritative usage protecting every revision it pins.
It records the packaged Template's source identity as provenance only; there is no live link to the installation that exported it, and copying it onto a Screen copies it again.
_Avoid_: Imported template, template installation record.

**Graphics Derivative**:
A generated thumbnail or preview artifact managed by the Graphics Asset Library as a dependant of one source Graphic Asset or graphics Template revision.
It inherits its source's access and lifecycle and is never a discoverable or selectable Graphic Asset.

**Graphics Retention Sweep**:
The scheduled pass in which the Graphics Asset Library reclaims only state it has just proven unreachable past its complete recovery guarantee.
It expires staged input, maintains Revision Pruning deadlines, purges eligible Trash, and collects unreachable Graphic Asset Content; a missed or delayed sweep only ever retains state for longer.

**Revision Pruning**:
The removal of a superseded Graphic Asset Revision that no Graphic Asset Reference reaches, 90 days after it became unreferenced.
An asset's latest revision and every referenced revision are never pruned, a new reference cancels pruning, and Trash freezes the remaining time so restoration resumes rather than restarts it.

**Graphic Asset Tombstone**:
The durable proof that a Graphic Asset identity was purged, recording when, why, how many revisions the reference proof covered, and that it found no references.
It outlives the catalogue state it replaces so asynchronous byte deletion cannot resurrect the asset and re-ingestion can never reuse the purged local identity.

**Early Purge**:
An explicitly confirmed Graphics Administrator action that purges an unreferenced Trashed Graphic Asset before its 30-day recovery window elapses.
It performs the same fresh reference proof, tombstone, and atomic removal as scheduled purge, and is the only way to reclaim Trash early; storage pressure never shortens the window on its own.

**Content Quarantine**:
The holding state for Graphic Asset Content whose final reachability has disappeared, kept for seven days and rechecked against the catalogue before any byte is deleted.
Content that a retained revision or Graphics Derivative reaches again is released instead of deleted.

**Graphics Reconciliation**:
The pass, run on a schedule and when a reader observes an integrity failure, in which the Graphics Asset Library compares the Graphic Asset Content the catalogue expects to reach against the bytes the canonical store actually holds.
The catalogue is authoritative for expected reachability and the byte store only for present bytes; a byte observation never creates, redirects, or removes catalogue state.

**Graphics Discrepancy**:
One durable disagreement between the catalogue and the canonical byte store, carrying its structured evidence, the pinned usage it affects, and exactly the actions valid in its current state.
It identifies its subject by opaque domain identity and never exposes an object key, content digest, or bucket.

**Critical Integrity Incident**:
A Graphics Discrepancy in which stored bytes contradict the digest that owns their key, or an object contradicts the redundant integrity metadata it was written with, or a canonical object has no digest-owned identity at all.
It fails closed, is isolated from repair, regeneration, and automatic deletion, and is never resolved by overwriting bytes or mutating metadata.

**Exact-Byte Repair**:
The Graphics Administrator action that restores Unavailable Graphic Asset Content from supplied bytes proving the same application SHA-256, byte size, canonical media type, and Graphic Asset Validation facts.
It creates no Graphic Asset Revision and changes no Graphic Asset Reference.

**Deep Verification**:
The Graphics Administrator action that re-reads and re-hashes stored bytes in full against the complete expectation, detecting content that changed behind size and media type that still agree.
It writes nothing, is the only action valid on a Critical Integrity Incident, and restores an exact verified Content Quarantine copy by releasing that record.

**Derivative Regeneration**:
The reproduction of a missing Graphics Derivative from available canonical source content, without mutating its source Graphic Asset Revision.
It must reproduce the exact bytes the catalogue already recorded; anything else is a Critical Integrity Incident rather than a repair.

**Evidence Ledger**:
The chronological administrator-facing record of automated Graphics Asset Library lifecycle and reconciliation decisions, retained for one year after the cleanup it explains.
It identifies subjects by opaque domain identity and never carries object keys, content digests, filenames, delivery or signed URLs, capability secrets, or deleted bytes.
Each entry records the actor or automated policy, the transition either side of the change where the subject has named states, the checked reference count, bytes reserved or freed, the quota state observed, the deadline the decision established or acted on, the opaque operation and correlation identities, the outcome, and a stable reason.
An authoring metadata edit — a Graphic Asset rename or Event re-association — is not ledger material: it is not a lifecycle transition, it removes no Graphic Asset Reference and starts nothing toward cleanup, and like all library-wide metadata it is outside revision history, so recording it would make the ledger a general edit log rather than the record of why content was or was not cleaned up.

**Evidence Terminal Cleanup**:
The recorded event that says one Evidence Ledger subject will never be heard from again — a Graphic Asset purge, a Revision Pruning, a Graphic Asset Content deletion, a staged input expiry, or a settled Graphics Discrepancy.
It is the anchor for the one-year window: an entry has no expiry at all until its subject records one, so Evidence about a live subject is never destroyed by its own age, and Evidence written before a purge outlives that purge by the full year rather than expiring before the event it was written to explain.

**Evidence Sealing**:
The Graphics Retention Sweep stage that stamps the one-year expiry onto every unsealed Evidence Ledger entry whose subject has since recorded an Evidence Terminal Cleanup, anchored on the last such cleanup.
Sealing and expiry write no Evidence of their own, because entries about the ledger's own housekeeping would outlive the entries they explain and the next sweep would then have those to explain in turn.

**Evidence Category Group**:
The operational vocabulary the Evidence Ledger is filtered by — ingestion, lifecycle, pruning, purge, quarantine, reconciliation, repair, regeneration, and restoration — each naming a set of Evidence categories.
Groups overlap deliberately, because a restoration from Content Quarantine is both a restoration and a quarantine outcome and someone tracing either one needs to see it.

**Evidence Ledger Position**:
One place in the chronological Evidence Ledger, named by the recorded instant and the identity of the entry that shared it.
The ledger only grows, so it is paged by position rather than by offset: an offset would re-read everything already skipped and would shift under a sweep writing entries while the pages are being turned, and comparing the instant without the identity would repeat or lose entries recorded in the same millisecond.

**Operations Cockpit**:
The administrator-only surface that answers, in one reading, whether the Graphics Asset Library is safe and what currently needs attention.
It composes Library Component Condition, Storage Health Alerts, capacity against its exact boundaries, unfinished Graphics Ingestion Operations, the Graphics Discrepancy backlog, recovery and cleanup deadlines, and recent Evidence Ledger outcomes; it holds no state of its own, so every reading is reproducible from the catalogue.
_Avoid_: dashboard, storage admin panel.

**Library Component Condition**:
Whether one Graphics Asset Library component can answer at all, and whether what it holds agrees with the other side: healthy, degraded, or unavailable.
The catalogue and the canonical byte store are always judged separately and on their own durable evidence — the catalogue by the Unavailable Graphic Asset Content it records, the byte store by the Graphics Discrepancies observed in it — because a component that cannot answer and one that answers while disagreeing are different problems.

**Storage Health Alert**:
One open call on a Graphics Administrator's attention, classified critical, warning, or info, and derived from durable state rather than raised and remembered.
A persistent alert is backed by a record only an administrator action or a byte-store recovery can clear, so it survives navigation and reload until its subject is resolved.

**Graphics Ingestion Attention State**:
What an unfinished Graphics Ingestion Operation needs right now: its staged input has expired, it is retryable, it is awaiting its author's confirmation, or it is actively working.
Expiry is decided before stage, because an operation whose staged input passed its guarantee needs a new operation whichever stage it paused in; a terminal operation has no attention state at all.

**Operational Queue**:
One risk-ordered list of Graphics Asset Library work grouped by what is wrong with it rather than by the provider objects underneath, holding its complete size as a count and a bounded sample ordered by deadline proximity.
There is one queue per operational state — Critical Integrity Incident, Unavailable Graphic Asset Content, missing Graphics Derivative, retryable ingestion, expired staged input, unreleased staged input, Trashed Graphic Asset, superseded Graphic Asset Revision, quarantined object, and Retired Graphic Asset — and they stay distinct because the valid action differs in every one.
_Avoid_: work list, task list, incident bucket.

**Queue Inspector**:
The persistent administrator-facing detail surface for one selected Operational Queue item, showing its domain identity, current state, exact deadline, affected pinned usage, the catalogue's expectations beside the byte evidence, the Evidence Ledger filtered to that subject, and only the actions valid in that state.
Its selection lives in the address rather than in the surface, so it survives navigation and reload, and every reading is composed afresh so it can never describe a subject in a state that subject has already left.

**Queue Action Outcome**:
The one vocabulary every Operational Queue action reports in: completed, already-in-state, reference-blocked, retryable-unavailable, or integrity-conflict.
Every action is idempotent, so a second run reports already-in-state rather than a second success or a bare failure; already-in-state means the subject was already how the action asks for it, never that the action ran and fixed nothing.

**Text Graphic Item**:
A Graphic Item that renders literal text or a Graphic Text Template.

**Media Graphic Item**:
A Graphic Item that renders an image or silent video asset with contain, cover, or fill fitting; horizontal and vertical focal position; opacity; and optional Shape Geometry clipping.
Video media has playback-rate and looping controls and begins from its start when its Broadcast Graphic enters.

**Shape Graphic Item**:
A Graphic Item that renders a bounded Shape Geometry.

**Shape Geometry**:
A parameterised rectangle with independently configurable square, rounded, or cut corners and bounded left or right edge slant.
Rectangle, rule, slanted-edge, and corner-cut presets are authoring shortcuts that initialise the same Shape Geometry rather than distinct persisted types.

**Graphic Group**:
A structural Graphic Item that arranges direct context-available Graphic Items as a row, column, or canvas and may coordinate their clipping or animation.
Graphic Groups are not nested in the initial Shared Graphics Foundation vocabulary.
Row and column children use fixed main-axis sizing or weighted fill, and a Graphic Group may provide applicable local style defaults that each direct child can override.

**Graphic Surface Style**:
The shared visual treatment available to Text Graphic Items, Shape Graphic Items, and Graphic Groups: fill, fill opacity, a uniform outline around the Shape Geometry, and glow.
Typography belongs to the Text Graphic Item, media playback and fitting belong to the Media Graphic Item, and corners and slants belong to Shape Geometry.
An independently styled or animated edge is a Shape Graphic Item created from the rule preset rather than one side of an outline.

**Graphic Fill**:
A solid colour or a declarative linear gradient with an angle and two to four positioned colour stops, each with opacity.
Complex or procedural surfaces are Media Graphic Items rather than Graphic Fills.
_Avoid_: Raw CSS gradient

**Graphic Layer Order**:
The back-to-front list order of sibling Graphic Items within a Broadcast Graphic or Graphic Group.
A Graphic Group forms one layer among its siblings, and its children cannot escape that stacking context.
_Avoid_: Author-editable z-index

**Graphic Anchor Point**:
One of nine points on a canvas-positioned Graphic Item: top-left, top, top-right, left, centre, right, bottom-left, bottom, or bottom-right.
The selected point determines the item's displayed position and remains fixed while it is resized; stored geometry remains a top-left rectangle.
It is an editing and geometry reference, not a responsive constraint or an animation origin.

**Graphic Geometry Unit**:
An authoring projection of canonical pixel geometry or motion distance as pixels, a percentage of the containing canvas, or coordinates on a centred 32-unit grid.
Changing units changes how geometry or distance is displayed and entered, not how it is stored or rendered.

**Graphic Rotation**:
The optional static rotation angle of a canvas-positioned Graphic Item around its Graphic Anchor Point.
Row- and column-positioned items do not rotate, and the shared geometry vocabulary does not expose skew, perspective, or raw transform matrices.

**Graphic Animation**:
The recipe-based motion owned independently by a Broadcast Graphic or Graphic Item through enter, on-screen, update, and exit phases. Whole-graphic and item motion compose, and their timing and motion parameters may be adjusted without authoring arbitrary keyframes.
_Avoid_: Keyframe timeline, motion path, animated effect stack

**Graphic Animation Recipe**:
A bounded combination containing at most one fade, slide, scale, and reveal channel. Its channels run simultaneously with shared timing and easing, without an internal sequence or keyframes.

**Graphic Resting State**:
The authored geometry and appearance of a Broadcast Graphic or Graphic Item while settled on air. Graphic Animation Recipes move relative to this state and never change it.

**Graphic Animation Origin**:
One of nine points on a Broadcast Graphic or Graphic Item that determines the apparent origin of scale motion. It belongs to a scale channel, defaults to centre, and is independent of the Graphic Anchor Point.

**Graphic Animation Preview**:
Deterministic editor-only playback of one lifecycle phase or a full lifecycle for a Broadcast Graphic or selected Graphic Item. It may vary playback speed or loop an on-screen cycle, but never changes live Screen state and has no playhead, scrubbing, or keyframes.

**Cut**:
An execution modifier that makes Take, Update Graphic, or Out reach that action's target immediately without running its corresponding Graphic Animation phase. It never changes authored Graphic Animation Recipes or changes the visibility target of another action already in progress.

**Graphic Playout State**:
The operator-visible lifecycle status of a placed Broadcast Graphic: off, waiting, entering, on-air, updating, or exiting. Waiting means the graphic is selected by an Out then in Graphic Channel handoff but remains off every program output until the outgoing graphic finishes.
_Avoid_: Visibility when referring to lifecycle or transition status

**Graphic Channel**:
An optional playout lane on a Broadcast Graphics Screen that allows at most one of its Broadcast Graphics to be on air at a time. Broadcast Graphics in different channels may be on air concurrently.
_Avoid_: Layer when referring to mutual-exclusion behaviour

**Graphic Channel Handoff Policy**:
The per-Graphic Channel rule for replacing its selected Broadcast Graphic: Overlap starts the outgoing exit and incoming enter together, while Out then in waits for the outgoing exit to complete before starting the incoming enter.

**Feature Match Layout**:
The authored arrangement rendered by a Feature Match Overlay: the Frame, its Source Items, and one composition of ordered Graphic Items from the Shared Graphics Foundation.
The Frame and the Source Items are host-owned and each keeps its own list; the composition holds every Graphic Item.
It is portable by design so it can later be saved as a Layout Template.
_Avoid_: Overlay config

**Feature Match Overlay Frame**:
The continuous graphic area of a Feature Match Layout that sits behind and around Layout Items.
_Avoid_: Panel area, background panel

**Feature Match Layout Item**:
A Graphic Item placed in a Feature Match Layout.
Feature Match Layouts use the shared Graphic Item hierarchy rather than a separate Layout Item or Widget hierarchy.
_Avoid_: Region

**Source Item**:
A host-owned Feature Match Overlay element that places an external video source, with optional Frame cutout behavior and source framing style.
A Source Item is not a Graphic Item and is not interpreted by a Graphic Item Definition: it is host capability the Shared Graphics Foundation does not express, so it lives in the Feature Match Layout's own Source Item list rather than in the composition.
_Avoid_: Source Region, camera box, Source Graphic Item

**Widget Item**:
_Legacy implementation term._ Use the specific Graphic Item kind.
_Avoid_: Widget Item, Data Region

**Feature Match Overlay Preset**:
A built-in starting point that initializes a Feature Match Layout.
_Avoid_: Template when referring to the whole layout preset.

**Feature Match Layout Template**:
A user-created reusable Feature Match Layout that can later be copied into a Screen's Feature Match Overlay configuration.
Templates are not live Screen state: a Template carries no Feature Match Slot assignment, and placing one replaces the receiving Screen's whole Feature Match Layout as an unlinked copy.
_Avoid_: Preset when referring to user-owned reusable layouts.

**Feature Match Layout Host Vocabulary**:
The terms a Feature Match Layout uses whose meaning the installation supplies rather than the layout carrying it: a Source Item's Source Role, a Feature Match Overlay Frame animation effect, and a Feature Match token a Graphic Text Template binds.
Each is closed and pinned by one Feature Match Layout format version, so a Template Package naming a term an installation does not implement is refused before anything is installed.
_Avoid_: Free-form role, camera name

**Feature Match Sample Dataset**:
One canonical set of Feature Match values that a preview resolves a Feature Match Layout against when no Feature Match Slot is bound.
It exists so an author can judge whether real values fit the bounds they drew; it is fixed data so the same layout always previews identically, and it never appears on a live Screen Output.
_Avoid_: Dummy data, test data

**Screen Output**:
A live rendering variant exposed by a Screen Mode Definition, such as overlay, fill, or key.
_Avoid_: Export mode when referring to live Screen rendering.

**Program monitor**:
A control surface's own live rendering of the Screen it drives, embedded beside the controls that drive it.
It composes what playout has taken and resolves media through its Screen's Screen Output Asset Capability exactly as a Screen Output does, and is not one: it enters no presence and answers no Screen command, so nothing that counts or questions the outputs watching a Screen counts it.
_Avoid_: Preview — which composes the authored state its embedder pushes in rather than playout and resolves media as the author; the two are opposed on everything except not being an output. Confidence monitor.

**Screen Output Asset Capability**:
An opaque, long-lived, explicitly revocable right that lets one Screen Output resolve only the exact Graphic Asset Revisions currently published by its Screen.
It never permits Graphics Asset Library discovery, and removing a revision from the published Screen immediately removes that revision from the capability.
It is also that output's whole identity to the installation: it admits the lookup of the Screen the output is, and obtains a realtime grant narrowed to that Screen's channels and its Event's — so the capability is what a credential-free output presents in place of a session, rather than a permission over media alone (ADR-0010).

**Open Screen Output Engines**:
The browser engines the Screen Outputs currently watching one Screen are running, as reported by those outputs themselves.
They state what a Graphic Asset Revision would cost the outputs watching right now and never decide what may be pinned: an output that reports no engine contributes nothing, and an output that has crashed lingers until its connection times out, so the set over-reports what is watching rather than under-reporting it.
_Avoid_: Video target — the write-time compatibility choice a host builds its Graphic Asset References with, which is a property of the artifact being authored rather than a fact about who is watching; the two are routinely different, and a surface may act on both at once.

**Overlay Output**:
A Screen Output that renders the final composed colour and opacity over transparency.

**Fill Output**:
A Screen Output that renders the final composed colour flattened over black.
_Avoid_: Beauty when naming product concepts.

**Key Output**:
A Screen Output that renders the final composed opacity as a grayscale alpha matte.
_Avoid_: Black-and-white export, chroma key.

**Page Rotation**:
The deterministic projection of a paginated Screen Mode's current page from its Rotation Anchor and server time; owned by no client, computed identically by every rendering.
_Avoid_: Auto-paging when naming the projection itself — auto-page remains the operator-facing toggle that turns the rotation on.

**Rotation Anchor**:
The server timestamp a Page Rotation counts from, written only by an operator surface — when auto-page is enabled, when an edit changes the rotation's shape, or when an operator manually selects a page mid-rotation.
A Screen Output never writes it; a rendering that has not completed server-time sync shows the first page statically rather than projecting on an unknown clock.

**Feature Match Overlay Widget**:
A legacy name for a Graphic Item used by Feature Match Overlay.
Clock, Player Life, and Game Wins are context-gated shared Graphic Item Definitions; text and media use the shared base Graphic Item kinds.
_Avoid_: Widget, arbitrary element

**Widget Group**:
_Legacy implementation term._ Use Graphic Group.
_Avoid_: Widget Group, Region, generic group

**Feature Match Overlay Widget Definition**:
_Legacy implementation term._ Use Graphic Item Definition.
_Avoid_: Feature Match Overlay Widget Definition, widget metadata, widget registry

**Widget Preset**:
A saved starting shape for one Widget or a Widget Group, such as a player bar, match details strip, player status cluster, or event branding block.
_Avoid_: Widget type when it is only a prearranged composition

**Text Widget**:
_Legacy implementation term._ Use Text Graphic Item.
_Avoid_: Text Widget, Match Details Widget, Player Bar Widget when referring to tokenized text behavior

**Image Widget**:
_Legacy implementation term._ Use Media Graphic Item.
_Avoid_: Image Widget

**Clock Graphic Item**:
A context-gated Graphic Item that renders the active Feature Match Session clock.

**Player Life Graphic Item**:
A context-gated Graphic Item that renders one Player's life total.

**Game Wins Graphic Item**:
A context-gated Graphic Item that renders one Player's game-win indicators.

## Relationships

- An **Event** contains **Players**, **Phases**, **Rounds**, **Matches**, **Feature Match Slots**, **Feature Match Assignments**, **Screens**, broadcast configuration, game-specific settings, and optional **Melee Sync** configuration
- **Players**, **Phases**, **Rounds**, **Matches**, **Feature Match Slots**, and **Deck Lists** carry **Provenance** when they originate from **Melee Sync**
- A **Phase** contains ordered **Rounds**
- A **Round** contains zero or more **Matches**
- A **Round** has a **Round Results Overview**
- A **Round** may have **Round Standings**
- A **Round** contains zero or more **Feature Match Assignments**
- A **Feature Match Slot** belongs to exactly one **Event**
- A **Feature Match Slot** may reference at most one current **Match**
- A **Feature Match Assignment** connects exactly one **Match** to exactly one **Feature Match Slot** for exactly one **Round**
- A **Feature Match Assignment** may have one **Feature Match Note**
- A **Feature Match Slot Promotion** creates or updates one **Feature Match Assignment**
- A **Match** may have at most one **Feature Match Assignment** within the same **Round**
- A **Feature Match Slot** may have at most one **Feature Match Assignment** within the same **Round**
- A **Feature Match Session** belongs to exactly one **Feature Match Slot**
- While a **Feature Match Slot** has an active **Feature Match Session**, its identity binding fields resolve from the session's source snapshot and its live binding fields resolve from the session's current state
- A **Screen** has exactly one current **Screen Mode**
- A **Broadcast Graphics Screen** is a **Screen** in Broadcast Graphics mode
- A **Broadcast Graphics Screen** has at most one active **Broadcast Graphics Live Session**
- A **Broadcast Graphics Screen** renders an ordered stack of zero or more **Broadcast Graphics**
- A graphics **Screen** Edit workspace or reusable graphics Template has at most one **Graphics Authoring Lease**
- A **Graphics Authoring Lease** never restricts **Live Control**
- A **Broadcast Graphic** contains one or more **Graphic Items**
- Every **Graphic Item** is interpreted by one application-owned **Graphic Item Definition**
- The shared base **Graphic Item** kinds are **Text Graphic Item**, **Media Graphic Item**, **Shape Graphic Item**, and **Graphic Group**
- A **Graphic Group** may contain any context-available **Graphic Item** except another **Graphic Group**
- A **Graphic Group** does not contain another **Graphic Group** in the initial Broadcast Graphics vocabulary
- A **Shape Graphic Item** renders one **Shape Geometry**
- A **Media Graphic Item** or **Graphic Group** may use a **Shape Geometry** as its clipping boundary
- A **Text Graphic Item**, **Shape Graphic Item**, or **Graphic Group** may have one **Graphic Surface Style**
- A **Graphic Surface Style** may have one **Graphic Fill**
- A **Broadcast Graphic** and each **Graphic Group** own the **Graphic Layer Order** of their direct Graphic Items
- Every top-level **Graphic Item** and canvas-positioned **Graphic Group** child has one **Graphic Anchor Point**
- Canvas-positioned **Graphic Items** may be edited using any **Graphic Geometry Unit** while retaining canonical pixel geometry
- A canvas-positioned **Graphic Item** may have one **Graphic Rotation**
- A **Broadcast Graphic** and its **Graphic Items** may each own optional **Graphic Animations**
- A **Broadcast Graphic**'s **Graphic Animation** composes with the **Graphic Animations** of its **Graphic Items**
- Every **Graphic Animation** recipe in the same lifecycle phase measures its delay from one shared phase start
- A **Broadcast Graphic** or **Graphic Group** may stagger the **Graphic Animations** of its direct **Graphic Items** in list or reverse-list order
- A stagger applies to a selected subset of direct **Graphic Items** and adds each item's ordered stagger offset to its own recipe delay
- A finite lifecycle phase completes after its latest delayed or staggered **Graphic Animation Recipe** completes
- Every output and **Live Control** projects a lifecycle phase from one authoritative effective start time
- Output-browser acknowledgements never gate lifecycle-phase completion
- A missing **Graphic Animation Recipe** or **Cut** completes its corresponding lifecycle phase immediately
- An indefinite on-screen **Graphic Animation Recipe** does not prevent the **Graphic Playout State** from being on-air
- A **Graphic Animation** may own at most one **Graphic Animation Recipe** for each lifecycle phase
- A newly authored **Broadcast Graphic** or **Graphic Item** has no **Graphic Animation Recipes** until its template author enables them
- A missing **Graphic Animation Recipe** makes that owner change immediately for the corresponding lifecycle phase
- Graphic Animation presets are authoring shortcuts that initialise editable **Graphic Animation Recipes** rather than distinct runtime concepts
- Every **Graphic Animation Recipe** operates relative to its owner's **Graphic Resting State**
- A scale channel uses one **Graphic Animation Origin**
- A slide channel uses one of eight compass directions and either a fixed distance or the distance required to clear its owner's parent
- A fixed slide distance may be authored using any **Graphic Geometry Unit** while retaining a canonical pixel offset
- A reveal channel wipes from the left, right, top, or bottom edge across its owner's rectangular bounds while preserving existing **Shape Geometry** clipping
- A fade channel configures a zero-to-one reduction from its owner's **Graphic Resting State** opacity
- Fade channels on a **Broadcast Graphic** and its **Graphic Items** compose multiplicatively
- A scale channel uses a uniform factor from zero to twice its owner's **Graphic Resting State** size
- A **Graphic Animation Recipe** uses linear, ease-in, ease-out, ease-in-out, back-in, back-out, or back-in-out easing rather than an author-defined curve
- Rotation, skew, perspective, filters, shape morphing, motion paths, and arbitrary transforms are outside **Graphic Animation**
- **Media Graphic Item** playback is independent of **Graphic Animation**
- A **Graphic Animation Recipe** lasts from 50 milliseconds to 10 seconds and may be delayed or staggered by up to 10 seconds
- An on-screen **Graphic Animation Recipe** may pause for up to 60 seconds between cycles and may repeat from one to 100 times or indefinitely
- One atomically accepted set of on-air **Graphic Input** changes starts one update phase
- Accepted **Graphic Input** changes do not animate while a **Broadcast Graphic** is off air or exiting, and its next enter uses their latest accepted values
- Accepted **Graphic Input** changes during enter coalesce into one update after enter completes
- A **Graphic Item**'s update **Graphic Animation Recipe** runs only when that item's rendered content changes
- A **Broadcast Graphic**'s update **Graphic Animation Recipe** runs when any of its rendered content changes
- An update **Graphic Animation Recipe** cross-transitions the old and new renderings concurrently
- Accepted **Graphic Input** changes that arrive during an update animation coalesce into one latest pending rendering, which transitions after the active update completes
- During an update slide, old content leaves in the selected direction while new content enters from the opposite side and moves in the same direction
- During an update reveal, one boundary travels in the selected direction with new content behind it and old content ahead of it
- An on-screen **Graphic Animation Recipe** begins after enter completes and cycles from the **Graphic Resting State** to a configured excursion and back without accumulating motion
- An on-screen **Graphic Animation Recipe** may run once, a fixed number of times, or until exit is requested, with an optional pause between cycles
- An update interrupts an active on-screen **Graphic Animation Recipe**, after which on-screen cycling restarts from its beginning
- Exit interrupts an active enter, update, or on-screen **Graphic Animation Recipe** and continues smoothly from the currently rendered state
- A **Broadcast Graphic** may be in more than one lifecycle phase at one authoritative instant, and every **Screen Output** and **Live Control** projects the same set
- At most one update or on-screen **Graphic Animation Recipe** runs alongside at most one enter or exit phase
- An exit composes over the update or on-screen **Graphic Animation Recipe** it interrupted rather than replacing it
- Concurrent fades multiply, concurrent slides add, concurrent scales apply in turn, and concurrent reveals show only what both reveal
- Interrupting an update animation does not roll back its accepted **Graphic Input** values
- Exit discards any pending visual update without discarding its accepted **Graphic Input** values
- A **Broadcast Graphic** leaving with a pending visual update discarded keeps the rendering the interrupted update was travelling towards until it leaves
- A **Broadcast Graphic** may belong to one **Graphic Channel**
- A **Graphic Channel** has one **Graphic Channel Handoff Policy** and defaults to Overlap
- Taking a **Broadcast Graphic** replaces the on-air **Broadcast Graphic** in the same **Graphic Channel**
- Overlap begins the outgoing exit and incoming enter at the same logical instant
- Out then in begins the incoming enter at the outgoing exit's authoritative scheduled completion
- Cutting a channel replacement bypasses its **Graphic Channel Handoff Policy** and switches immediately without overlap
- A **Graphic Channel** retains only its latest selected **Broadcast Graphic** and never queues earlier Take actions
- Under Overlap, a new Take reverses the current incoming graphic into exit, starts the latest selected graphic's enter, and cuts off any older outgoing graphic
- Under Out then in, a new Take replaces any waiting incoming graphic before it enters while the current outgoing graphic finishes normally
- Every placed **Broadcast Graphic** has one **Graphic Playout State**
- Overlap and **Cut** skip the waiting **Graphic Playout State**
- A waiting **Broadcast Graphic** is absent from overlay, fill, and key outputs
- Out cancels a waiting Take, while Cut Take immediately performs its channel handoff
- A **Broadcast Graphics Screen** accepts playout actions in one authoritative order
- The last accepted conflicting playout intent determines the target state, and duplicate delivery of the same action has no additional effect
- Every **Live Control** and output converges on the authoritative playout order
- Take and Out express the latest desired on-air state of a **Broadcast Graphic** rather than queued animation events
- Take, Out, Cut Take, and Cut Out apply their target-state intent to the latest accepted **Graphic Playout State**
- Repeated Take or Out actions are idempotent
- Out during enter and Take during exit reverse smoothly from the currently rendered state
- Update Graphic remains a separate atomic acceptance of staged **Graphic Inputs**
- Update Graphic and Cut Update reject a stale acceptance attempt when another operator has already accepted a newer **Graphic Input** set
- Update Graphic is available only while a **Broadcast Graphic** is entering, on-air, or updating
- Editing while a **Broadcast Graphic** is off, waiting, or exiting changes the working values that its next Take accepts without exposing an Update Graphic action
- Update Graphic during enter coalesces into one update after enter completes
- Update Graphic during an active update replaces the single pending update with the latest accepted values and never creates a queue
- **Cut** modifies Take, Update Graphic, or Out and is not a standalone playout action
- Cutting Update Graphic atomically accepts every pending staged **Graphic Input** and immediately shows the new rendering
- Cutting Update Graphic during enter swaps in the new rendering at its current animated state, preserves the enter schedule, and leaves no post-enter update pending for those values
- Concurrent **Broadcast Graphics** always render in their authored Screen stack order
- Take timing and **Graphic Channel** membership never change Screen stack order
- A **Broadcast Graphics Screen** owns one configurable pixel canvas that defaults to 1920 by 1080 pixels
- Every **Broadcast Graphic** on a **Broadcast Graphics Screen** is authored in that Screen's canvas coordinate space
- Fitting a graphics Screen canvas to another viewport scales the complete canvas uniformly without reflowing its composition
- A **Broadcast Graphics Screen** has a transparent host and does not apply generic Screen padding, background, or alignment
- Concurrent **Broadcast Graphics** composite once into one transparent colour-and-opacity frame before its **Screen Outputs** are derived
- A **Broadcast Graphics Screen** exposes an **Overlay Output**, **Fill Output**, and **Key Output** with identical canvas dimensions
- The **Fill Output** and **Key Output** derive from the same final composed frame as the **Overlay Output**
- An empty **Broadcast Graphics Screen** is transparent in its **Overlay Output** and black in its **Fill Output** and **Key Output**
- A graphics **Screen Output** uses one stable Screen URL with an overlay, fill, or key output selection; an omitted or invalid selection renders the **Overlay Output**
- Every graphics **Screen Output** projects the same authoritative playout sequence and effective animation start times
- At the same authoritative time, the **Overlay Output**, **Fill Output**, and **Key Output** resolve the same composition and animation phase
- A late-loading or reconnected graphics **Screen Output** catches up to the current authoritative phase rather than replaying it from the beginning
- Every realtime-fed surface re-reads authoritative state on **Reconnect Resync**, and a reconnected **Screen Output** renders the current **Screen Mode** without waiting for the next change
- A **Screen Output** whose realtime link is disconnected holds its last accepted rendering rather than blanking
- A client that cannot mint a realtime token for the **Event** it is on re-attempts, and reports a persistent failure where an operator can see it
- Application-level output alignment does not promise hardware genlock between independent browser windows or capture devices
- **Broadcast Graphics Screen** and **Feature Match Overlay** previews share output selection, zoom, item selection, item guides, and safe-area controls
- Graphics Screen previews provide advisory action-safe guides at a five-percent inset and title-safe guides at a ten-percent inset
- Preview guides never appear in live **Screen Outputs** or captures and do not clip or constrain authored **Graphic Items**
- Preview guides are drawn only for a preview, and no **Screen Output** URL the application produces asks to be a preview — a URL hand-built to do both is outside what this property covers
- A **Broadcast Graphic Template** initializes a copy of a **Broadcast Graphic** on a **Broadcast Graphics Screen**
- A **Graphic Asset** belongs to the installation-wide **Graphics Asset Library** and is never owned by an **Event**
- A **Graphic Asset** has one stable library identity distinct from the identity of its **Graphic Asset Content**
- Any byte change creates different **Graphic Asset Content**, while identical stored bytes have the same content identity
- More than one **Graphic Asset** may share the same **Graphic Asset Content** without sharing identity, name, organisational metadata, or **Graphic Asset Origin**
- A **Graphic Asset** has one or more ordered **Graphic Asset Revisions**
- Each **Graphic Asset Revision** references exactly one **Graphic Asset Content**
- Replacing a **Graphic Asset**'s file creates a new **Graphic Asset Revision** rather than mutating existing content or creating an unrelated asset
- Every persisted graphics reference pins one **Graphic Asset** identity and one exact **Graphic Asset Revision**
- Selecting a **Graphic Asset** creates a reference to its latest revision, while later revisions require explicit adoption by each referencing graphics artifact
- A superseded **Graphic Asset Revision** remains resolvable while any **Graphic Asset Reference** pins it
- A **Graphics Retention Sweep** reclaims **Graphic Asset Revisions** through **Revision Pruning**, **Trashed Graphic Assets** through purge, and **Graphic Asset Content** through **Content Quarantine**
- A **Graphic Asset Tombstone** replaces the restorable state of exactly one purged **Graphic Asset** and permanently retires that local identity
- **Graphic Asset Content** stays reachable while any retained **Graphic Asset Revision** or **Graphics Derivative** points at it, and enters **Content Quarantine** only once that final reachability disappears
- A **Graphics Derivative** is reclaimed with its source **Graphic Asset Revision** and never keeps that revision's **Graphic Asset Content** reachable on its own
- Every automated **Graphics Retention Sweep** decision and every **Early Purge** records one entry in the **Evidence Ledger**
- Every **Graphic Asset** lifecycle transition records, on a best-effort basis, one **Evidence Ledger** entry naming the actor, the states either side, and the recovery deadline Trash established; the transition itself is already durable and never fails for want of Evidence
- The **Graphic Asset Revision** retention deadline is established at supersession and recorded there, not when a sweep first observes it
- **Evidence Ledger** entries are retained until their subject's **Evidence Terminal Cleanup** and for one year after it, never expiring on their own age
- A **Graphic Asset Tombstone** explains later provenance and audit observations, outlives the **Evidence Ledger** entries about its purge, and satisfies no **Graphic Asset Reference**
- High-volume delivery observations stay in logs, traces, and aggregate metrics: a disagreement a reader observes opens one **Graphics Discrepancy** and records one **Evidence Ledger** entry however many times it is read
- A Template Package import maps its packaged asset identity and revision to a local **Graphic Asset** identity and revision
- **Graphic Asset Origin** records that mapping on the exact imported local revision without making the packaged identity a local identity or live link
- A later locally created **Graphic Asset Revision** never inherits **Graphic Asset Origin** from an earlier imported revision
- **Graphic Asset References**, rather than Event associations, **Graphic Asset Origin**, deliveries, or **Graphics Derivatives**, determine which asset revisions are in use
- Creating, changing, publishing, or transferring a **Graphic Asset Reference** requires its exact revision to resolve successfully
- A **Missing Graphic Asset Reference** remains persisted and diagnosable until explicitly repaired, while invalidating its owning graphics artifact
- **Unavailable Graphic Asset Content** causes a retryable failure only for operations that currently require its bytes
- **Graphics Reconciliation** is the only writer of the catalogue's **Unavailable Graphic Asset Content** state, and every reader that observes the byte store contradicting the catalogue feeds it
- A **Graphics Discrepancy** never changes the **Graphic Asset**, **Graphic Asset Revision**, or **Graphic Asset Reference** it affects, and offers only the actions valid in its current state
- An unexpected canonical object enters **Content Quarantine** for the same seven-day recheck and is deleted only if still unaccounted for; it is never adopted as a **Graphic Asset** or **Graphic Asset Content**
- A **Critical Integrity Incident** is isolated rather than repaired, and blocks clearing **Unavailable Graphic Asset Content** for the same content while it stays open
- **Exact-Byte Repair** and **Derivative Regeneration** restore only bytes the catalogue already expected, and never create a **Graphic Asset Revision** or change a **Graphic Asset Reference**
- Readers and **Graphics Reconciliation** apply one definition of agreement between the catalogue and stored bytes, so content failing closed as a **Critical Integrity Incident** is never still served
- **Deep Verification** is the only action offered on a **Critical Integrity Incident**, and the only one that can detect stored bytes that changed behind unchanged size and media type
- The **Operations Cockpit** states D1 **Library Component Condition** separately from canonical byte condition, and never merges them into one number
- A **Storage Health Alert** is derived from durable state on every reading, so a persistent one reappears after navigation and reload until its subject is resolved
- The **Operations Cockpit** counts every lifecycle group by aggregate rather than by expanding rows, so one reading costs the same against any size of backlog
- The **Operations Cockpit** offers only actions that cannot shorten a recovery guarantee, and still answers whether the library is safe when the catalogue cannot answer
- An **Operational Queue** is named for the operational state of its work rather than for a provider object, and the queues are ordered most severe first and then by deadline proximity within each
- Retired, Trashed, superseded, unavailable, missing, quarantined, retryable, and expired work stay in separate **Operational Queues**, because the actions valid in each differ
- A **Queue Inspector** offers only the actions valid in its subject's current state, and the library re-proves that validity before writing anything
- **Exact-Byte Repair** is offered only for Unavailable Graphic Asset Content and **Derivative Regeneration** only for a missing Graphics Derivative; a quarantined object exposes its recheck deadline and evidence and offers no action that writes
- Every **Operational Queue** action reports one **Queue Action Outcome**, and running the same action twice reports already-in-state
- A recheck that leaves a **Graphics Discrepancy** open reports retryable-unavailable rather than already-in-state, because nothing has been put right
- Each **Operational Queue** samples independently and by deadline proximity, so no queue's backlog can leave another queue's work unlisted and unactionable
- A **Queue Inspector** resolves its subject by identity rather than from a queue's bounded sample, so a subject past the end of a sample still inspects
- An **Early Purge** from a **Queue Inspector** requires an explicit typed confirmation as well as the fresh all-revision reference proof the library takes regardless
- Every **Graphic Asset Revision** passes **Graphic Asset Validation** under one **Graphic Asset Compatibility Profile** before it becomes referenceable
- The initial `still-image-v1` **Graphic Asset Compatibility Profile** accepts exact single-frame PNG, JPEG, or WebP source bytes up to 25 MiB, 8,192 pixels per axis, and 16,777,216 decoded pixels only when bounded parser evidence and a complete decode agree on an 8-bit SDR sRGB image with normal orientation
- `still-image-v1` rejects declaration conflicts, animation, embedded colour or orientation profiles, malformed structure, partial decode, and out-of-profile facts, and generates a separate deterministic transparent 8-bit sRGB PNG thumbnail fitted within 640 × 360 without cropping or upscaling
- Template Package imports revalidate packaged source bytes under the receiving installation's current **Graphic Asset Compatibility Profile**
- Every local upload, approved remote copy, file replacement, and Template Package installation runs as one durable, idempotent **Graphics Ingestion Operation**
- A **Graphics Ingestion Operation** exposes reconnectable stage progress, one complete compatibility report, cancellation before publication, and retry from durable checkpoints
- Staged bytes, provisional **Graphic Assets**, and provisional graphics Templates are visible only through the initiating operation and never appear in their libraries
- Approved remote ingestion copies exact bytes once from a public HTTPS source and never creates a hotlink, synchronization link, or authenticated remote dependency
- A **Graphics Ingestion Operation** is owned by the **User** who initiated it; its UUID is a name, not a right, and another user who learns one is told the operation does not exist
- A **Graphics Ingestion Operation** outlives the **Session** it was started in: its owner reaches it again by signing in from any browser, and retention reclaims the staged input of one nobody finishes on the ordinary schedule (ADR-0010)
- An ordinary ingestion that exactly matches existing **Graphic Asset Content** defaults to reusing its **Graphic Asset** without overwriting library metadata, while allowing an explicit separate asset identity
- A Template Package reuses a local **Graphic Asset Revision** only for an exact source identity, source revision, and content-digest match
- A related packaged source revision or unrelated matching digest creates a separate local **Graphic Asset** while reusing identical **Graphic Asset Content**
- The same packaged source identity and revision with a different digest is an integrity conflict that rejects the complete Template Package
- A Template Package contains only **Graphic Assets** transitively required by its single graphics Template
- **Template Package Preflight** rejects unsafe or traversing entry paths, links, case-colliding or duplicate paths, encrypted or compressed entries, nested archives, undeclared entries, missing declared entries, inconsistent sizes, and envelope-limit violations
- **Template Package Preflight** permanently rejects a package schema newer than this installation reads, rather than guessing at it
- The migration step exists and is deterministic by construction, but schema 1 is currently both the oldest supported and the current version, so no package migrates yet and `package-migration-unavailable` is unreachable until a schema 2 exists
- A **Template Package Preflight Report** reports every blocking problem together, each with a stable code and remediation, rather than one problem at a time
- Warnings pause a Template Package exactly once for a confirmation bound to its **Preflight Report Fingerprint**; changed bytes, mappings, compatibility profiles, or proposals require a new report
- Template Package installation publishes every new asset, origin mapping, rewritten reference, and the graphics Template in one atomic operation
- A **Template Package Installation** installs exactly one **Installed Graphics Template** and maps every packaged identity to one exact local **Graphic Asset Revision**
- A **Template Package Installation** applies only the **Template Package Mapping Proposals** of the **Preflight Report Fingerprint** its author confirmed, and re-proves that fingerprint before publishing
- Two packaged identities claiming one source identity and revision cannot both map to one local revision, so **Template Package Preflight** rejects the complete package
- A **Template Package Mapping Proposal** that would reuse a **Retired Graphic Asset** or **Trashed Graphic Asset** is reported before confirmation and stays retryable, because neither can take a new **Graphic Asset Reference** until it is restored
- An **Installed Graphics Template** owns one **Graphic Asset Reference** for each Graphic Asset field its document carries
- An **Installed Graphics Template**'s references are ordinary **Graphic Asset References**, so a **Graphic Asset** one of them pins cannot enter Trash
- Reusing an exact **Graphic Asset Origin** publishes no **Graphic Asset**, so the reused asset keeps describing itself by the **Graphics Ingestion Operation** that created it rather than by the package that referenced it
- A **Template Package Installation** run inside an **Event** associates every **Graphic Asset** it created or reused with that **Event** without changing a reused asset's own metadata
- A failed or cancelled **Template Package Installation** leaves no discoverable **Graphic Asset**, **Graphic Asset Revision**, **Graphic Asset Origin**, **Graphic Asset Reference**, or **Installed Graphics Template**
- Replacing a **Graphic Asset** with its current content is a no-op; deliberately returning to older content creates a new revision backed by the existing **Graphic Asset Content**
- A **Graphic Asset** may be associated with or referenced from more than one **Event**
- A **Graphic Asset**'s optional **Event** associations organise discovery and never establish ownership, restrict access, or count as references
- Deleting an **Event** removes its Graphic Asset associations and references but never deletes or hides the shared **Graphic Assets**
- The same **Graphic Asset** may be referenced concurrently by Broadcast Graphic Templates, Feature Match Layout Templates, Graphic Style Sets, Screens, and placed graphics across multiple **Events** without creating Event-specific copies
- A **Graphics Derivative** belongs to exactly one source **Graphic Asset** or graphics Template revision
- Graphics authors may discover and reference every **Graphic Asset** in the installation-wide **Graphics Asset Library**
- Graphics artifacts reference a **Graphic Asset** by its stable library identity rather than by filename, URL, object key, or content hash
- A **Screen Output** may resolve only the **Graphic Assets** referenced by its **Screen** and cannot discover other library contents
- A **Screen Output Asset Capability** is checked against the Screen's currently published exact **Graphic Asset Revisions** on every resolution request
- Playback compatibility is answered per resolution request against the requested revision's own recorded facts, never by refusing the capability session, so a revision one **Screen Output**'s browser cannot play costs it that revision and none of the Screen's other assets
- A **Screen Output** that cannot play a pinned silent video reports the reason in that item's place rather than leaving a blank rectangle, except in the **Key Output**, whose colour is the alpha matte
- Only a **Screen Output** enters its **Screen**'s presence and answers its **Screen**'s commands; a **Program monitor** and a preview open the same Screen URL and join neither, so every count of what is watching a **Screen** counts outputs alone
- A **Program monitor** shows what its **Screen**'s **Screen Outputs** show — the same playout at the same authoritative instant, the same media through the same **Screen Output Asset Capability** — and is never one of them
- The **Open Screen Output Engines** of a **Screen** are what its **Screen Outputs** report of themselves, and a control surface states what a **Graphic Asset Revision** costs them before an operator chooses it rather than leaving the cost to be discovered on air
- A **Screen Output** carries its **Screen Output Asset Capability** in the URL it is opened with, and every surface that hands an operator such a URL obtains one at that moment or hands out nothing
- A **Screen Output** holding no capability renders nothing at all: the capability is what admits the lookup of its own **Screen**, so an output opened without one never reaches the state where it could render graphics without their media (ADR-0010)
- A **Program monitor** or preview holding no capability still renders every graphic its **Screen** publishes except their media, which is indistinguishable on program from a **Screen** with no media — so it reports its asset access to its **Screen** as it reports its engine, and a control surface states the loss rather than leaving it to be discovered on air; those surfaces are admitted by their operator's session, which a **Screen Output** does not have
- A **Screen Output** renders its **Screen**'s canvas scaled uniformly to fit the window it is opened in, letterboxed on the axis that did not decide the scale, whenever its **Screen Mode Definition** registers viewport-fit scaling
- A **Broadcast Graphics Screen** publishes the exact **Graphic Asset Revisions** its authored configuration pins and the media **Graphic Input** values its **Broadcast Graphics Live Session** has accepted, and a value the Live Session no longer accepts stops being published in the same moment it leaves air
- A media **Graphic Input** value carries the pinned **Graphic Asset Revision**'s own video target compatibility, stated with the value when it is authored as a default and recorded by the authoritative side when it is chosen live, and a value that states none is refused rather than published
- A **Broadcast Graphic Template** declares zero or more **Graphic Inputs**
- Copying a **Broadcast Graphic Template** into a **Broadcast Graphics Screen** copies each **Graphic Input** default as the placed graphic's initial manual value
- Copying a **Broadcast Graphic Template** also creates independently editable **Graphic Source Selections** and **Graphic Input Bindings** on the placed **Broadcast Graphic**
- A placed **Broadcast Graphic** owns zero or more **Graphic Source Selections**
- A **Graphic Source Selection** selects the current **Event** or exactly one **Player**, **Talent**, **Phase**, **Round**, **Match**, **Feature Match Slot**, or **Archetype**
- A directly selected **Player** follows current **Event Data**; a **Player** derived from a **Match** or **Feature Match Slot** resolves from that production snapshot
- A **Graphic Input Binding** may read discrete live scalar state from a **Feature Match Slot**; ticking clocks and collection-shaped state require specialised **Graphic Items**
- A **Graphic Input Binding** maps one **Graphic Input** to one field on a **Graphic Source Selection**
- The **Graphic Input Binding** field catalog separates stable common fields from fields specific to the current **Event**'s game
- The **Graphic Input Binding** field catalog may expose both atomic typed fields and explicitly named broadcast-formatted fields
- A **Graphic Input** value that violates its declared type or constraints is unavailable rather than coerced, clamped, truncated, or substituted
- A choice **Graphic Input**'s declared default is one of its own options or none, and an option list edited to stop offering the current default clears it rather than leaving a default the input reports unavailable
- A media **Graphic Input** declares which media it accepts, which is both what its declared default may pin and the only kind **Live Control**'s picker offers; changing the declared kind clears a default of the other one
- Multiple **Graphic Input Bindings** may share one **Graphic Source Selection**
- Each operator-selected **Graphic Source Selection** generates one picker in **Live Control**
- Each **Graphic Input** generates one type-appropriate field in **Live Control**
- **Live Control** distinguishes each **Graphic Input**'s latest bound value, working value, and accepted on-air value
- Relevant **Realtime Event Session** changes re-resolve affected **Graphic Input Bindings**; the **On-air Update Policy** determines when those resolved values are accepted on air
- An unavailable **Graphic Input Binding** does not fall back to its template default
- A required unavailable **Graphic Input** prevents an off-air **Broadcast Graphic** from being taken on air
- If a required **Graphic Input** becomes unavailable on air, its last accepted value remains visible until the operator updates or overrides it
- A **Graphic Input Override** masks its **Graphic Input** binding until cleared, after which the current bound value resumes
- Each **Graphic Input** has an **On-air Update Policy** of staged or live
- A newly declared **Graphic Input** defaults to the staged **On-air Update Policy**
- A live **On-air Update Policy** applies immediately only while its **Broadcast Graphic** is on a program output
- A waiting **Broadcast Graphic** enters with the values its Take accepted, however long its **Graphic Channel** holds it
- Update Graphic atomically accepts every pending staged **Graphic Input** value for one **Broadcast Graphic**
- A **Text Graphic Item** may render a **Graphic Text Template** using current **Graphic Input** values
- A **Text Graphic Item** may define one **Graphic Placeholder Style** for each referenced **Graphic Input**
- Every **Text Graphic Item** has one **Text Overflow Policy**
- A **Feature Match Overlay** renders exactly one **Feature Match Layout** for exactly one **Feature Match Slot**
- A **Feature Match Layout** has exactly one **Feature Match Overlay Frame**
- A **Broadcast Graphic** and a **Feature Match Layout** use the **Shared Graphics Foundation**
- A **Feature Match Layout** contains one or more **Graphic Items**
- A **Source Item** may cut through the **Feature Match Overlay Frame**
- A **Source Item** is host-owned rather than a **Graphic Item**, and is held in the **Feature Match Layout**'s own Source Item list rather than in its composition
- **Clock Graphic Item**, **Player Life Graphic Item**, and **Game Wins Graphic Item** are shared **Graphic Item Definitions** that require Feature Match context
- A **Feature Match Overlay Preset** initializes a **Feature Match Layout**
- A **Feature Match Layout Template** stores a reusable **Feature Match Layout**
- A **Feature Match Layout** declares its **Feature Match Layout Host Vocabulary** terms to a **Template Package**, and never carries an Event identity
- A **Feature Match Sample Dataset** resolves a **Feature Match Layout** preview when no **Feature Match Slot** is bound, and never a **Screen Output**
- **Broadcast Graphics Screen** and **Feature Match Overlay** each expose **Overlay Output**, **Fill Output**, and **Key Output** variants

## Example dialogue

> **Dev:** "When I assign a **Match** from Round 3 to Slot 1, am I changing the **Round** itself?"
> **Domain expert:** "No — you are saving a **Feature Match Assignment** for that **Round** and updating the **Feature Match Slot** only when you promote that match into production controls."

## Flagged ambiguities

- "Feature Match" is overloaded. Use **Feature Match Slot** for the reusable production lane, **Feature Match Assignment** for the Round-scoped saved selection, and **Match** for the tournament pairing.
