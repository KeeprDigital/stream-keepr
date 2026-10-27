# Context

Domain vocabulary for Stream Keepr. Use these terms when naming modules, seams, tests, and architecture notes. Decisions cited as ADR-NNNN are in `DECISIONS.md`.

## Language

### Tournament

**Event**:
A competitive gaming tournament managed by Stream Keepr.

**Phase**:
A segment of an Event structure, such as Swiss or Top Cut.

**Round**:
A unit of tournament play within a Phase, containing Matches and optional tournament-state metadata synced from Melee.

**Match**:
A pairing between Players in a Round, with its Match Result and the records used for standings and broadcast workflows.
_Avoid_: Feature Match when referring to the pairing.

**Match Result**:
Whether a Match is reported or a bye, and its game wins and game draws. Only Melee Sync records one; no operator enters, edits or clears it, so a manual Match never has one (ADR-0047).
_Avoid_: score, for the whole result.

**Game Score**:
A Match's game wins and game draws read from one of its Players' side, theirs first: 2-1, or 1-1-1 with a game draw. Every reported Match that is not a bye has one; a bye or an unreported Match has none.

**Round Standings**:
The standings for Players as of a specific Round.

**Position Change**:
How many positions a Player moved since the previous Round's Round Standings: the nearest earlier Round, in the Event's Round order (Phase sort order, then round number), that holds Round Standings. Current standings stand as the latest Round holding them, so they compare with the one before it. A Player absent from that Round is new; with no such Round, or no position to compare, there is no Position Change. Derived from stored Round Standings, never imported.
_Avoid_: movement, rank delta.

**Player**:
A competitor in an Event.

**Deck List**:
A Player's submitted cards for a game and Phase.

**Mainboard**:
The starting portion of a Deck List — the cards a Player begins each game with.

**Sideboard**:
The reserve portion of a Deck List, exchanged with Mainboard cards between games.

**Board Selection**:
Which boards of a Deck List a rendering surface presents: Full (Mainboard and Sideboard), Mainboard only, or Sideboard only. Shared by every deck-rendering surface, including Metagame card filtering.

**Unresolved Deck Card**:
A Deck List entry imported by **Melee Sync** whose name matched no known card. Resolving one names the card for every Deck List in the Event holding that entry (ADR-0031).

**Metagame**:
Analysis of Players, Deck Lists, cards, archetypes, and standings within an Event or scoped Player group.

**Metagame Scope**:
Which Players a Metagame read counts: every Player, the top N by placement, those with at least a minimum match-point total, or one Player List's members. The Metagame page and every Screen Mode reading the Metagame carry the same scope, so a scope asks each read the same question; an Archetype's pilots, meta share and Conversion Rate are read within it.

**Archetype**:
A strategic Deck classification assigned to Players and used for Metagame analysis.

**Pilot**:
A Player of an Archetype within the current Metagame scope; an Archetype's pilots are its Players in that scope.

**Conversion Rate**:
The percentage of an Archetype's Players in the current Metagame scope that reached a conversion target — a Top N placement or a minimum match-point total. The target is a numerator condition evaluated inside the scope; it never narrows the scope itself.
_Avoid_: top-cut rate, cash rate, qualification rate

**Melee Sync**:
The workflow that imports and refreshes Event structure, Players, Deck Lists, standings, Matches, and Rounds from Melee.gg.

**Provenance**:
The Melee-owned identity and lifecycle facts on a synced record: its external identity, sync status, activity, and last-seen time. Only Melee Sync writes Provenance; manual operator edits never carry it.
_Avoid_: external fields, sync metadata.

**Manually Edited Field**:
A Melee-imported Player field, name or pronouns, that an operator has changed by hand, on the Players page or in a Feature Match Slot's setup. Melee Sync stops writing that field for that Player, blank or not, and keeps importing the rest. Writing the value a field already holds, as a whole-form save does, is not an edit (ADR-0046).
_Avoid_: override, local override.

**Talent**:
An Event-scoped broadcast presenter or commentator who may be selected for production graphics.

**Supported Social Network**:
One of Twitch, YouTube, X, Instagram, TikTok, or Bluesky: the application-owned, ordered catalog of public networks available for Talent profiles, each supplying its label, icon, and profile-URL rule. Events cannot add or reorder networks.

**Social Profile**:
A Talent's public identity on one Supported Social Network, identified by a normalized handle from which its profile URL is derived. A Talent has at most one per network; Stream Keepr does not verify the remote account exists.
_Avoid_: Commentator handle, social link

**Broadcast Deck List**:
An Event-scoped card list prepared by an operator solely for display on a Deck Screen. It has no Player, competition, or Metagame identity, and may carry an Archetype Label.

**Archetype Label**:
Optional broadcast-only text and mana colours on a Broadcast Deck List, used as its secondary Deck Screen identity. It does not reference an Archetype.

**Deck Source**:
The required data binding of a Deck Screen: either one Event-scoped Player (or no selected Player) or one Event-scoped Broadcast Deck List.

### Feature Match production

**Feature Match Slot**:
A reusable production control lane for showing one featured Match at a time, using mutable display/control snapshot data. A Match occupies at most one Slot.
_Avoid_: Feature Match when referring to the reusable lane.

**Feature Match Assignment**:
A Round-scoped selection of a Match for a Feature Match Slot. Moving the same Match to another Slot continues the Assignment; replacing it with a different Match ends it.
_Avoid_: Feature Match when referring to the saved Round selection.

**Feature Match Note**:
A single mutable plain-text production note belonging to a Feature Match Assignment. It moves with the Assignment between Slots and is discarded when the Assignment ends. Feature Match Notes are off for a new Event; switching them off hides them from production surfaces without deleting any.

**Feature Match Session**:
The live state timeline for a Feature Match Slot.

**Untimed Match**:
A Feature Match whose Session clock type is untimed: it has no clock to run and so no extra turns. The type comes from the Event's Match Format when the Session opens. Where its clock would render, it shows the Event's Untimed Label, or nothing while that label is blank.
_Avoid_: unclocked match, timeless match

**Feature Match Slot Promotion**:
The workflow that promotes a Match into a Feature Match Slot for production controls and saves the Round-scoped Feature Match Assignment.

**Reverse Sync**:
The follow-on that copies Players' current data into every Feature Match Slot seating them, and into each such Slot's active Feature Match Session source snapshot. It runs after the Player write, Melee Sync or Feature Match Slot Promotion that caused it has committed, and announces nothing itself: its caller's own messages carry the result. A lost Session race is absorbed, and the next pass finds the same difference. A Slot setup edit to a seated Player's name, pronouns or LGS is a Player write, so Reverse Sync carries it rather than undoing it (ADR-0045).
_Avoid_: player sync, match snapshot refresh.

### Screens

**Screen**:
A broadcast or control surface that can show Feature Match Slot output, decks/cards, standings, graphics, or other prepared content.

**Screen Mode**:
A rendering mode for a Screen, such as Background, Card Spotlight, Deck List, Standings, Top Cut Bracket, Feature Match Controls, Feature Match Overlay, Broadcast Graphics, Metagame, Most Played Cards, Player History, Pairings, Archetype Spotlight, or Head-to-Head. Each is named by what it shows or controls. Its key (`card`, `top-cards`, `top-cut`, …) is not its name: renaming a mode leaves its key alone, and a key renamed after release is migrated in storage and still accepted in its former spelling on a Screen write (ADR-0043).
_Avoid_: Top Cards for the Most Played Cards mode (one word from Top Cut); Feature Match for the control mode (the on-air one is the Feature Match Overlay).

**Screen Mode Definition**:
The definition of a Screen Mode: its defaults and configuration shape (held as one config contract, ADR-0037, which also names its Authored Stacks), data preparation, rendering contract, Screen host contract (overlay or control surface), and what it declares it carries, such as its Mode Tokens, its own Background Layer stack, its Event References, or its Page Rotation. A mode that declares it carries something gets all of that thing's behaviour from the declaration alone. Generic Screen configuration UI policy belongs here rather than on the Screen configuration page.

**Event Reference**:
A field in a Screen Mode's configuration naming something that must belong to the Screen's Event: a Phase, a Round, a Player, a Player List, a Feature Match Slot, an Archetype, or a Deck Source. Every Screen Mode Definition declares its Event References, declaring none if it has none, and a Screen write refuses one naming something outside the Event (ADR-0038).
_Avoid_: data binding (a Graphic Input Binding is a Broadcast Graphics concept), Graphic Asset Reference (an installation-wide library link, not Event data)

**Head-to-Head**:
A Screen Mode showing two Players of an Event side by side before their Match: each one's record, points and Archetype, and the earlier Matches between them at the Event, oldest first, or that this is their first meeting. Its Players come from a Feature Match Slot, following the Slot's current Feature Match Assignment, or are picked directly.
_Avoid_: meeting, when naming an earlier Match.

**Authored Stack**:
An ordered list in a Screen Mode's configuration holding authored content with no recovery path: the Background Screen's Background Layers and a Broadcast Graphics Screen's stack of Broadcast Graphics. A display reset leaves one untouched, and an edit may replace one but never delete it (ADR-0037).

**Background Screen**:
A Screen Mode rendering an ordered stack of Background Layers (ADR-0016).
_Avoid_: Idle screen, empty state

**Background Layer**:
One entry in an ordered Background Layer stack — a colour, gradient, image, video, or Animation Effect — owning its own enabled state and opacity. The Background Screen's configuration is such a stack, and every mode whose Screen Mode Definition declares one carries its own optional stack behind its content. Every plain overlay mode declares one; the graphics hosts do not, as they own their backgrounds and keep their outputs transparent. A Screen whose stack is empty paints its Theme's `background` Foundation Token, a stack of the same layers.
_Avoid_: background type, media background (when meaning a layer)

