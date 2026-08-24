# ADR-0016: One polymorphic Background Screen replaces Idle

The Idle Screen Mode carried a single optional video background and doubled as the "empty state", and ADR-0014 had pencilled it in as the second Animation Effect host by adding `animation` to a background type union. Design review found the mode itself the wrong shape: what a show wants behind everything else is a composition — a colour wash over an Animation Effect, a plate under a gradient — not a choice of exactly one background kind. We decided to rename the mode `background` and make its configuration an ordered layer stack (`layers: BackgroundLayer[]`, painter's order, operator-reorderable), with five layer types — colour, gradient, image, video, Animation Effect — each owning its own enabled state and opacity.

## Considered Options

- **Per-type screen modes** (one Screen Mode per background kind, or `animation` joining a background type union per ADR-0014's original wording) — rejected: exactly one kind can show at a time, so the motivating case — a translucent colour over an animation — is unreachable, and every new kind is a new mode or union arm with its own editor.
- **One mode with a typed layer stack** — chosen: composability for the cost of a mode rename migration.

## Consequences

- The mode key renames end to end: `SCREEN_MODE_VALUES`, the registries, component directories, the D1 `screens.current_mode` column default, and stored rows (migration 0028). OBS URLs address Screens by slug, so nothing external breaks.
- The old `mediaBackground` configuration **resets rather than maps** onto a video layer — the ADR-0014 reset precedent, accepted for the same small install base. Fresh and migrated Background Screens start empty: black until configured.
- At most one Animation Effect layer per Screen, enforced in the schema on the `layers` field — each is its own WebGL context and an OBS browser source is memory-tight. Documented as liftable.
- Opacity belongs to the layer, never to the stack or the renderer behind it.
- Image and video layers use a standardised media source shape from day one — a Graphics Asset Library reference or a remote URL — which #484 adopts app-wide. Asset-sourced layers join the exhaustive Graphic Asset Reference indexing (`background` joins the referencing Screen Modes under the `layers.` owner-slot namespace).
- This supersedes ADR-0014's consequence "the Idle background becomes a second Animation Effect host (`animation` joins the background type union)"; the host-agnostic renderer rule it stated carries forward unchanged.
