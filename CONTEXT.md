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

**Broadcast Graphics Screen**:
A Screen in Broadcast Graphics mode whose output composes an ordered stack of concurrently visible Broadcast Graphics.

**Broadcast Graphics Live Session**:
The continuous playout epoch of a Broadcast Graphics Screen. It survives reloads, disconnections, and restarts, but ends when the Screen changes away from Broadcast Graphics mode or its live state is explicitly reset.
Commands from an ended Broadcast Graphics Live Session can never affect a later one.

**Broadcast Graphic**:
An authored visual composition that an operator shows, hides, and controls as one unit on a Broadcast Graphics Screen.

**Broadcast Graphic Template**:
A user-created reusable Broadcast Graphic that can be copied into a Broadcast Graphics Screen and transferred between Events. Templates are not live Screen state.
Each library Template has a stable identity and an automatically managed revision. Importing or placing one creates an independent copy with no update link; an import retains the source identity and revision only to recognise related packages.

**Graphics Authoring Lease**:
The exclusive, session-scoped right to edit one graphics authoring artifact: a Screen's complete graphics Edit workspace or one reusable graphics Template.
Other sessions may observe accepted authoring changes but cannot modify the leased artifact.

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
It may reference application fonts or font assets from the Graphics Asset Library, but it never owns or duplicates asset files.
It may reference only assets available in the same reusable-library scope.
Media treatment presets define presentation without selecting an image or video; each graphics template selects its actual media from the Graphics Asset Library.
Each Graphic Style Set has a stable identity and managed revision; each entry has a stable identity, kind, and schema version.
Renaming a Graphic Style Set or entry preserves its identity, while an entry's kind cannot change in place.
Edits accumulate in a working draft; one explicit atomic publish validates entry references, cycles, schemas, and asset availability before creating a Style Set revision and identifying affected templates.
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
Deleting a referenced entry or Style Set offers one atomic operation to replace its references or detach them by freezing their resolved values into new template revisions; deletion occurs only if every affected template update succeeds.
Export resolves every used entry into a self-contained template snapshot while retaining the source Graphic Style Set and entry identities, revisions, kinds, schemas, and value hashes as provenance.
Importing a Broadcast Graphic Template or Feature Match Layout Template never requires, creates, or modifies a Graphic Style Set; it may explicitly relink the template to an installed Style Set with matching identity and structurally compatible entries after showing the resulting differences.

**Graphic Style Set Package**:
A single-Style-Set portable artifact, using a separate `.skstyle` archive, that transfers one Graphic Style Set and its required font assets without containing a Broadcast Graphic Template or Feature Match Layout Template.
It uses the Template Package principles of data-only contents, strict validation, stable identity and revision provenance, conflict-safe installation, and atomic import.
The first import preserves the packaged Style Set identity and revision; an exact identity, revision, and content hash is already installed.
A newer related revision may explicitly update the installed Style Set through its ordinary publish and affected-template review flow, while an older revision never silently downgrades it.
The same identity and revision with different content is a conflict, and any related or conflicting package may instead install as an independent copy with a new identity; imports never field-merge Style Sets.

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

**Graphics Asset Library**:
The shared graphics-specific module that ingests, validates, stores, resolves, deduplicates, and lifecycle-manages images, silent videos, fonts, and generated thumbnails used by Broadcast Graphics and Feature Match Overlay.
Its interface is consumed by both graphics editors and their Template Package workflows; it is not a general application file manager.

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

**Graphic Asset Validation**:
The strict acceptance process that proves exact source bytes are safe, supported, decodable, and internally consistent without converting, normalising, repairing, or otherwise changing them.
Unsupported source content is rejected; generated previews remain separate Graphics Derivatives.

**Graphic Asset Compatibility Profile**:
The versioned contract of accepted source formats, technical bounds, validation rules, and output requirements applied uniformly to every Graphic Asset ingestion path.
Each accepted Graphic Asset Revision records the profile and verified technical facts under which it was accepted.

**Graphics Ingestion Operation**:
A durable, reconnectable workflow through which the Graphics Asset Library receives a local upload, approved remote copy, file replacement, or Template Package and either publishes the complete result atomically or publishes nothing.
Its provisional content is never discoverable or referenceable.

**Graphics Derivative**:
A generated thumbnail or preview artifact managed by the Graphics Asset Library as a dependant of one source Graphic Asset or graphics Template revision.
It inherits its source's access and lifecycle and is never a discoverable or selectable Graphic Asset.

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
Source Items remain top-level and cannot be children of a Graphic Group.
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
The authored arrangement rendered by a Feature Match Overlay, including the Frame and ordered Graphic Items from the Shared Graphics Foundation.
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
A Feature Match-specific Graphic Item intended for an external video source, with optional Frame cutout behavior and source framing style.
Source Items are top-level only.
_Avoid_: Source Region, camera box

**Widget Item**:
_Legacy implementation term._ Use the specific Graphic Item kind.
_Avoid_: Widget Item, Data Region

**Feature Match Overlay Preset**:
A built-in starting point that initializes a Feature Match Layout.
_Avoid_: Template when referring to the whole layout preset.

**Feature Match Layout Template**:
A user-created reusable Feature Match Layout that can later be copied into a Screen's Feature Match Overlay configuration.
Templates are not live Screen state.
_Avoid_: Preset when referring to user-owned reusable layouts.

**Screen Output**:
A live rendering variant exposed by a Screen Mode Definition, such as overlay, fill, or key.
_Avoid_: Export mode when referring to live Screen rendering.