**Screen Media Source**:
Where a Screen's own image or video comes from: one exact Graphic Asset Revision, referenced like any other Graphic Asset, or a Remote Media URL. Image and video Background Layers, a Theme's `background` stack's included, and the Feature Match Overlay Frame's image and video take one; Graphic Items and Graphic Inputs never do, as their media is Graphics Asset Library content only (ADR-0021).
_Avoid_: media URL, asset source

**Remote Media URL**:
A Screen Media Source naming media by URL rather than by library revision, fetched by every rendering: an HTTPS URL to media the installation does not hold, or a root-relative path to media the application serves, which is only under `/video/`, never a route that serves Graphic Asset Content (ADR-0021). It is never a Graphic Asset Reference, so it protects nothing in the library. An HTTPS URL cannot travel in a Template Package; a root-relative path travels as data and resolves against whichever installation renders it.
_Avoid_: hotlink, external asset

**Animation Effect**:
A named, autonomously animating background renderer that ships with Stream Keepr, with its own per-effect configuration. Its hosts are the Feature Match Overlay Frame, a Background Layer (on the Background Screen and every plain overlay mode), and the Broadcast Graphics Background; the vocabulary is closed, so a config or package naming an unimplemented effect is refused rather than approximated (ADR-0014).
_Avoid_: Vanta effect, frame animation, shader background, background effect

**Animation Effect Preset**:
A user-created, installation-scoped, named Animation Effect selection: one effect and its parameters, with no host enabled state, opacity, or identity. Applying one copies it into the host as an independent value with no update link.
_Avoid_: Animation Effect Template, linked effect style

**Page Rotation**:
The deterministic projection of a paginated Screen Mode's current page from its Rotation Anchor and server time, computed identically by every rendering (ADR-0009). A paginated Screen Mode Definition declares it, naming its page size field; an edit of the page size or page duration changes the rotation's shape, restarting it from page 1 (ADR-0039).
_Avoid_: Auto-paging when naming the projection itself — auto-page is the operator toggle that turns rotation on.

**Top Cut Bracket**:
The single-elimination bracket a Top Cut Bracket Screen shows, derived from the Phase its operator picks, since nothing marks a Phase as a top cut: one column per Round of that Phase, in order, each Match at the Bracket Position its winner advances from into the next column. The first Round, with any byes it leaves out, sets its size; a Bracket Position no Match fills yet is pending, showing the winners advancing into it so far.
_Avoid_: bracket slot (a Slot is a Feature Match Slot)

**Seed**:
A Player's final position before a Top Cut Bracket's Phase began: their position in the Round Standings of the last Round holding Round Standings before that Phase's first Round, in the Event's Round order. A Player absent from that Round, or a Phase no such Round precedes, has none. Derived from stored Round Standings, never imported.
_Avoid_: rank, bracket position (a Bracket Position is where a Match sits)

**Rotation Anchor**:
The server timestamp a Page Rotation counts from, written only by an operator surface — when auto-page is enabled, when an edit changes the rotation's shape (a display reset among them), or when an operator selects a page mid-rotation. A Screen Output never writes it.

**Screen Card**:
The one Card a Screen in Card Spotlight mode shows, set and cleared by an operator. Only the Card read carries it; a Screen read never does (ADR-0022). Its Card revision advances on each save and Clear; every write answer, announcement and Card read carries it, and a holder applies only a state at least as new as the one it holds (ADR-0042).

**Card revision**:
The count a Screen Card's saves and Clears advance, never its expiry. A save's and a Clear's answer, `card:updated`, `card:cleared` and the Card read all carry it, so every holder orders the Card states it is handed and applies only one at least as new as the one it holds (ADR-0042).

**Card Timeout**:
A Screen Card's optional duration, after which every holder hides it by the shared clock. Expiry is a clock projection, like Page Rotation: no read, client or timer writes it, and nothing announces it (ADR-0022).
_Avoid_: auto-clear (nothing clears the Card when it runs out)

**Screen Output**:
A live rendering variant exposed by a Screen Mode Definition, such as overlay, fill, or key.
_Avoid_: Export mode when referring to live Screen rendering.

**Overlay Output**:
A Screen Output that renders the final composed colour and opacity over transparency.

**Fill Output**:
A Screen Output that renders the final composed colour flattened over black.
_Avoid_: Beauty when naming product concepts.

**Key Output**:
A Screen Output that renders the final composed opacity as a grayscale alpha matte.
_Avoid_: Black-and-white export, chroma key.

**Program monitor**:
A control surface's own live rendering of the Screen it drives. It composes what playout has taken, resolving media exactly as a Screen Output does, but is not a Screen Output.
_Avoid_: Preview — which composes the authored state its embedder pushes in and resolves media as the author. Confidence monitor.

**Screen Output Asset Capability**:
An opaque, long-lived, revocable right that lets one Screen Output resolve only the exact Graphic Asset Revisions its Screen currently publishes, its resolved Theme Tokens' included (ADR-0050), never Graphics Asset Library discovery. It is also the output's whole identity to the installation: it admits the lookup of its Screen, the reads of what that Screen publishes — its Event context and its mode's data, derived from the Screen's saved configuration — and a realtime grant narrowed to that Screen and its Event, in place of a Session (ADR-0010, ADR-0022).

### Client and live-state infrastructure

**Event Data**:
The client-side access path for Event-scoped data such as Players, Phases, Rounds, Matches, Feature Match Slots, Feature Match Assignments, Screens, Talents, Archetypes, Player Lists, and Player Decks.

**Realtime Event Session**:
The client-side subscription for Event messages.

**Realtime Subscription**:
A consumer's standing request to the realtime transport: a room handler, a channel handler, a presence watch, or a presence entry. The transport holds it from creation until its consumer disposes it, attaching it whenever its **Event** is covered; no failure ends one (ADR-0023).
_Avoid_: registration.

**Reconnect Resync**:
The client-side module owning the invariant "losing message continuity is itself a reason to re-read authoritative state." Realtime messages are notifications and the server holds authority, so a resync re-reads and never clears. It re-reads once the Event channel its consumer listens on is attached again having lost continuity, not when the connection comes back, which is before anything listens again (ADR-0023). A consumer listening on no Event yet re-reads when the connection comes back instead. A consumer that read before its Event channel first attached also re-reads once off that attach, which reports no continuity loss yet followed a window nothing listened in. It exposes the disconnection so a control surface can disable its actions, while an output on program does not.
_Avoid_: reconnect handler, resubscribe hook.

**Event Data Resync**:
The client-side module owning which Event Data this client consumes, so **Reconnect Resync** re-reads exactly that. Besides Event Data collections, it covers the operator's Event and the selected Screen's Card. A consumer names its datasets while mounted, with its own re-read of anything no store holds. Each consumed dataset is re-read once, in place. A held dataset nobody consumed at the resync is behind, and its next consumer re-reads it. The end of an **Event Lifetime** forgets what was behind (ADR-0028).
_Avoid_: refresh registry, reload list.

**Screen Mode Data Freshness**:
The client-side module owning the invariant "a Screen Output shows its Screen Mode's current data." A mode states what it reads and which Event Data messages touch what it holds; the module owns the initial load, live-follow on those messages from the Event channel, a slow re-read while realtime is degraded (disconnected, or its subscriptions waiting on a token for the Event the transport covers), the same slow re-read after its latest read failed, a re-read once its Event channel first attaches, and **Reconnect Resync**. A message or that first attach heard while a read is in flight asks for one follow-up read once it settles, rather than superseding it, so a burst of messages costs one more read per read in flight. Every re-read holds the last accepted rendering until it answers.
_Avoid_: mode refresh hook, per-mode live sync.

**Guarded Sequence**:
The client-side module owning the invariant "discard the result of async work that newer work has superseded." Scoped or keyed; issues Flights.
_Avoid_: generation counter, version guard, latest-wins map.

**Flight**:
A ticket for one unit of supersedable async work, checked for staleness after each await. Staleness is monotonic.
_Avoid_: request id, generation.

**Event Lifetime**:
The span of one Event's client-side state, from the store reset that begins it to the one that ends it. Coming back to an Event begins a new one, because the Event is loaded afresh. A write's continuation — merging its answer, rolling back, follow-up reloads — runs only while the Flight for the lifetime it began in is current; the caller still receives the answer (ADR-0024). The write itself still finishes for its own Event, at the revisions its lifetime last knew (ADR-0041).
_Avoid_: Event session, Event generation.

**Field Ownership**:
The set of fields one action may write, derived from the change the action predicts.
Client-side it is a scope rule: an optimistic action's merges and rollbacks write only its owned fields, and remote updates never overwrite fields another action currently owns.
Server-side it is an acceptance rule carried as a Field Ownership claim: a Set Input or Set Override states the effective value it believes it replaces (override, then resolving Graphic Input Binding, then working value or default). A claim still describing what its operator saw is applied; an overtaken claim is refused so the loser sees what landed. A command with no claim is applied unconditionally. The claim is re-checked whenever a command is re-reduced onto a newer state.
_Avoid_: owns array, field mask, declared ownership.

**Sequenced Live State**:
The server-side module owning the invariant "one authoritative order of accepted commands per live aggregate." It owns monotonic sequencing, compare-and-swap protection, Command Receipts, and the decision to announce a committed command; reducers, merge policies, and notification content stay with the feature. It also owns a live aggregate's epoch lifecycle: closing the active epoch, opening its successor, forgetting the ended epoch's Command Receipts in the same commit, and announcing the change only when the commit actually made one (ADR-0029).
_Avoid_: event store, event sourcing, command bus, write-ahead log.

