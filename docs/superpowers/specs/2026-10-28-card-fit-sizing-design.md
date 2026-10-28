# Card sizing: Fixed or Fit, auto columns, sideboard-only stack

## Why

Card grids on Most Played Cards and Deck List Screens run off the bottom of
the Event Canvas. "Dynamic card size" today only fills columns across
(`minmax(0, 1fr)`); height follows the 63:88 card aspect, so enough rows
overflow. Operators need one mode that never overflows and one that takes an
exact width and accepts overflow.

The exact-width half already shipped in #844: `card-width` is a free Mode
Token (48–480px). This work adds the never-overflow half, auto columns, and
removes stack layouts nobody uses.

## Goals

- **Fit**: every card on the page fits inside the space left for the grid,
  both axes, at the largest size that does. Never overflows.
- **Fixed**: cards take the `card-width` Mode Token; may overflow (unchanged).
- **Auto columns** in both modes.
- **Stack only as a sideboard strip beside the mainboard.**

## Non-goals / anti-goals

- No minimum-size warning in the editor (user: no).
- No JS measuring of the rendered page to choose columns or page size: the
  control, preview and Screen Output must agree on page counts.
- Card Spotlight (`card` mode) is a single card on a `card-width` token; out of
  scope.

## Config changes

### `cardSizing: 'fixed' | 'fit'` replaces `dynamicCardSize`

On Most Played Cards (top level) and Deck (each board block). Editor label
"Card sizing", options "Fixed width" / "Fit to screen". Defaults keep today's:
Most Played Cards `'fit'`, Deck boards `'fixed'`.

`dynamicCardSize` becomes a former field (`dynamicCardSize`,
`mainboard.dynamicCardSize`, `sideboard.dynamicCardSize`).