**Screen Output Asset Capability**:
An opaque, long-lived, explicitly revocable right that lets one Screen Output resolve only the exact Graphic Asset Revisions currently published by its Screen.
It never permits Graphics Asset Library discovery, and removing a revision from the published Screen immediately removes that revision from the capability.

**Overlay Output**:
A Screen Output that renders the final composed colour and opacity over transparency.

**Fill Output**:
A Screen Output that renders the final composed colour flattened over black.
_Avoid_: Beauty when naming product concepts.

**Key Output**:
A Screen Output that renders the final composed opacity as a grayscale alpha matte.
_Avoid_: Black-and-white export, chroma key.

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
- A **Graphic Group** may contain any context-available **Graphic Item** except another **Graphic Group** or a **Source Item**
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
- Interrupting an update animation does not roll back its accepted **Graphic Input** values
- Exit discards any pending visual update without discarding its accepted **Graphic Input** values
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
- Application-level output alignment does not promise hardware genlock between independent browser windows or capture devices
- **Broadcast Graphics Screen** and **Feature Match Overlay** previews share output selection, zoom, item selection, item guides, and safe-area controls
- Graphics Screen previews provide advisory action-safe guides at a five-percent inset and title-safe guides at a ten-percent inset
- Preview guides never appear in live **Screen Outputs** or captures and do not clip or constrain authored **Graphic Items**
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
- A Template Package import maps its packaged asset identity and revision to a local **Graphic Asset** identity and revision
- **Graphic Asset Origin** records that mapping on the exact imported local revision without making the packaged identity a local identity or live link
- A later locally created **Graphic Asset Revision** never inherits **Graphic Asset Origin** from an earlier imported revision
- **Graphic Asset References**, rather than Event associations, **Graphic Asset Origin**, deliveries, or **Graphics Derivatives**, determine which asset revisions are in use
- Creating, changing, publishing, or transferring a **Graphic Asset Reference** requires its exact revision to resolve successfully
- A **Missing Graphic Asset Reference** remains persisted and diagnosable until explicitly repaired, while invalidating its owning graphics artifact
- **Unavailable Graphic Asset Content** causes a retryable failure only for operations that currently require its bytes
- Every **Graphic Asset Revision** passes **Graphic Asset Validation** under one **Graphic Asset Compatibility Profile** before it becomes referenceable
- Template Package imports revalidate packaged source bytes under the receiving installation's current **Graphic Asset Compatibility Profile**
- Every local upload, approved remote copy, file replacement, and Template Package installation runs as one durable, idempotent **Graphics Ingestion Operation**
- A **Graphics Ingestion Operation** exposes reconnectable stage progress, one complete compatibility report, cancellation before publication, and retry from durable checkpoints
- Staged bytes, provisional **Graphic Assets**, and provisional graphics Templates are visible only through the initiating operation and never appear in their libraries
- Approved remote ingestion copies exact bytes once from a public HTTPS source and never creates a hotlink, synchronization link, or authenticated remote dependency
- An ordinary ingestion that exactly matches existing **Graphic Asset Content** defaults to reusing its **Graphic Asset** without overwriting library metadata, while allowing an explicit separate asset identity
- A Template Package reuses a local **Graphic Asset Revision** only for an exact source identity, source revision, and content-digest match
- A related packaged source revision or unrelated matching digest creates a separate local **Graphic Asset** while reusing identical **Graphic Asset Content**
- The same packaged source identity and revision with a different digest is an integrity conflict that rejects the complete Template Package
- A Template Package contains only **Graphic Assets** transitively required by its single graphics Template
- Template Package installation publishes every new asset, origin mapping, rewritten reference, and the graphics Template in one atomic operation
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
- Update Graphic atomically accepts every pending staged **Graphic Input** value for one **Broadcast Graphic**
- A **Text Graphic Item** may render a **Graphic Text Template** using current **Graphic Input** values
- A **Text Graphic Item** may define one **Graphic Placeholder Style** for each referenced **Graphic Input**
- Every **Text Graphic Item** has one **Text Overflow Policy**
- A **Feature Match Overlay** renders exactly one **Feature Match Layout** for exactly one **Feature Match Slot**
- A **Feature Match Layout** has exactly one **Feature Match Overlay Frame**
- A **Broadcast Graphic** and a **Feature Match Layout** use the **Shared Graphics Foundation**
- A **Feature Match Layout** contains one or more **Graphic Items**
- A **Source Item** may cut through the **Feature Match Overlay Frame**
- **Source Item** is a Feature Match Overlay-specific **Graphic Item Definition**
- **Clock Graphic Item**, **Player Life Graphic Item**, and **Game Wins Graphic Item** are shared **Graphic Item Definitions** that require Feature Match context
- A **Feature Match Overlay Preset** initializes a **Feature Match Layout**
- A **Feature Match Layout Template** stores a reusable **Feature Match Layout**
- **Broadcast Graphics Screen** and **Feature Match Overlay** each expose **Overlay Output**, **Fill Output**, and **Key Output** variants

## Example dialogue

> **Dev:** "When I assign a **Match** from Round 3 to Slot 1, am I changing the **Round** itself?"
> **Domain expert:** "No — you are saving a **Feature Match Assignment** for that **Round** and updating the **Feature Match Slot** only when you promote that match into production controls."

## Flagged ambiguities

- "Feature Match" is overloaded. Use **Feature Match Slot** for the reusable production lane, **Feature Match Assignment** for the Round-scoped saved selection, and **Match** for the tournament pairing.