**Live State Follower**:
The client-side module owning the client half of Sequenced Live State: whether what arrives for a followed live aggregate moves the held snapshot forward. Epochs are ordered by aggregate id (ADR-0026). It drops a duplicate notification and anything from an older epoch, refuses a command result from an older sequence or an older epoch, answers a gap, a newer epoch or a notification with no difference by reloading — unless the notification carries its whole snapshot — and supersedes overlapping loads as Flights. A snapshot another resource's read carries is held only when not behind, and supersedes no load. Reconnect Resync re-reads through its load, or through a read of the resource that carries the snapshot (a Feature Match Slot on a Screen Output); neither clears what is held. The feature supplies only where it holds a snapshot and how to apply a full state or a difference.
_Avoid_: sequence guard, live session sync, client event store.

**Command Receipt**:
The record that one command ID was already accepted for a live aggregate, holding the command's canonical content so a retry is answered with the current authoritative snapshot and a reused ID with different content is rejected. Retained for a bounded window, not as history.
_Avoid_: event row, command log, audit record, idempotency key.

**Batch Command**:
One Feature Match Session command carrying the absolute setter commands of a multi-field operator save, sequenced, receipted, and announced as one so the save lands whole or not at all. Relative commands stay out because wrapping one forfeits its merge-retry semantics.
_Avoid_: bulk update, transaction, multi-command, command group.

### Identity and access

**User**:
An account a Graphics Administrator created for one person, holding their credential and display name. It is the installation's only durable identity and the one that owns work, so an operation survives the browser that started it. There is no self-signup (ADR-0010).
An explicitly bypassed local runtime supplies one synthetic **Local Developer User** as the development-only exception: stable identity, no directory row, and present only when a `:bypass` launcher script asked for it by name (ADR-0017).
_Avoid_: author, graphics author — roles a user acts in, not the identity; account is acceptable when the subject is the credential.

**Session**:
One signed-in browser: server-side, revocable, and expiring seven days after its last day of use. It admits a request — the deny-by-default boundary over `/api/**` requires one (ADR-0010) — and is the granularity of a Graphics Authoring Lease, because one person in two browsers is two concurrent editors. A Session never owns work.
While the development bypass is active, each browser receives a synthetic **Local Developer Session**: stable per browser via a local cookie, not persisted, revocable, or expiring, but with the ordinary Session's request-admission and lease semantics (ADR-0017).
_Avoid_: Graphics Author Session (the retired anonymous identity); login, which names the act.

**Password Reset Link**:
The single-use, expiring credential a Graphics Administrator hands a person out of band to set their own password — both a new account's first password and a forgotten one's replacement, since the installation sends no email (ADR-0010). It is returned exactly once and never stored; its token travels in the URL fragment. Redeeming it sets the password and ends every Session the account holds, without creating one or lifting a ban.
_Avoid_: invite token, activation link.

**Graphics Administrator**:
Whoever presents the installation's shared administrator credential, authorised to create and manage User accounts, operate the Operations Cockpit and Operational Queues, and change Graphics Asset Library Capacity limits. The credential alone admits: no Session or User is required, until a roles effort redraws that seam (ADR-0010).

**Graphics Authoring Lease**:
The exclusive, Session-scoped right to edit one graphics authoring artifact: a Screen's complete graphics Edit workspace or one reusable graphics Template. Other Sessions may observe accepted changes but cannot modify the leased artifact.

### Theming

**Theme**:
A named, installation-scoped set of Theme Token values giving every Screen of an Event one look and feel, whatever its Screen Mode. It holds values, never compositions: it may supply a logo a Broadcast Graphic shows, but the Broadcast Graphic itself is a template's. An Event uses one Theme; a Theme may serve many Events. An edit reaches every Screen using it at once, with no draft or publish step. It themes what Screens render, never the operator app.
_Avoid_: Style Set, brand, skin, palette (when naming the whole)

**Default Theme**:
The built-in Theme that ships with Stream Keepr, used by every Event that picks no Theme. It is read-only: it cannot be edited or deleted.
_Avoid_: base theme, fallback theme

**Theme Token**:
One named value a Screen may consume from its Theme, such as a colour, font, or Graphic Asset. Stream Keepr owns every token's name, type, and where it may be consumed; users set values, never names.
_Avoid_: variable, style entry

**Foundation Token**:
A Theme Token naming an application-wide role any Screen Mode may consume, such as the accent colour, the heading font, or the screen inset. Every one has a default value shipped with Stream Keepr.

**Mode Token**:
A Theme Token a Screen Mode Definition declares for its own rendering, such as a Standings row's surface. Its default is a Foundation Token, so a new Screen Mode follows every existing Theme unchanged.
_Avoid_: component token

**Screen Theme Override**:
A Screen's own value for one Theme Token, used by that Screen in place of its Theme's. Clearing it returns the Screen to the Theme's value.
_Avoid_: local style, pin

**Event Canvas**:
The pixel coordinate space every Screen of an Event is authored and rendered in, default 1920 × 1080. A Screen Output scales it uniformly to fit its window, so output resolution is not the canvas's to set.
_Avoid_: screen size, resolution

**Event Presentation Settings**:
What an Event sets once for every Screen it has: its Theme, its Event Canvas, and its on-air wording and formatting, such as the record separator, position format, holding text, and Untimed Label. Wording stays here rather than in the Theme, so a Theme can serve Events that word things differently.
_Avoid_: on-air formatting (when naming the whole group)

**Screen Mode Sample Dataset**:
One fixed canonical set of Event Data a Theme preview renders every Screen Mode against. Like the Feature Match Sample Dataset, it never appears on a live Screen Output.
_Avoid_: dummy data, test data

**Graphic Theme Binding**:
A Graphic Item property group, or a Broadcast Graphic's enter, update or exit recipe, that names one whole Foundation Token of its type rather than holding its own value: a typography, a text or icon colour, a Graphic Surface Style, a Graphic Fill, a Shape Geometry, a Graphic Animation Recipe, or a Media Graphic Item's picture, from an asset token such as the logo. The compositor paints it from the Screen's resolved Theme. Detaching copies the resolved value in as the property's own; binding replaces it; editing it detaches it.
_Avoid_: style reference, pin, override, Graphic Input Binding (which maps a Graphic Input to Event Data)

### Broadcast Graphics

**Broadcast Graphics Screen**:
A Screen in Broadcast Graphics mode whose output composes an ordered stack of concurrently visible Broadcast Graphics.

**Broadcast Graphics Background**:
The one Animation Effect a Broadcast Graphics Screen composes its stack over, with its own enabled state and opacity. It renders in the Overlay and Fill Outputs, never the Key Output.
_Avoid_: Screen background, backdrop graphic, background layer (a Background Layer stack is what the plain overlay modes carry; a graphics host composes over this instead)

**Broadcast Graphic**:
An authored visual composition that an operator shows, hides, and controls as one unit on a Broadcast Graphics Screen.

**Broadcast Graphic Template**:
A user-created reusable Broadcast Graphic that can be copied into a Broadcast Graphics Screen and transferred between Events. Templates are not live Screen state. Each has a stable identity and managed revision; placing or importing one creates an independent copy with no update link.

**Broadcast Graphics Live Session**:
The continuous playout epoch of a Broadcast Graphics Screen. It survives reloads, disconnections, and restarts, and ends when the Screen leaves Broadcast Graphics mode or its live state is explicitly reset. Commands from an ended Live Session never affect a later one.

**Broadcast Graphics Live State Change**:
What one accepted command changed about a Broadcast Graphics Live Session's live state, per Broadcast Graphic, carried by the realtime notification instead of the state itself. A peer at the immediately preceding sequence applies it; a peer offered none (too large, a recognised repeat, or indescribable) reloads the authoritative snapshot (ADR-0004).
_Avoid_: patch, delta, diff, partial state, incremental update.

**Broadcast Graphics Recovery Fault**:
Why the durable live state behind a Broadcast Graphics Live Session could not be trusted: missing, corrupt (wrong shape), or incompatible (a value this build cannot interpret). It is derived on every read; while it stands, readers act on a state with nothing on air, and the first accepted command — in practice an explicit Take — clears it. A stale animation start time is not a fault.
_Avoid_: corrupt state flag, live state validation error.

**Graphic Input**:
A named, required-or-optional presentation value declared by a Broadcast Graphic Template, typed text, number, toggle, choice, color, or media. It may be entered manually or resolved from a type-compatible Event Data field, but never exposes a whole Event Data entity.

**Graphic Source Selection**:
A named, single-entity Event Data selection owned by a placed Broadcast Graphic. It resolves from the current Event, an operator selection, or a fixed relationship from another Graphic Source Selection; it is not a collection query.

**Graphic Input Binding**:
An Event-specific, type-compatible mapping from a Graphic Input to one broadcast-facing field on a Graphic Source Selection, drawn from a curated stable field catalog rather than Event Data storage or API properties.

**Graphic Input Override**:
An operator-supplied typed value that takes precedence over a Graphic Input Binding without replacing it. It persists across hide/show cycles until cleared, while the binding keeps resolving underneath.

**Graphic Input Status**:
What Live Control reports about one Graphic Input's value: manual (no binding), bound (binding agrees with program), overridden, pending (would-go-on-air differs from on-air), unavailable (nothing valid could go on air), superseded (this operator's edit lost a field-scoped race and was refreshed), or stale (on air holding a value its binding no longer provides). When several apply, the first in order superseded, stale, unavailable, overridden, pending, bound, manual is reported. Command rejection codes are a separate vocabulary describing a command's fate.
_Avoid_: stale-input-edit, command rejection codes when naming a value's status.

**Live Control**:
The operator-facing controls generated for a placed Broadcast Graphic from its Graphic Source Selections and Graphic Inputs. It selects sources, edits values and overrides, stages updates, and controls playout without authoring bindings, custom controls, queries, or expressions.

