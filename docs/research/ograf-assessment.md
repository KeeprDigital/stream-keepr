# OGraf v1 assessment for Broadcast Graphics

_Assessed 22 July 2026 against the official EBU OGraf v1 Graphics specification, its normative schemas, the draft Server API, and Stream Keepr's current Screen/Feature Match Overlay code._

## Recommendation

Use OGraf as a **design reference, not the initial native format or runtime**.

Stream Keepr should adopt four useful contracts:

1. a small manifest for identity, format version, thumbnail, canvas/render requirements, and declared inputs;
2. a declared public data model, with initial values and partial live updates;
3. a lifecycle equivalent to `load`, `play`, `update`, `stop`, and `dispose`, including a “skip animation” path;
4. optional duration metadata so Live Control knows when a transition is complete.

Stream Keepr should keep its templates **declarative and constrained**: Graphic Items, existing styling/layout concepts, event-data bindings, operator overrides, and curated animation recipes. It should not initially import or execute arbitrary OGraf Web Components, implement OGraf's non-real-time timeline, or implement the separate OGraf Server API.

This borrows useful interface ideas without turning Stream Keepr into a third-party graphics runtime or implying any future OGraf interoperability commitment.

## Why it fits the existing application

The current Feature Match Overlay is already close to the proposed native authoring foundation:

