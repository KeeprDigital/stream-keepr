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

**Deck List**:
A Player's submitted cards for a game and Phase.

**Melee Sync**:
The workflow that imports and refreshes Event structure, Players, Deck Lists, standings, Matches, and Rounds from Melee.gg.

**Provenance**:
The Melee-owned identity and lifecycle facts on a synced record: its external identity, sync status, activity, and last-seen time. Only Melee Sync writes Provenance; manual operator edits never carry it — the server resolves it itself.
_Avoid_: external fields, sync metadata.

**Feature Match Slot**:
A reusable production control lane for showing one featured Match at a time, using mutable display/control snapshot data.
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

**Guarded Sequence**:
The client-side module owning the invariant "discard the result of async work that newer work has superseded." Scoped or keyed; issues Flights.
_Avoid_: generation counter, version guard, latest-wins map.

**Flight**:
A ticket for one unit of supersedable async work, checked for staleness after each await. Staleness is monotonic.
_Avoid_: request id, generation.

**Field Ownership**:
The set of fields one optimistic action may write, derived from the change the action predicts. Result merges and rollbacks write only owned fields; remote updates never overwrite fields another action currently owns.
_Avoid_: owns array, field mask, declared ownership.

**Event Data**:
The client-side access path for Event-scoped data such as Players, Phases, Rounds, Matches, Feature Match Slots, Feature Match Assignments, Screens, Talents, Archetypes, and Player Lists.

**Screen Mode Definition**:
The definition of a Screen Mode, including defaults, configuration shape, data preparation, and rendering contract.
It also owns the Screen host contract: whether the mode renders as an overlay or control surface, how screen-level width, height, padding, background, alignment, viewport-fit scaling, and theme policy apply, and any mode-specific host defaults.
Generic Screen configuration UI policy, such as container controls, dimension defaults, reset defaults, and output options, belongs with the Screen Mode Definition rather than the Screen configuration page.

**Feature Match Overlay**:
A Screen Mode that renders a production-ready Feature Match Layout for a Feature Match Slot, including external video source areas, widgets, frame graphics, and fill/key outputs.
_Avoid_: Generic overlay editor

**Feature Match Layout**:
The authored arrangement rendered by a Feature Match Overlay, including the Frame and ordered Layout Items.
It is portable by design so it can later be saved as a Layout Template.
_Avoid_: Overlay config

**Feature Match Overlay Frame**:
The continuous graphic area of a Feature Match Layout that sits behind and around Layout Items.
_Avoid_: Panel area, background panel

**Feature Match Layout Item**:
A top-level positioned item in a Feature Match Layout.
A Layout Item is either a Source Item, Widget Item, or Widget Group.
_Avoid_: Region

**Source Item**:
A Feature Match Layout Item intended for an external video source, with optional Frame cutout behavior and source framing style.
Source Items are top-level only.
_Avoid_: Source Region, camera box

**Widget Item**:
A Feature Match Layout Item that renders exactly one Feature Match Widget.
_Avoid_: Data Region

**Feature Match Overlay Preset**:
A built-in starting point that initializes a Feature Match Layout.
_Avoid_: Template when referring to the whole layout preset.

**Feature Match Layout Template**:
A user-created reusable Feature Match Layout that can later be copied into a Screen's Feature Match Overlay configuration.
Templates are not live Screen state.
_Avoid_: Preset when referring to user-owned reusable layouts.

**Feature Match Overlay Output**:
A rendering variant of a Feature Match Overlay, such as transparent overlay, fill, or key.
_Avoid_: Export mode when referring to live Screen rendering.

**Fill Output**:
A Feature Match Overlay Output that renders the visible colored layout flattened over black.
_Avoid_: Beauty when naming product concepts.

**Key Output**:
A Feature Match Overlay Output that renders the Feature Match Overlay opacity as a grayscale alpha matte.
_Avoid_: Black-and-white export, chroma key.

**Feature Match Overlay Widget**:
A semantic Feature Match content type rendered by a Widget Item or inside a Widget Group.
Initial widgets are text, image, clock, player life, and game wins.
_Avoid_: Arbitrary element

**Widget Group**:
A Feature Match Layout Item that contains multiple Widget Items and controls their shared movement, spacing, and arrangement.
Widget Groups can arrange children as a row, column, or canvas. They do not contain Source Items or nested Widget Groups in v1.
_Avoid_: Region, generic group

**Feature Match Overlay Widget Definition**:
The editor-facing contract for one Feature Match Overlay Widget type: its display label, icon, default configuration, and summary. Adding a Widget type means one Definition plus one renderer branch.
_Avoid_: widget metadata, widget registry.

**Widget Preset**:
A saved starting shape for one Widget or a Widget Group, such as a player bar, match details strip, player status cluster, or event branding block.
_Avoid_: Widget type when it is only a prearranged composition

**Text Widget**:
A Feature Match Overlay Widget that renders tokenized text such as player name, record, deck, round, table, format, or event name.
_Avoid_: Match Details Widget, Player Bar Widget when referring to tokenized text behavior

**Image Widget**:
A Feature Match Overlay Widget that renders a configured image, such as an event logo or sponsor mark.

**Clock Widget**:
A Feature Match Overlay Widget that renders the active Feature Match Session clock.

**Player Life Widget**:
A Feature Match Overlay Widget that renders one player's life total.

**Game Wins Widget**:
A Feature Match Overlay Widget that renders one player's game-win indicators.

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
- A **Screen** has exactly one current **Screen Mode**
- A **Feature Match Overlay** renders exactly one **Feature Match Layout** for exactly one **Feature Match Slot**
- A **Feature Match Layout** has exactly one **Feature Match Overlay Frame**
- A **Feature Match Layout** contains one or more **Feature Match Layout Items**
- A **Feature Match Layout Item** is either a **Source Item**, **Widget Item**, or **Widget Group**
- A **Source Item** may cut through the **Feature Match Overlay Frame**
- A **Widget Item** renders exactly one **Feature Match Overlay Widget**
- A **Widget Group** contains one or more **Widget Items**
- A **Widget Group** does not contain **Source Items** or nested **Widget Groups** in v1
- A **Feature Match Overlay Preset** initializes a **Feature Match Layout**
- A **Feature Match Layout Template** stores a reusable **Feature Match Layout**
- **Fill Output** and **Key Output** are **Feature Match Overlay Outputs**

## Example dialogue

> **Dev:** "When I assign a **Match** from Round 3 to Slot 1, am I changing the **Round** itself?"
> **Domain expert:** "No — you are saving a **Feature Match Assignment** for that **Round** and updating the **Feature Match Slot** only when you promote that match into production controls."

## Flagged ambiguities

- "Feature Match" is overloaded. Use **Feature Match Slot** for the reusable production lane, **Feature Match Assignment** for the Round-scoped saved selection, and **Match** for the tournament pairing.