**On-air Update Policy**:
Whether a Graphic Input change is staged for operator confirmation or applied immediately to an on-air Broadcast Graphic. Staged values are accepted atomically through Update Graphic; a template recommends the policy and the operator may override it per placed graphic.

**Graphic Playout State**:
The operator-visible lifecycle status of a placed Broadcast Graphic: off, waiting, entering, on-air, updating, or exiting. Waiting means selected by an Out then in Graphic Channel handoff but off every program output until the outgoing graphic finishes.
_Avoid_: Visibility when referring to lifecycle or transition status

**Graphic Channel**:
An optional playout lane on a Broadcast Graphics Screen allowing at most one of its Broadcast Graphics on air at a time. Graphics in different channels may be on air concurrently.
_Avoid_: Layer when referring to mutual-exclusion behaviour

**Graphic Channel Handoff Policy**:
The per-Graphic Channel rule for replacing its selected Broadcast Graphic: Overlap starts the outgoing exit and incoming enter together; Out then in waits for the outgoing exit to complete.

**Cut**:
An execution modifier that makes Take, Update Graphic, or Out reach its target immediately without running the corresponding Graphic Animation phase. It never changes authored recipes or another action already in progress.

**Social Profile Projection**:
A named Broadcast Graphic presentation controller that references a Talent Graphic Source Selection and atomically supplies the current Social Profile's network key, label, handle, and profile URL to independently authored Graphic Items. A Broadcast Graphic may declare several, each with its own rotation, Presentation Group, and Live Control; Feature Match Overlay does not consume them (ADR-0011).

**Social Network Icon Graphic Item**:
A Graphic Item rendering the application-owned vector icon for one statically selected Supported Social Network or the current network of one Social Profile Projection. It is not a Graphic Asset.

**Social Profile Presentation Group**:
The ordinary Graphic Group associated one-to-one with a Social Profile Projection, containing its icon, text, and decoration consumers. The projection transitions the whole group together; its projected values cannot be overridden.

**Social Profile Rotation**:
The default-on, on-air-only progression of a Social Profile Projection through its Talent's Social Profiles, with an eight-second default dwell configurable from two to sixty seconds. Its state belongs to the Broadcast Graphics Live Session; a Take or selection re-anchors the dwell, and every rendering projects the advance from server time without writing.

**Social Profile Transition**:
The synchronized visual change between profiles in a Social Profile Rotation: Cut, Crossfade, Slide Left, Slide Right, Slide Up, or Slide Down, lasting 100–2,000 ms (default 250). A newer target replaces rather than queues; an explicit Update Graphic uses its own update animation instead.

### Graphic Style Sets and Template Packages

**Graphic Style Set**:
A named reusable authoring resource, shared across the graphics template libraries, holding Graphic Style Set Entries that keep a cohesive visual and motion language across Broadcast Graphic Templates and Feature Match Layout Templates. Events consume but never own one.
Its entry kinds are palette (each one a Palette Entry), typography, Graphic Fill, Graphic Surface Style, media treatment, Shape Geometry, and Graphic Animation Recipe. It never holds Graphic Item trees, layout structure, or Graphics Asset Library content; typography references application fonts only (ADR-0001).
Edits accumulate in a working draft and become a Style Set revision only through an explicit atomic publish (deleting a published entry is the one exception). Linked templates receive an update to review and apply as a new template revision, preserving their property-level overrides; placed graphics never change automatically.

**Graphic Style Set Entry**:
One named, bounded value in a Graphic Style Set that templates link to rather than copy, so a published change reaches them as a reviewable update.
_Avoid_: Preset — which initialises a value by copying it, with no link.

**Palette Entry**:
A Graphic Style Set Entry holding one freely named colour, with no opacity and no fixed role: the consuming property owns opacity, and what the colour does is decided by whatever references it. Every other colour-bearing entry, such as a typography, Graphic Fill or Graphic Surface Style entry, stores a Palette Entry's id rather than a colour, so a brand colour changed once reaches every entry linking to it.
_Avoid_: palette colour (the colour a Palette Entry holds, not the entry), colour role (the palette is open-ended and assigns none).

**Graphic Style Set Package**:
A single-Style-Set portable `.skstyle` archive, carrying one published revision and no templates or asset files; it declares the application fonts it needs and a receiver missing one refuses it. It follows the Template Package principles; an import never field-merges and may always install as an independent copy.

**Template Package**:
A single-template portable artifact transferring one Broadcast Graphic Template or one Feature Match Layout Template. Both kinds share the envelope, asset handling, validation, migration, conflict, and atomic installation contract while keeping separate payloads, libraries, and workflows.
_Avoid_: Mixed template package, Event-wide template package

**Template Package Preflight**:
The complete inspection a received Template Package passes before anything may be installed, run as a Graphics Ingestion Operation over staged archive bytes: archive safety and envelope limits, deterministic schema migration, revalidation under the receiver's current Graphic Asset Compatibility Profile, local derivative regeneration, and one Template Package Preflight Report. Preflight never installs anything.

**Template Package Preflight Report**:
The one immutable result of Template Package Preflight, carrying migrations, revalidation outcomes, mapping proposals, quota impact, and every issue with a stable code and remediation. Package errors terminate the operation; exhausted local capacity is retryable. Warnings pause it once for a confirmation bound to its Preflight Report Fingerprint.
_Avoid_: Import preview, dry-run result

**Preflight Report Fingerprint**:
The identity of one exact preflight proposal — archive bytes, compatibility profiles, proposed mappings, and issues, but not the clock. A confirmation is valid only for the fingerprint it names.

**Template Package Mapping Proposal**:
How one packaged asset identity would become a local Graphic Asset, decided by provenance: an exact Graphic Asset Origin match reuses the local revision; a related revision, digest-only match, or new content creates a separate local Graphic Asset (reusing canonical bytes where the digest exists). The same origin identity and revision with a different digest rejects the whole package.

**Template Package Installation**:
The one atomic act turning a confirmed Template Package Preflight Report into local state. It re-derives the report from the same staged bytes and installs only while the conclusion matches what was confirmed; bytes and derivatives are written first, then one transaction publishes every asset, revision, origin, association, rewritten reference, and the Installed Graphics Template. Repeating it answers with the installation already committed.

**Installed Graphics Template**:
The independent local copy of the single Template a Template Package carried, with its own identity and managed revision. Its Graphic Asset References already point at exact local revisions and protect them; the source identity is provenance only.
_Avoid_: Imported template, template installation record.

### Graphics Asset Library

**Graphics Asset Library**:
The shared graphics-specific module that ingests, validates, stores, resolves, deduplicates, and lifecycle-manages images, silent videos, fonts, and generated thumbnails for Broadcast Graphics and Feature Match Overlay. It is not a general file manager.

**Library Workspace**:
The author-facing surface over the Graphics Asset Library for discovering, ingesting, renaming, re-associating, and moving Graphic Assets through Retire, Trash, and Restore, working as the signed-in User.
_Avoid_: Graphics Asset Library Workspace, asset manager, library page

**Graphics Asset Library Capacity**:
The installation-wide storage envelope comprising the Canonical Graphics Quota and Graphics Staging Allowance.

**Canonical Graphics Quota**:
The limit on deduplicated retained Graphic Asset Content and Graphics Derivative bytes, including retained revision history and Trash.

**Graphics Staging Allowance**:
The separate limit on provisional bytes held by incomplete Graphics Ingestion Operations, and by terminal ones whose staged input release has not yet been proven: their bytes stay counted, and listed as unreleased staged input, until the byte store confirms the deletes.

**Canonical Capacity Pressure**:
The normal, warning, critical, or full state derived from use of the Canonical Graphics Quota.

**Graphic Asset**:
A stable-identity library resource for a validated image, silent video, or font, owned by the installation-wide Graphics Asset Library and reusable across Events. Events may associate with or reference one but never own it.

**Retired Graphic Asset**:
A Graphic Asset hidden from discovery and unavailable for new references while existing references keep resolving. An asset a saved template, a Theme or a Screen Theme Override references cannot be retired (ADR-0034, ADR-0050). It may be restored.

**Trashed Graphic Asset**:
An unreferenced Graphic Asset removed from discovery and new references, restorable for 30 days; afterwards it is purged only after a fresh proof that no reference points to any revision.

**Graphic Asset Content**:
One immutable validated byte payload and its technical media facts, identified by the SHA-256 digest of its exact stored bytes, independent of filenames and library metadata.

**Graphic Asset Revision**:
An immutable content-bearing version of one Graphic Asset, created when its file content changes. Metadata changes do not create one.

**Graphic Asset Reference**:
A persisted link from one graphics artifact to one exact Graphic Asset identity and revision. A revision is in use exactly when a reference points to it.

**Graphic Asset Origin**:
The immutable source identity, revision, and digest recorded on the local Graphic Asset Revision a Template Package installed, recognising related later imports without creating a cross-installation identity or link.

**Missing Graphic Asset Reference**:
A Graphic Asset Reference whose asset or pinned revision does not exist: an integrity failure that never falls back to another revision.

**Unavailable Graphic Asset Content**:
The retryable state in which a referenced asset and revision exist but their bytes cannot currently be resolved. It never changes the reference; the catalogue's record of it is advisory, and the byte store is the only current source.

**Graphic Asset Validation**:
Strict acceptance proving exact source bytes are safe, supported, decodable, and consistent, without changing them. Unsupported content is rejected; previews are separate Graphics Derivatives.

**Graphic Asset Compatibility Profile**:
The versioned contract of accepted formats, bounds, validation rules, and output requirements applied to every ingestion path. Each Graphic Asset Revision records the profile it was accepted under.