- It has pixel dimensions, overlay/fill/key output modes, anchors, geometry, z-order, styles, frame media, and existing animation effects ([screen config](../../shared/types/screenConfig.ts#L189-L337)).
- Its layout is declarative: sources, widgets, groups, and group children live in stored configuration rather than executable template code ([layout types](../../shared/types/screenConfig.ts#L331-L475)).
- Its bounded widget registry currently includes text, image, clock, player life, and game wins ([widget definitions](../../app/modules/feature-match-overlay/widgetDefinitions.ts#L17-L58)).
- Text uses a deliberately small token system, backed by Event and Feature Match data ([declared tokens](../../app/utils/featureMatchOverlayTemplateValues.ts#L4-L44), [token rendering](../../app/utils/featureMatchOverlayTokens.ts#L20-L45)).
- Feature Match Overlay is already an ordinary Screen mode with specialised, pixel-exact host behaviour and three output URLs ([Screen mode](../../shared/screenModes.ts#L29-L46), [output policy](../../shared/screenModeDefinitions.ts#L67-L110)).
- Screen realtime control exists, but its generic commands are currently only refresh, identify, and debug; per-graphic playout commands will need a richer, instance-addressed contract ([commands](../../shared/types/enums.ts#L12-L15), [subscription](../../app/composables/screen/useScreenRealtimeSession.ts#L24-L43)).

That favours extending the application's current trusted renderer and data model over embedding a second, executable graphics platform.

## Concept-by-concept assessment

| Area | What OGraf v1 specifies | Value to Stream Keepr | Recommended boundary |
| --- | --- | --- | --- |
| Template/package | A Graphic is a `.ograf.json` manifest, a referenced JavaScript module exporting a Web Component, and any resource files. A folder may hold several independent manifests that share resources. The Graphics specification does not define a normative archive/container format. Its draft Server API currently exposes management/control resources but does not fill that archive-format gap. ([requirements and manifest](https://ograf.ebu.io/v1/specification/docs/Specification.html#requirements-for-a-graphic), [draft OpenAPI definition](https://github.com/ebu/ograf/blob/main/v1/specification/open-api/server-api.yaml)) | The manifest/entry-point idea and self-contained resources are useful. Multiple manifests in one package do not match the agreed independent import/export workflow. | Export one Stream Keepr Graphic Template at a time as versioned declarative data plus its assets. Do not require an Event-wide package or bind Feature Match Overlay export to Broadcast Graphic export. |
| Declared inputs | `manifest.schema` is the Graphic's public state model. It governs initial `load({data})` and potentially partial `updateAction({data})` updates; the schema also carries UI-oriented metadata such as titles/defaults, ordering, and hidden properties. ([manifest model](https://ograf.ebu.io/v1/specification/docs/Specification.html#manifest-model), [load/update lifecycle](https://ograf.ebu.io/v1/specification/docs/Specification.html#web-component-interface), [normative manifest schema](https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json), [normative GDD object schema](https://github.com/ebu/ograf/blob/main/v1/specification/json-schemas/gdd/object.json)) | Strong fit for portable **named Graphic Inputs** and auto-generated Live controls. OGraf describes value shape, but not where an Event value comes from. | Adopt a restricted input schema (for example text, multiline text, number, boolean, colour, image/media, and selected domain references). Store Event-data binding and operator override separately from the portable template. Avoid arbitrary JSON Schema/expression support initially. |
| Data updates | `load` supplies complete initial state; `updateAction` applies one or more fields and may animate the change. Both are validated against the public schema. ([`load`](https://ograf.ebu.io/v1/specification/docs/Specification.html#load), [`updateAction`](https://ograf.ebu.io/v1/specification/docs/Specification.html#updateaction)) | Cleanly separates template design, an on-Screen instance's current values, and later updates from Event data or an operator. | Use snapshots plus partial patches. Define precedence explicitly: operator override over bound Event value over template default. Define whether a binding refresh preserves or clears an override. |
| Lifecycle/control | Each Graphic implements `load`, `playAction`, `updateAction`, `stopAction`, `customAction`, and `dispose`. Play moves from hidden/start into a step; stop goes to hidden/end. Actions support `skipAnimation`, and later calls must not be ignored merely because an earlier animation is unresolved. ([Web Component interface](https://ograf.ebu.io/v1/specification/docs/Specification.html#web-component-interface)) | Excellent vocabulary for independently controlling several graphics in one Broadcast Graphics Screen. It also exposes an important interruption/race requirement for live operation. | Give each placed Broadcast Graphic an instance id and states such as `off`, `entering`, `on`, `updating`, and `exiting`. Provide Take/Update/Out operator actions, plus Cut/skip-animation. Specify deterministic interruption semantics. Keep `customAction` and multi-step graphics out until a concrete design requires them. |
| Animation/timelines | OGraf standardises action calls and a start/step/end state model, not how animation is authored. `actionDurations` are predictive metadata, not keyframes. Infinite on-screen motion may continue after `playAction` resolves. Non-real-time graphics add `goToTime` and an action schedule. ([step model and durations](https://ograf.ebu.io/v1/specification/docs/Specification.html#step-model), [non-real-time methods](https://ograf.ebu.io/v1/specification/docs/Specification.html#gototime)) | Its enter/on-screen/exit semantics align with the planned constrained choreography. Its non-real-time timeline does not solve the editor question and would enlarge the feature considerably. | Store Stream Keepr-native animation recipes on a Graphic and/or Graphic Items: effect, duration, delay, easing, direction, and bounded repeat. Resolve Take after the enter phase while permitting an on-screen loop to continue. Start as real-time only; do not implement `goToTime`, schedules, or arbitrary keyframes. |
| Rendering/runtime | OGraf Graphics are executable HTML/CSS/JavaScript/Canvas Web Components running in a browser-class engine. A manifest may declare resolution, frame rate, public-internet access, and minimum engine versions. ([render requirements](https://ograf.ebu.io/v1/specification/docs/Specification.html#renderrequirements), [Web Component requirement](https://ograf.ebu.io/v1/specification/docs/Specification.html#web-component-interface)) | Resolution metadata and capability checks are useful. Executable components are unnecessary for reproducing designs already expressible by the Feature Match editor plus constrained animations. | Continue rendering trusted Vue/HTML/SVG from validated configuration. Record canvas dimensions and a Stream Keepr format version. Add capability metadata only when a real incompatibility needs it. |
| Portability/versioning | `$schema` identifies OGraf v1; manifests have `id` and optional `version`, but the content-versioning scheme is explicitly out of scope. Portability is conditional on a compatible web engine and declared render requirements. ([manifest model](https://ograf.ebu.io/v1/specification/docs/Specification.html#manifest-model)) | A clear format version, stable identity, metadata, thumbnail, and migrations are valuable for imports between Events/installations. OGraf's free-form content version alone is insufficient for safe migration. | Keep `formatVersion` separate from template identity/revision. Validate imports, migrate known old formats, reject unsupported future formats clearly, and bundle/localise referenced assets where practical. No OGraf conversion or interchange is intended. |
| Fill/key | OGraf v1 does not define alpha, fill, or key-output semantics; these are renderer/output concerns. Its specification contains no fill/alpha model. | Stream Keepr already has `overlay`, `fill`, and `key` modes and output URLs ([output parser](../../app/utils/featureMatchOverlayOutput.ts#L1-L18), [output controls](../../app/components/Screen/Modes/FeatureMatchOverlay/PreviewOutputAside.vue#L14-L71)). | Reuse Stream Keepr's output path. The Broadcast Graphics renderer should composite every active Graphic once, then derive overlay/fill/key consistently from that same frame. OGraf adds no required behaviour here. |
| Security/runtime cost | An OGraf Graphic necessarily includes executable JavaScript and may include arbitrary resources or require public Internet access. The draft Server API explicitly leaves authentication/security to vendors. ([Graphic files](https://ograf.ebu.io/v1/specification/docs/Specification.html#requirements-for-a-graphic), [Server API security](https://ograf.ebu.io/v1/specification/docs/Specification_Server_API.html#security-optional)) | **Inference:** accepting third-party OGraf imports would introduce code-execution and supply-chain risk, renderer isolation, CSP/network policy, asset validation, CPU/memory limits, error containment, and reliable cleanup. | Native imports must remain data-only and strictly validated. Full OGraf import should be a separate future security/interop project, probably with a trusted-source policy or sandboxed renderer. Remote assets still need URL/type/size policy even without executable code. |

## Proposed Stream Keepr contract inspired by OGraf

A portable Broadcast Graphic Template should contain approximately:

- `formatVersion`, stable `id`, content `revision`, name, description, optional author, thumbnail, and canvas dimensions;
- declared named inputs with restricted types, labels, defaults, ordering, and whether they are shown in Live Control;
- a constrained item tree using the existing geometry, stacking, grouping, text/image, and style vocabulary;
- enter, on-screen, update, and exit recipes at Graphic and/or Graphic Item level;
- packaged/local asset references, with no executable code;
- optional transition-duration metadata derived from its recipes.

A Screen-specific Broadcast Graphic instance should separately contain:

- its instance id and stack order on the Broadcast Graphics Screen;
- input bindings to Stream Keepr Event/domain data;
- current operator overrides and resolved display values;
- playout state and the latest accepted command/version.

This separation makes a template reusable without carrying Event-specific ids, while allowing several independently controlled instances on one output.

## Explicitly defer

- Arbitrary OGraf Web Component import/execution.
- OGraf Server API implementation. As of this assessment, the EBU describes the Graphics v1 definition as stable but the separate Control/Server API as a draft where breaking changes may still occur ([project status](https://ograf.ebu.io/#project-status), [Server API](https://ograf.ebu.io/v1/specification/docs/Specification_Server_API.html)).
- A general keyframe/timeline editor, non-real-time rendering, `goToTime`, and scheduled actions.
- Dynamic/unknown or multi-step graphics until a representative existing design requires them.
- Arbitrary custom actions and their payload-schema UI.
- Event-wide or mixed Feature Match/Broadcast Graphic packages.

## Decision

OGraf is useful because it confirms the right **seams**: portable graphic metadata, declared live data, independently addressable instances, and a predictable play/update/stop lifecycle. It is overcomplicated for the first Stream Keepr feature where it mandates executable graphics, broad renderer interoperability, generic schema/action support, and optional post-production timing.

The feature outline should therefore use only the applicable ideas without naming OGraf as a product contract. Stream Keepr is not OGraf-compliant or compatibility-oriented, and OGraf import, export, conversion, and runtime interoperability are outside this effort.