**As built, no migration** (the user's call): the Themes work isn't in
production, and existing Screens are deleted and set up again. A stored former
field reads as the mode default.

### `autoColumns: boolean` beside `columns`

As built: a separate `autoColumns` toggle (default `false`) beside the existing
numeric `columns` (1–12) on Most Played Cards and each Deck board, rather than
`columns: number | 'auto'`; editor meta, clamping and PATCH already handle both.
The Columns input is disabled while auto is on.

`'auto'` resolves to a number in one shared pure function (its **home**, e.g.
`shared/utils/cardGridColumns.ts`), from inputs every surface has: card count,
Event Canvas width and height (screen context `eventCanvas`), sizing mode, and
for Fixed the resolved `card-width` and `card-gap` values.

- **Fit + auto**: the column count `c` in `1..12` maximising card width
  `min(W / c, (H / ceil(N / c)) × 63/88)` for `N` cards on a canvas `W × H`
  (gaps included in the maths). Ties: fewer columns. The Fit render still sizes
  from the real grid area, so canvas aspect only chooses `c`; it need not be
  exact.
- **Fixed + auto, Most Played Cards**: `floor((W + gap) / (cardWidth + gap))`,
  clamped to `1..12`. Its grid spans the canvas width, so `W` is the canvas
  width. Computed in JS because columns set the page size.
- **Fixed + auto, Deck** (my call): pure CSS,
  `repeat(auto-fill, <board card-width>)`. A Deck has no paging, so nothing
  needs to agree on the count, and the browser accounts for a strip beside it.
- **Most Played Cards `N`**: the cards after filtering and `limit`, i.e. all
  cards as if on one page. `c` is chosen first, then pages are `rowsPerPage`
  rows of `c`, as now. This avoids the columns/page-size cycle.
- **Deck `N`** (Fit + auto): the board's card entries. Area: the canvas, as an
  approximation (header and the other board ignored for choosing `c`).

`topCardsGridRows`, the page rotation and Settings all read the resolved
number.

**Plumbing this needs:** the editor's mode-data context
(`app/modules/screen-mode/editorModeData.ts`) carries no `eventCanvas` or
`themeTokens` today, and Settings derives the page count through it. Add both,
and resolve `card-width` / `card-gap` values in JS via `resolveThemeTokens`
(Theme plus `screen.themeOverrides`, as `Screen/Renderer.vue` does), so
Settings and the Screen Output agree on page count.

### Deck board views

The boards share one schema today (`deckBoardLayoutShape` from
`DECK_BOARD_VIEW_VALUES`); different view lists mean splitting it and its
editor fields (`DECK_BOARD_LAYOUT_FIELDS`).

- Mainboard: `grid | list`.
- Sideboard: `grid | stack | list`. Stack renders only as the vertical strip
  beside the mainboard (`board: 'full'`, `sideboardPlacement: 'beside'`, both
  boards present). When stack is not beside, the sideboard renders as a grid.
  Settings offers Stack only when the placement is beside (builder decides how
  to show the disabled state).
- Defaults unchanged: sideboard stack beside. The other common setup is a
  sideboard grid below.
- A stored `mainboard.view: 'stack'` reads as `'grid'` (`resolveDeckBoards`).
- Delete the horizontal stack row template and its code path.
- `mainboard-stack-reveal` is removed (its board can no longer stack).

### Sizes are config, not Mode Tokens (added after review)

A Theme Token is shared. A size only one display reads is that mode's config,
edited beside the control it sizes. It replaces these Mode Tokens:

- Most Played Cards: `cardWidth`, `cardGap`, `badgeSize`.
- Each Deck board: `cardWidth`, `cardGap`. The sideboard also gets `stackReveal`.
- Deck text sizes: `quantityBadgeSize`, `pointsBadgeSize`, `metaPillSize` and
  `pointedCardSize`.
- Card Spotlight: `cardWidth`.

Card width is offered only for a Fixed grid or a stack. The three badge shadows
read a new `shadow` Foundation Token. Moving inline overrides of the remaining
Mode Tokens is a follow-up.

## Rendering Fit (CSS, no measuring)

Every overlay renders on the fixed Event Canvas, and `Screen/Renderer.vue`
already sets `container-type: size`.

1. The display root is a column; header and page indicator take natural
   height, the grid takes the rest (`flex-1 min-h-0`).
2. The grid sets `grid-template-columns: repeat(c, minmax(0, 1fr))` and
   `grid-template-rows: repeat(r, minmax(0, 1fr))`, gap from `card-gap`. For
   Most Played Cards `r = min(rowsPerPage, totalRows)` (my call), so a short
   last page keeps the same card size rather than jumping bigger on air. For
   Deck `r = ceil(cards / c)`.
3. Each card item is a column: an image box (`flex-1 min-h-0`,
   `container-type: size`) above the name label (natural height). The card
   inside is `width: min(100cqw, 100cqh × 63/88)`, centred. Badges stay
   positioned on the card, so they follow it.
4. Fixed: `max-content` columns at `card-width`. Most Played Cards already does
   this. Deck grids use `minmax(0, 1fr)` tracks with fixed-width cards today,
   so too many columns make the cards overlap. Deck Fixed switches to
   `max-content` tracks (my call), so the cards overflow instead of overlapping.

### Deck in Fit

- Each board fits its own area. Beside: widths split by column weight as today
  (`boardFlexStyle`); each board gets the full body height. Sideboard below:
  the boards split the body height by their row counts (`flex-grow: r`).
- `deck-layout` and its boards need definite heights (`flex-1 min-h-0` down
  from `deck-body`) so `cqh` has something to read.
- **Sideboard stack strip in Fit**: card height `= H − (n − 1) × reveal`, reveal
  the `sideboard-stack-reveal` px token (kept px so names stay readable); width
  from height × 63/88. In Fixed, width is `sideboard-card-width` as today.
- List view is untouched.

## Tests (per AGENTS.md)

- Column resolution: `it.each` table at its home (Fit tie-break, tall vs
  wide canvas, Fixed width maths, clamps).
- Contract: `screenModeConfigContracts.test.ts` and
  `formerModeConfigFields.test.ts` cover the new fields and former fields;
  `'auto'` accepted, out-of-range numbers still clamp.
- Wiring per Display: `data-card-sizing="fit|fixed"`, resolved columns and
  rows exposed as `data-*`, sideboard stack not beside renders as a grid.
- Pixel fit can't be checked in jsdom; verify in the running app at 1920×1080
  with 60 Most Played Cards, and a 75-card mainboard grid with a 15-card
  sideboard strip.

## Docs

- New ADR-0053 at the end of `DECISIONS.md`: Fixed vs Fit, auto columns chosen
  from the Event Canvas rather than measured, stack limited to the beside
  sideboard. It amends #844's note that "whether cards fill their columns stays
  config" (still config, now `cardSizing`).
- `CONTEXT.md`: add **Card Sizing** (Fixed / Fit) if a term is needed for it.

## Left to the builder

Exact editor controls, file layout of the shared column function, how the
disabled Stack option reads, and any `lh`-free CSS details.