**Graphics Ingestion Operation**:
A durable, reconnectable workflow receiving a local upload, approved remote copy, file replacement, or Template Package, publishing the complete result atomically or nothing. Its provisional content is never discoverable or referenceable.

**Graphics Derivative**:
A generated thumbnail or preview dependent on one source Graphic Asset or graphics Template revision, inheriting its access and lifecycle and never itself a Graphic Asset.

**Graphics Retention Sweep**:
The scheduled pass that reclaims only state proven unreachable past its full recovery guarantee: expiring staged input, Revision Pruning, purging eligible Trash, collecting unreachable content, and Evidence Sealing. A missed sweep only retains state longer.

**Revision Pruning**:
Removal of a superseded Graphic Asset Revision no reference reaches, 90 days after it became unreferenced. Latest and referenced revisions are never pruned; a new reference cancels pruning and Trash pauses it.

**Graphic Asset Tombstone**:
The durable proof that a Graphic Asset identity was purged, recording when, why, and the reference proof. It prevents resurrection and identity reuse.

**Early Purge**:
An explicitly confirmed Graphics Administrator action purging an unreferenced Trashed Graphic Asset before its 30-day window, with the same fresh reference proof and tombstone as scheduled purge. Storage pressure never shortens the window on its own.

**Content Quarantine**:
The holding state for Graphic Asset Content whose last reachability disappeared, kept seven days and rechecked before deletion; content reached again is released.

**Graphics Reconciliation**:
The pass, scheduled and triggered by readers observing integrity failures, comparing the content the catalogue expects against the bytes the store holds. The catalogue is authoritative for expected reachability, the byte store only for present bytes.

**Graphics Discrepancy**:
One durable disagreement between catalogue and byte store, with its evidence, affected pinned usage, and the actions valid in its state. It names its subject by opaque domain identity, never object key, digest, or bucket.

**Critical Integrity Incident**:
A Graphics Discrepancy where stored bytes contradict their owning digest, an object contradicts its integrity metadata, or a canonical object has no digest-owned identity. It fails closed and is isolated from repair, regeneration, and deletion.

**Exact-Byte Repair**:
The Graphics Administrator action restoring Unavailable Graphic Asset Content from supplied bytes proving the same digest, size, media type, and validation facts. It creates no revision and changes no reference.

**Deep Verification**:
The Graphics Administrator action that re-reads and re-hashes stored bytes in full, detecting changes behind unchanged size and media type. It writes nothing, is the only action on a Critical Integrity Incident, and can release a verified Content Quarantine copy.

**Derivative Regeneration**:
Reproduction of a missing Graphics Derivative from available source content. It must reproduce the exact recorded bytes; anything else is a Critical Integrity Incident.

**Evidence Ledger**:
The chronological administrator-facing record of automated Graphics Asset Library lifecycle and reconciliation decisions, naming actor, transition, reference count, bytes, quota state, deadline, outcome, and reason — never keys, digests, filenames, URLs, or secrets. Authoring metadata edits (rename, Event re-association) are not ledger material.

**Evidence Terminal Cleanup**:
The recorded event saying an Evidence Ledger subject is finished — a purge, Revision Pruning, content deletion, staged input expiry, or settled Graphics Discrepancy. An entry's one-year retention counts from its subject's last one; until then it never expires.

**Evidence Sealing**:
The Graphics Retention Sweep stage stamping the one-year expiry onto unsealed Evidence Ledger entries whose subject has recorded an Evidence Terminal Cleanup. Sealing and expiry write no Evidence of their own.

**Evidence Category Group**:
The operational vocabulary the Evidence Ledger is filtered by — ingestion, lifecycle, pruning, purge, quarantine, reconciliation, repair, regeneration, restoration — each a set of categories. Groups overlap deliberately.

### Library operations

**Operations Cockpit**:
The administrator-only surface answering, in one reading, whether the Graphics Asset Library is safe and what needs attention. It composes Library Component Condition, Storage Health Alerts, capacity, unfinished ingestion, the discrepancy backlog, deadlines, and recent Evidence, holding no state of its own.
_Avoid_: dashboard, storage admin panel.

**Library Component Condition**:
Whether one library component can answer and agrees with the other side: healthy, degraded, or unavailable. The catalogue and the byte store are always judged separately.

**Storage Health Alert**:
One open call on a Graphics Administrator's attention — critical, warning, or info — derived from durable state rather than remembered, so a persistent one survives reload until its subject is resolved.

**Graphics Ingestion Attention State**:
What an unfinished Graphics Ingestion Operation needs now: expired staged input, retryable, awaiting confirmation, or working. Expiry is decided first; terminal operations have none.

**Operational Queue**:
One risk-ordered list of Graphics Asset Library work grouped by what is wrong with it, holding a complete count and a deadline-ordered sample. One queue per operational state — Critical Integrity Incident, Unavailable Graphic Asset Content, missing Graphics Derivative, retryable ingestion, expired staged input, unreleased staged input, Trashed Graphic Asset, superseded Graphic Asset Revision, quarantined object, Retired Graphic Asset — kept distinct because the valid action differs.
_Avoid_: work list, task list, incident bucket.

**Queue Inspector**:
The administrator detail surface for one Operational Queue item: identity, state, deadline, affected usage, catalogue expectation beside byte evidence, filtered Evidence, and only the valid actions. Its selection lives in the address and every reading is composed afresh.

**Queue Action Outcome**:
The vocabulary every Operational Queue action reports in: completed, already-in-state, reference-blocked, retryable-unavailable, or integrity-conflict. Already-in-state means the subject already was how the action asks, never that it ran and fixed nothing.

### Shared Graphics Foundation

**Shared Graphics Foundation**:
The Graphic Item, geometry, styling, grouping, animation, definition, and rendering vocabulary used by both Broadcast Graphics and Feature Match Overlay, unifying their composition model without merging their Screen Modes, live context, or template artifacts.

**Host Contract**:
The declaration a graphics Screen Mode supplies when embedding the shared compositor: available context kinds, top-level host extras, canvas rules, and write semantics. Capability outside it stays host-owned.

**Graphic Item**:
A visual part within a Broadcast Graphic or Feature Match Layout, such as text, media, or a shape. Items are edited individually but never taken on or off air independently of their composition; an item whose live data is empty renders nothing while remaining on air.
_Avoid_: Element, Widget

**Graphic Item Definition**:
The application-owned contract for one Graphic Item kind: identifier and configuration version, schema and defaults, editor controls, renderer behaviour, migration, and asset-reference discovery. Definitions ship with Stream Keepr; templates never provide executable ones, and an import referencing an unsupported one fails atomically. A Definition may require a host or data context.

**Text Graphic Item**:
A Graphic Item that renders literal text or a Graphic Text Template.

**Graphic Text Template**:
A string combining literal text with `{inputKey}` placeholders for Graphic Inputs, rendered by a Text Graphic Item. A Broadcast Graphic may also reference a Social Profile Projection as `{projectionKey.networkLabel}`, `{projectionKey.handle}`, or `{projectionKey.profileUrl}`. No other property access, formatting, fallbacks, conditionals, or expressions exist.
_Avoid_: Expression when referring to placeholder substitution

**Graphic Placeholder Style**:
An optional typography-only override for one placeholder or projection reference in a Text Graphic Item. Literal text uses the item's base typography.

**Graphic Font Selection**:
Which font a Graphic Item's typography or Graphic Placeholder Style paints with: one application font shipped with Stream Keepr, or one exact font Graphic Asset Revision referenced like any other Graphic Asset.
_Avoid_: Font family, font stack

**Text Overflow Policy**:
The behaviour when the text of a Text Graphic Item, Clock Graphic Item, or Player Life Graphic Item exceeds its bounds: clip, ellipsis, or shrink to an author-set minimum size and then ellipsis. Text never visibly overflows. A live string can be longer than the author ever saw, which is why the Clock and Player Life carry one too; whether a kind has one is its Graphic Item Definition's to declare.

**Media Graphic Item**:
A Graphic Item rendering an image or silent video with a Media Fit, focal position, opacity, and optional Shape Geometry clipping. Video has playback-rate and looping controls and starts from the beginning when its Broadcast Graphic enters.

**Media Fit**:
How an image or video fills the box it is drawn in: cover, contain, or fill. One vocabulary shared by Media Graphic Items, media treatment Graphic Style Set Entries, image and video Background Layers, and the Feature Match Overlay Frame's image and video.
_Avoid_: object fit, scaling mode

**Shape Graphic Item**:
A Graphic Item that renders a bounded Shape Geometry.

**Deck List Graphic Item**:
A feature-match-context Graphic Item rendering one player side's Sideboard as cards or a text list within its bounds, with no framing, labels, or board choice of its own. An empty Sideboard renders nothing.

**Clock Graphic Item**:
A context-gated Graphic Item that renders the active Feature Match Session clock, the Untimed Label for an Untimed Match, or nothing at all while that label is blank.

**Player Life Graphic Item**:
A context-gated Graphic Item that renders one Player's life total.

**Game Wins Graphic Item**:
A context-gated Graphic Item that renders one Player's game-win indicators.

**Shape Geometry**:
A parameterised rectangle with independently square, rounded, or cut corners and bounded left or right edge slant. Rectangle, rule, slanted-edge, and corner-cut presets initialise the same geometry rather than distinct types.

**Graphic Group**:
A structural Graphic Item arranging direct context-available Graphic Items as a row, column, or canvas, optionally coordinating clipping or animation and supplying overridable local style defaults. Graphic Groups do not nest.

**Graphic Surface Style**:
The shared visual treatment for the Graphic Items that paint a surface (Text, Shape, Graphic Group, Clock, Player Life, and Game Wins, which paints its win boxes with two more): fill, fill opacity, a uniform outline around the Shape Geometry, and glow. An independently styled edge is a separate Shape Graphic Item from the rule preset.

**Graphic Fill**:
A solid colour or a linear gradient with an angle and two to four positioned stops with opacity. Complex surfaces are Media Graphic Items.
_Avoid_: Raw CSS gradient

**Graphic Layer Order**:
The back-to-front order of sibling Graphic Items within a Broadcast Graphic or Graphic Group; a group is one layer among its siblings.
_Avoid_: Author-editable z-index

**Graphic Anchor Point**:
One of nine points on a canvas-positioned Graphic Item that fixes its displayed position during resize. Stored geometry stays a top-left rectangle; it is not a responsive constraint or animation origin.

**Geometry Unit**:
An authoring projection of canonical pixel geometry or motion distance as pixels, a percentage of the containing canvas or Graphic Group, or a centred 32-unit grid. It serves Graphic Items and Source Items alike and changes display and entry only.
_Avoid_: Graphic Geometry Unit, ±16 unit

**Editor Focus Mode**:
A per-browser authoring preference that gives a graphics Edit workspace — the Feature Match Overlay editor's or the Broadcast Graphics Screen's — the whole page by hiding the app sidebar and the Screen-level cards around it. One setting serves both editors; it is entered and left only through the editor's own toggle, and never applies to the Broadcast Graphics Live workspace. It changes layout only.
_Avoid_: Fullscreen (the browser's own mode), zen mode

**Graphic Rotation**:
The optional static rotation of a canvas-positioned Graphic Item around its Graphic Anchor Point. Row and column items do not rotate; skew, perspective, and raw transforms are not exposed.

**Graphic Animation**:
The recipe-based motion owned independently by a Broadcast Graphic or Graphic Item through enter, on-screen, update, and exit phases. Whole-graphic and item motion compose; there are no arbitrary keyframes.
_Avoid_: Keyframe timeline, motion path, animated effect stack

**Graphic Animation Recipe**:
A bounded combination of at most one fade, slide, scale, and reveal channel, running simultaneously with shared timing and easing.

**Graphic Resting State**:
The authored geometry and appearance of a Broadcast Graphic or Graphic Item while settled on air. Recipes move relative to it and never change it.

**Graphic Animation Origin**:
One of nine points determining the apparent origin of a scale channel, defaulting to centre and independent of the Graphic Anchor Point.

**Graphic Animation Preview**:
Deterministic editor-only playback of one lifecycle phase or a full lifecycle, optionally at varied speed or looping. It never changes live Screen state and has no playhead, scrubbing, or keyframes.

### Feature Match Overlay

**Feature Match Overlay**:
A Screen Mode rendering a production-ready Feature Match Layout for a Feature Match Slot, including external video source areas, Graphic Items, frame graphics, and fill/key outputs.
_Avoid_: Generic overlay editor

**Feature Match Layout**:
The authored arrangement a Feature Match Overlay renders: the Frame, its Source Items, and one composition of ordered Graphic Items. The Frame and Source Items are host-owned. It is portable so it can be saved as a Feature Match Layout Template.
_Avoid_: Overlay config

**Feature Match Overlay Frame**:
The continuous graphic area of a Feature Match Layout behind and around its Layout Items. Its fill, border, glow, Theme media and Animation Effect are the Feature Match Overlay's Mode Tokens; the layout holds its opacity, its own image and video, and which edges its border runs along.
_Avoid_: Panel area, background panel

**Feature Match Layout Item**:
A Graphic Item placed in a Feature Match Layout; layouts use the shared Graphic Item hierarchy.
_Avoid_: Region

**Source Item**:
A host-owned Feature Match Overlay element placing an external video source, with optional Frame cutout and source framing: its corner radii, border sides and glow position. Its fill, border and glow are the Feature Match Overlay's Source Item surface Mode Token. It is not a Graphic Item and lives in the layout's own Source Item list.
_Avoid_: Source Region, camera box, Source Graphic Item

**Feature Match Overlay Preset**:
A built-in starting point that initializes a Feature Match Layout.
_Avoid_: Template when referring to the whole layout preset.

**Feature Match Layout Template**:
A user-created reusable Feature Match Layout that can be copied into a Screen's Feature Match Overlay configuration. It carries no Feature Match Slot assignment, and placing one replaces the Screen's whole layout as an unlinked copy.
_Avoid_: Preset when referring to user-owned reusable layouts.

**Feature Match Layout Host Vocabulary**:
The terms a Feature Match Layout uses whose meaning the installation supplies: Source Roles and Feature Match tokens a Graphic Text Template binds. Each is closed and pinned by the layout format version, so a package naming an unimplemented term is refused. The Frame's Animation Effect was one until it became a Mode Token; its identity is still recognised.
_Avoid_: Free-form role, camera name

**Feature Match Sample Dataset**:
One fixed canonical set of Feature Match values a preview resolves a Feature Match Layout against when no Feature Match Slot is bound. It never appears on a live Screen Output.
_Avoid_: Dummy data, test data

## Relationships

### Tournament and Feature Match production

- An **Event** contains **Players**, **Phases**, **Rounds**, **Matches**, **Feature Match Slots**, **Feature Match Assignments**, **Screens**, broadcast configuration, game-specific settings, and optional **Melee Sync** configuration
- **Players**, **Phases**, **Rounds**, **Matches**, **Feature Match Slots**, and **Deck Lists** carry **Provenance** when they originate from **Melee Sync**
- A **Phase** contains ordered **Rounds**; a **Round** contains zero or more **Matches** and **Feature Match Assignments**, and may have **Round Standings**
- **Melee Sync** never removes a manual **Round** or **Match**: an imported **Phase** or **Round** that leaves Melee.gg, or that a Melee data reset would remove, while holding one is kept as a manual one, its **Provenance** cleared, and the operator is told which (ADR-0040)
- A **Match Result** comes only from **Melee Sync**; a manual **Match**, including one kept under ADR-0040, has none, and no Player's record, history, Head-to-Head or **Top Cut Bracket** reads one an operator entered (ADR-0047)
- A **Feature Match Slot** belongs to exactly one **Event** and may reference at most one current **Match**
- A **Feature Match Assignment** connects exactly one **Match** to exactly one **Feature Match Slot** for exactly one **Round**, and may have one **Feature Match Note**
- Within one **Round**, a **Match** and a **Feature Match Slot** each have at most one **Feature Match Assignment**
- A **Feature Match Slot Promotion** creates or updates one **Feature Match Assignment**
- A **Feature Match Session** belongs to exactly one **Feature Match Slot**; while active, the Slot's identity binding fields resolve from the session's source snapshot and its live binding fields from the session's current state

### Screens and outputs

- A **Screen** has exactly one current **Screen Mode**
- A Deck **Screen Mode** has exactly one **Deck Source**: either no Player or one Player from the Screen's **Event**, or one **Broadcast Deck List** from that Event while Broadcast Deck Lists are enabled
- A selected **Broadcast Deck List** prevents deleting that list or disabling Broadcast Deck Lists; deleting the whole **Event** is the cascade exception
- Deleting a selected **Player**, alone or in a Melee data reset, clears every **Deck Source** naming them to no Player in the same write (ADR-0032)
- **Broadcast Graphics Screen** and **Feature Match Overlay** each expose **Overlay Output**, **Fill Output**, and **Key Output** variants with identical canvas dimensions, all derived from one final composed frame
- A graphics **Screen Output** uses one stable Screen URL with an output selection; an omitted or invalid selection renders the **Overlay Output**
- At the same authoritative time, every graphics **Screen Output** resolves the same composition and animation phase; a late-loading or reconnected one catches up rather than replaying
- The **Feature Match Overlay**'s Sideboard reveal is the host-local exception: each output plays the **Deck List Graphic Item**'s authored enter or exit on its own clock from when it observes the reveal flag change, so outputs agree within realtime skew rather than at one authoritative time. First load and reload render the settled frame; an output that was disconnected across the change plays the motion late on **Reconnect Resync** rather than catching up (ADR-0015)
- Application-level output alignment does not promise hardware genlock between browser windows or capture devices
- A **Screen Output** renders its **Event Canvas** scaled uniformly to fit its window, letterboxed, whenever its **Screen Mode Definition** registers viewport-fit scaling
- Every realtime-fed surface re-reads authoritative state on **Reconnect Resync**; a reconnected **Screen Output** renders the current **Screen Mode** without waiting for the next change
- A **Screen Output** whose realtime link is disconnected holds its last accepted rendering rather than blanking
- A client that cannot mint a realtime token for its **Event** re-attempts, and reports a persistent failure where an operator can see it
- A **Realtime Subscription** outlives any token or transport failure until its consumer disposes it; once its **Event** recovers, the original handler receives again — and a held presence entry enters — without a remount (ADR-0023)
- Only a **Screen Output** enters its **Screen**'s presence and answers its **Screen**'s commands; a **Program monitor** or preview joins neither, so every count of what is watching a **Screen** counts outputs alone
- A **Screen Output** carries its **Screen Output Asset Capability** in its URL; every surface handing an operator such a URL obtains one at that moment or hands out nothing
- A **Screen Output** holding no capability renders nothing at all (ADR-0010)
- A **Screen Output** reads everything it renders through its **Screen**, never through an operator's Event reads, and never changes live state by reading it (ADR-0022)
- A **Program monitor** or preview without a capability renders everything but media, is admitted by its operator's **Session**, and reports its missing asset access so a control surface states the loss
- **Screen Outputs** and authoring run on Chromium, the only engine transparent video is supported on; another browser may flatten its alpha, and nothing detects or refuses it (ADR-0020)
- **Broadcast Graphics Screen** and **Feature Match Overlay** previews share output selection, zoom, item selection, guides, and advisory action-safe (5%) and title-safe (10%) guides; guides never appear in live **Screen Outputs** and never clip items

### Theming

- An **Event** uses exactly one **Theme**; an Event that chose none uses the **Default Theme**, which ships with Stream Keepr and cannot be edited or deleted
- A **Theme** in use by any **Event** cannot be deleted, and the refusal names those Events
- A **Theme** stores only the **Theme Tokens** it sets; every other token reads its shipped default
- A **Foundation Token** holds a value, in which a fill's, surface's or background colour layer's colour may name a colour **Foundation Token**; a **Mode Token** holds a value or names a **Foundation Token** of its type; nothing names a **Mode Token**, and a colour names nothing, so every token resolves in at most two steps
- A **Screen** resolves each **Theme Token** from its own **Screen Theme Override**, else its **Event**'s **Theme**, else the token's default; overriding a **Foundation Token** reaches every **Mode Token** and **Graphic Item** on that Screen that names it
- A **Screen Theme Override** of another mode's **Mode Token** is kept while the **Screen** shows a different **Screen Mode**, and applies again on its return
- A **Graphic Item** property either names a whole **Foundation Token** of its type or holds its own value; detaching copies the token's resolved value in
- A typography **Theme Token** carries no size; the consuming **Graphic Item** or **Mode Token** owns it
- A colour **Theme Token** may be translucent; a consumer's own opacity multiplies it
- A **Graphic Asset** a **Theme** or **Screen Theme Override** references cannot be retired or trashed, and the refusal names its referrers
- A **Broadcast Graphic Template** or **Feature Match Layout Template** carries **Graphic Item** token names, never a **Theme**, and renders under whichever Theme it is placed in; its editor previews under a Theme its author picks
- A **Theme** edit reaches every **Screen Output** of every **Event** using it at once
- Feature Match Controls consumes no **Theme Token**: it is an operator surface

### Access

- A **Graphics Ingestion Operation** is owned by the **User** who initiated it; its UUID is a name, not a right, and another user is told it does not exist
- A **Graphics Ingestion Operation** outlives the **Session** it started in: its owner resumes it by signing in from any browser, and the same idempotency key from a second browser continues it (ADR-0010)
- A graphics **Screen** Edit workspace or reusable graphics Template has at most one **Graphics Authoring Lease**, and a lease never restricts **Live Control**

### Broadcast Graphics composition

- A **Broadcast Graphics Screen** has at most one active **Broadcast Graphics Live Session** and renders an ordered stack of zero or more **Broadcast Graphics**
- A **Broadcast Graphics Screen** composes in its **Event**'s **Event Canvas**; every **Broadcast Graphic** on it is authored in that coordinate space, and fitting to another viewport scales uniformly without reflow
- A **Broadcast Graphics Screen** has a transparent host and ignores generic Screen padding, background, and alignment
- Concurrent **Broadcast Graphics** composite once into one transparent frame in authored Screen stack order; Take timing and **Graphic Channel** membership never change that order
- An empty **Broadcast Graphics Screen** is transparent in its **Overlay Output** and black in its **Fill Output** and **Key Output**
- A **Broadcast Graphic Template** initializes a copy of a **Broadcast Graphic** on a **Broadcast Graphics Screen**
- A **Broadcast Graphic** contains one or more **Graphic Items**

### Shared Graphics Foundation

- A **Broadcast Graphic** and a **Feature Match Layout** use the **Shared Graphics Foundation**
- Every **Graphic Item** is interpreted by one application-owned **Graphic Item Definition**
- The shared base **Graphic Item** kinds are **Text Graphic Item**, **Media Graphic Item**, **Shape Graphic Item**, and **Graphic Group**
- A **Graphic Group** may contain any context-available **Graphic Item** except another **Graphic Group**
- A **Shape Graphic Item** renders one **Shape Geometry**; a **Media Graphic Item** or **Graphic Group** may use one as its clipping boundary
- A **Text Graphic Item**, **Shape Graphic Item**, **Graphic Group**, **Clock Graphic Item**, **Player Life Graphic Item**, or **Game Wins Graphic Item** may have one **Graphic Surface Style** of its own, which may have one **Graphic Fill**; a **Game Wins Graphic Item** has two more, for an unwon and a won win box. Which surfaces and which **Shape Geometry** a kind has, and whether it reads a player side, are its **Graphic Item Definition**'s to declare
- A **Broadcast Graphic** and each **Graphic Group** own the **Graphic Layer Order** of their direct Graphic Items
- Every top-level **Graphic Item** and canvas-positioned **Graphic Group** child has one **Graphic Anchor Point**, and may have one **Graphic Rotation**
- A **Text Graphic Item** may render a **Graphic Text Template**, may define one **Graphic Placeholder Style** per referenced **Graphic Input**, and has one **Text Overflow Policy**; a **Clock Graphic Item** and a **Player Life Graphic Item** each have one too
- **Media Graphic Item** playback is independent of **Graphic Animation**

### Graphic Animation

- A **Broadcast Graphic** and its **Graphic Items** may each own an optional **Graphic Animation**, which compose; a **Graphic Animation** owns at most one **Graphic Animation Recipe** per lifecycle phase
- A newly authored **Broadcast Graphic** or **Graphic Item** has no recipes until its author enables them; a missing recipe or a **Cut** completes the corresponding phase immediately
- Graphic Animation presets are authoring shortcuts that initialise editable recipes, not runtime concepts
- Every recipe operates relative to its owner's **Graphic Resting State**
- A scale channel uses one **Graphic Animation Origin** and a uniform factor from zero to twice the resting size
- A slide channel uses one of eight compass directions and a fixed distance (any **Geometry Unit**, measured against its owner's parent: width for east/west, height for north/south, the shorter side for a diagonal; stored in pixels) or the distance needed to clear its owner's parent. A Graphic Animation Recipe **Graphic Style Set Entry** has no owner, so its fixed distance is entered in pixels
- A reveal channel wipes from one edge across its owner's rectangular bounds, preserving existing **Shape Geometry** clipping
- A fade channel reduces opacity from the resting value; fades on a **Broadcast Graphic** and its items compose multiplicatively
- Easing is linear, ease-in, ease-out, ease-in-out, back-in, back-out, or back-in-out; rotation, skew, perspective, filters, morphing, motion paths, and arbitrary transforms are outside **Graphic Animation**
- A recipe lasts 50 ms to 10 s and may be delayed or staggered by up to 10 s; recipes in one phase measure delay from one shared phase start
- A **Broadcast Graphic** or **Graphic Group** may stagger a selected subset of its direct items in list or reverse-list order, adding each item's offset to its own delay
- A finite phase completes after its latest delayed or staggered recipe completes; an indefinite on-screen recipe does not prevent on-air
- Every output and **Live Control** projects a phase from one authoritative effective start time, except the **Feature Match Overlay**'s host-local Sideboard reveal; output acknowledgements never gate completion
- An on-screen recipe begins after enter completes, cycles from the resting state to an excursion and back without accumulating, and runs once, a fixed 1–100 times, or until exit, with an optional pause of up to 60 s
- A **Graphic Item**'s update recipe runs only when its rendered content changes; a **Broadcast Graphic**'s runs when any of its content changes
- An update recipe cross-transitions old and new renderings: a slide moves old out and new in the same direction; a reveal moves one boundary with new content behind it
- An update interrupts an active on-screen recipe, which then restarts; exit interrupts enter, update, or on-screen motion and continues from the rendered state
- A **Broadcast Graphic** may be in more than one phase at once (at most one update or on-screen alongside at most one enter or exit), and every **Screen Output** and **Live Control** projects the same set (ADR-0002)
- An exit composes over the motion it interrupted; concurrent fades multiply, slides add, scales apply in turn, and reveals intersect

### Playout

- A **Broadcast Graphics Screen** accepts playout actions in one authoritative order, and every **Live Control** and output converges on it
- Take and Out express the latest desired on-air state rather than queued events; the last accepted conflicting intent wins and repeated or duplicate actions have no further effect
- Take, Out, Cut Take, and Cut Out apply to the latest accepted **Graphic Playout State**; Out during enter and Take during exit reverse smoothly from the rendered state
- **Cut** modifies Take, Update Graphic, or Out and is not a standalone action
- Every placed **Broadcast Graphic** has one **Graphic Playout State** and may belong to one **Graphic Channel**
- A **Graphic Channel** has one **Graphic Channel Handoff Policy**, defaulting to Overlap
- Taking a **Broadcast Graphic** replaces the on-air graphic in the same **Graphic Channel**; a channel retains only its latest selection and never queues Takes
- Overlap begins the outgoing exit and incoming enter at the same logical instant; under Overlap a new Take reverses the current incoming graphic into exit and cuts off any older outgoing one
- Out then in begins the incoming enter at the outgoing exit's scheduled completion; a new Take replaces any waiting incoming graphic while the outgoing one finishes
- Overlap and **Cut** skip the waiting state; a cut channel replacement switches immediately without overlap
- A waiting **Broadcast Graphic** is absent from every output, enters with the values its Take accepted however long it waits, and is cancelled by Out

### Graphic Inputs and updates

- A **Broadcast Graphic Template** declares zero or more **Graphic Inputs**; copying it onto a Screen copies each declared default as the initial manual value and creates independently editable **Graphic Source Selections** and **Graphic Input Bindings**
- A **Graphic Source Selection** selects the current **Event** or exactly one **Player**, **Talent**, **Phase**, **Round**, **Match**, **Feature Match Slot**, or **Archetype**
- A directly selected **Player** follows current **Event Data**; a **Player** derived from a **Match** or **Feature Match Slot** resolves from that production snapshot
- A **Graphic Input Binding** maps one **Graphic Input** to one field on a **Graphic Source Selection**; several bindings may share one selection
- The binding field catalog separates stable common fields from game-specific ones, and may expose atomic typed fields and named broadcast-formatted fields
- A **Graphic Input Binding** may read discrete live scalar state from a **Feature Match Slot**; ticking clocks and collections need specialised **Graphic Items**
- A value violating its declared type or constraints is unavailable rather than coerced; an unavailable binding never falls back to the template default
- A choice input's default is one of its options or none; a media input declares which media it accepts, which bounds both its default and **Live Control**'s picker
- Each operator-selected **Graphic Source Selection** generates one picker and each **Graphic Input** one field in **Live Control**, which distinguishes latest bound, working, and accepted on-air values
- Relevant **Realtime Event Session** changes re-resolve affected bindings; the **On-air Update Policy** decides when they go on air
- Each **Graphic Input** has an **On-air Update Policy** of staged (the default) or live; live applies immediately only while its graphic is on a program output
- A required unavailable **Graphic Input** prevents taking an off-air graphic; if one becomes unavailable on air, its last accepted value stays until updated or overridden
- Update Graphic atomically accepts every pending staged value for one **Broadcast Graphic**, is available only while entering, on-air, or updating, and is refused as stale when another operator already accepted a newer set
- Editing while off, waiting, or exiting changes the working values the next Take accepts; accepted changes do not animate while off air or exiting
- Accepted changes during enter coalesce into one update after enter; changes during an update replace the single pending rendering, never queue
- One atomically accepted set of on-air changes starts one update phase; interrupting an update never rolls back its accepted values
- Exit discards a pending visual update but keeps its accepted values, holding the rendering the interrupted update was travelling towards until it leaves
- Cutting Update Graphic accepts every pending staged value and shows the new rendering immediately; during enter it swaps the rendering at its current animated state and preserves the enter schedule

### Graphics Asset Library

- A **Graphic Asset** belongs to the installation-wide **Graphics Asset Library**, never to an **Event**, and has one stable identity distinct from its **Graphic Asset Content**
- Any byte change creates different **Graphic Asset Content**; several **Graphic Assets** may share content without sharing identity, name, metadata, or **Graphic Asset Origin**
- A **Graphic Asset** has one or more ordered **Graphic Asset Revisions**, each referencing exactly one **Graphic Asset Content**
- Replacing a file creates a new revision; replacing with current content is a no-op, while returning to older content creates a new revision over the existing content
- Every persisted graphics reference pins one asset identity and exact revision, never a filename, URL, object key, or hash; selecting an asset pins its latest revision and later revisions need explicit adoption
- **Graphic Asset References** — not Event associations, origins, deliveries, or **Graphics Derivatives** — determine which revisions are in use; a superseded revision stays resolvable while pinned
- Creating, changing, publishing, or transferring a reference requires its exact revision to resolve
- A **Missing Graphic Asset Reference** stays persisted and diagnosable until repaired, invalidating its owning artifact
- **Unavailable Graphic Asset Content** fails only operations that currently need its bytes
- A **Graphic Asset** may be associated with or referenced from several **Events** and by templates, Style Sets, Screens, and placed graphics without per-Event copies; associations organise discovery only
- Deleting an **Event** removes its associations and references but never deletes or hides shared **Graphic Assets**
- Graphics authors may discover and reference every **Graphic Asset**; a **Screen Output** may resolve only those its **Screen** publishes
- A **Broadcast Graphics Screen** publishes the revisions its configuration pins plus the media values its **Broadcast Graphics Live Session** has accepted; a value no longer accepted stops being published as it leaves air
- Every **Graphic Asset Revision** passes **Graphic Asset Validation** under one **Graphic Asset Compatibility Profile** before it is referenceable
- Every upload, approved remote copy, file replacement, and Template Package installation runs as one durable, idempotent **Graphics Ingestion Operation** with reconnectable progress, one compatibility report, cancellation before publication, and retry from checkpoints
- Staged bytes and provisional assets or templates are visible only through their operation
- Approved remote ingestion copies exact bytes once from a public HTTPS source and never creates a hotlink or remote dependency
- An ordinary ingestion exactly matching existing content defaults to reusing that **Graphic Asset** without overwriting its metadata, while allowing an explicit separate asset
- A **Graphics Derivative** belongs to exactly one source revision, is reclaimed with it, and never keeps its content reachable on its own
- **Graphic Asset Content** stays reachable while any retained revision or derivative points at it, and enters **Content Quarantine** only once that disappears
- An unexpected canonical object enters **Content Quarantine** for the same recheck and is never adopted as an asset
- A revision's retention deadline is established and recorded at supersession, not when a sweep first sees it
- A **Graphic Asset Tombstone** outlives the **Evidence Ledger** entries about its purge and satisfies no reference

### Evidence and reconciliation

- Every automated **Graphics Retention Sweep** decision, **Early Purge**, and **Graphic Asset** lifecycle transition records one **Evidence Ledger** entry; a transition never fails for want of Evidence
- A disagreement a reader observes opens one **Graphics Discrepancy** and one Evidence entry however often it is read; high-volume delivery observations stay in logs and metrics
- **Graphics Reconciliation** is the only writer of the catalogue's **Unavailable Graphic Asset Content** state, and every reader observing a contradiction feeds it
- Readers and **Graphics Reconciliation** share one definition of agreement, so content failing closed is never still served
- A **Graphics Discrepancy** never changes the asset, revision, or reference it affects
- A **Critical Integrity Incident** blocks clearing **Unavailable Graphic Asset Content** for the same content while open
- The **Operations Cockpit** states catalogue condition separately from byte-store condition, offers only actions that cannot shorten a recovery guarantee, and still answers when the catalogue cannot
- **Operational Queues** are ordered most severe first, then by deadline; each samples independently so no backlog hides another queue's work
- A **Queue Inspector** resolves its subject by identity rather than from a sample, and the library re-proves an action's validity before writing
- **Exact-Byte Repair** is offered only for **Unavailable Graphic Asset Content** and **Derivative Regeneration** only for a missing derivative; a quarantined object offers no writing action
- A recheck that leaves a **Graphics Discrepancy** open reports retryable-unavailable, not already-in-state
- An **Early Purge** from a **Queue Inspector** requires typed confirmation as well as the fresh all-revision reference proof

### Template Packages and Style Sets

- A Template Package contains only the **Graphic Assets** its single template transitively requires, and its import revalidates their bytes under the receiver's current **Graphic Asset Compatibility Profile**
- **Template Package Preflight** rejects unsafe or traversing paths, links, colliding or duplicate paths, encrypted or compressed entries, nested archives, undeclared or missing entries, inconsistent sizes, envelope-limit violations, and schemas newer than the installation reads
- A **Template Package Preflight Report** reports every blocking problem together
- A **Template Package Installation** applies only the **Template Package Mapping Proposals** of the fingerprint its author confirmed, installing exactly one **Installed Graphics Template** with every packaged identity mapped to one exact local revision
- Two packaged identities claiming one source identity and revision reject the complete package
- A proposal reusing a **Retired Graphic Asset** or **Trashed Graphic Asset** is reported before confirmation and stays retryable, since neither takes new references until restored
- A later locally created revision never inherits **Graphic Asset Origin** from an imported one
- An **Installed Graphics Template** owns one ordinary **Graphic Asset Reference** per asset field, so a pinned asset cannot enter Trash
- Every write of a **Broadcast Graphic Template** or **Feature Match Layout Template**, including a **Graphic Style Set** operation that rewrites it, requires each **Graphic Asset Reference** it holds to name an available revision of an active **Graphic Asset** whose kind fits its slot, including references it already held; a Style Set operation refused for one template writes nothing (ADR-0034)
- A **Graphic Asset** cannot be retired while any **Broadcast Graphic Template**, **Feature Match Layout Template**, **Theme** or **Screen Theme Override** references any of its revisions, and the refusal names them; a **Screen**'s own mode reference or an **Installed Graphics Template**'s does not hold it back (ADR-0034, ADR-0050)
- A **Template Package Installation** run inside an **Event** associates every asset it created or reused with that Event without changing reused assets' metadata
- A failed or cancelled installation leaves nothing discoverable
- A **Broadcast Graphic Template** or **Feature Match Layout Template** links to at most one **Graphic Style Set**, adopted by selecting entries in existing property controls; unselected properties stay local
- Style Set entries may reference entries in the same set only; Style Sets never inherit or compose
- A template update is available only when a referenced entry or its dependencies change in resolved style, schema, or asset dependency; applying one is atomic per template and cannot leave references on mixed Style Set revisions
- Deleting a referenced entry offers atomic replacement with a same-kind entry or detachment by freezing resolved values; deleting a whole Style Set offers detachment only; either succeeds only if every affected template update does
- Export resolves every used entry into a self-contained snapshot, keeping Style Set identities and revisions as provenance; importing a template never requires or modifies a **Graphic Style Set**, but may explicitly relink to a compatible installed one
- A **Graphic Style Set Package** import of a newer related revision updates through the ordinary publish and review flow; an older one never downgrades; same identity and revision with different content is a conflict; an installed set never published cannot be updated by import

### Feature Match Overlay

- A **Feature Match Overlay** renders exactly one **Feature Match Layout** for exactly one **Feature Match Slot**
- A **Feature Match Layout** has exactly one **Feature Match Overlay Frame** and one or more **Graphic Items**
- A **Source Item** may cut through the **Feature Match Overlay Frame**
- A **Feature Match Overlay Preset** initializes a **Feature Match Layout**; a **Feature Match Layout Template** stores a reusable one
- A **Feature Match Layout** declares its **Feature Match Layout Host Vocabulary** to a **Template Package** and never carries an Event identity
