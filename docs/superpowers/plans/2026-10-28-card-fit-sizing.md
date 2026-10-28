# Card Fit Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Most Played Cards and Deck List grids get a Fixed / Fit card sizing choice and auto columns; Fit never overflows the Event Canvas; Deck stack survives only as the beside-sideboard strip.

**Architecture:** One shared pure module chooses column counts from card count and the Event Canvas (deterministic on every surface). Fit renders in CSS only: explicit grid rows, each card in a size-container box sized `min(100cqw, 100cqh × 63/88)`. A D1 migration rewrites stored configs so no Screen loses its setting.

**Tech Stack:** Nuxt 4 / Vue 3, Nuxt UI v4, zod 4, Drizzle + D1 (SQLite), Vitest (unit + Nuxt env).

**Spec:** `docs/superpowers/specs/2026-10-28-card-fit-sizing-design.md`

## Global Constraints

- `cardSizing: 'fixed' | 'fit'` replaces `dynamicCardSize`. Defaults: Most Played Cards `'fit'`, Deck boards `'fixed'`. Editor label "Card sizing", options "Fixed width" / "Fit to screen".
- **Deviation from spec (builder's call):** auto columns is `autoColumns: boolean` (label "Auto columns", default `false`) beside the existing numeric `columns` (1–12), not `columns: number | 'auto'`. Editor meta, clamping and PATCH already handle a number and a boolean.
- Card aspect is 63:88.
- Mainboard views `grid | list`; sideboard `grid | stack | list`; stack renders only beside (`board: 'full'`, `sideboardPlacement: 'beside'`, both boards present), else as a grid.
- Remove Mode Token `mainboard-stack-reveal`; keep `sideboard-stack-reveal` (px).
- No minimum-size warning. No JS measuring of the rendered page to choose columns or page size.
- AGENTS.md test rules: `it.each` tables, assert outcomes via `data-*`/ARIA, kits from `test/helpers/` and `test/nuxt/helpers/`, comments ≤3 lines.
- `CONTEXT.md` terms: Most Played Cards, Deck List Screen, Event Canvas, Mode Token, Screen Theme Overrides, former field.

## Review Focus

1. **Stored Screen with `dynamicCardSize` but no `cardSizing`** (not migrated, e.g. a PATCH racing the deploy): must read as the mode default, never crash. Task 2 adds a `readStored` case.
2. **Sideboard set to stack, then placement switched to below / board to sideboard-only**: renders a grid, keeps `view: 'stack'` stored so switching back restores the strip. Task 6 test.
3. **Fit with 1 card, or 60 cards on one page**: one card stays inside the canvas (height-bound on a wide canvas); 60 cards stay fully visible. Task 1 table rows cover the maths.
4. **Portrait Event Canvas (e.g. 1080×1920)**: auto columns picks fewer columns than on landscape. Task 1 table row.
5. **Settings page count vs Screen Output with auto columns**: both derive from the same canvas, Theme and overrides. Task 3 test mounts the editor context with a non-default canvas.

---

### Task 1: Column maths

**Files:**

- Create: `shared/utils/cardGrid.ts`
- Test: `test/unit/shared/utils/cardGrid.test.ts`

**Interfaces:**

- Produces:
  - `export const CARD_ASPECT = 63 / 88`
  - `export const MAX_CARD_GRID_COLUMNS = 12`
  - `export function fitColumns(input: { count: number; width: number; height: number; gap: number }): number`: `c ∈ 1..12` maximising `min((W − (c−1)g)/c, ((H − (r−1)g)/r) × CARD_ASPECT)` with `r = ceil(count / c)`; ties → fewer columns; `count ≤ 0` → 1. Never more columns than `count`.
  - `export function fixedColumns(input: { width: number; cardWidth: number; gap: number }): number`: `floor((W + g)/(cardWidth + g))`, clamped to `1..12`.

- [ ] **Step 1: Write failing `it.each` tables**

```ts
it.each([
	{
		count: 1,
		width: 1920,
		height: 1080,
		gap: 12,
		expected: 1
	},
	{
		count: 10,
		width: 1920,
		height: 1080,
		gap: 12,
		expected: 5
	},
	{
		count: 60,
		width: 1920,
		height: 1080,
		gap: 12,
		expected: 12
	},
	{
		count: 10,
		width: 1080,
		height: 1920,
		gap: 12,
		expected: 3
	},
	{
		count: 0,
		width: 1920,
		height: 1080,
		gap: 12,
		expected: 1
	},
])('fits $count cards on $width×$height in $expected columns', ({ expected, ...input }) => {
	expect(fitColumns(input)).toBe(expected);
});
```

These values were checked against the formula. The 60-card row is capped at 12 columns. Add `fixedColumns` rows: `{ width: 1920, cardWidth: 160, gap: 12 } → 11`, `{ width: 100, cardWidth: 480, gap: 0 } → 1`, `{ width: 9999, cardWidth: 48, gap: 0 } → 12`.

- [ ] **Step 2:** `pnpm vitest run test/unit/shared/utils/cardGrid.test.ts`. Expect a FAIL (module missing).
- [ ] **Step 3:** Implement both functions as above.
- [ ] **Step 4:** Re-run the test. Expect a PASS.
- [ ] **Step 5:** Commit `feat(screens): card grid column maths`.

---

### Task 2: Contracts, tokens, migration

**Files:**

- Modify: `shared/types/enums.ts:42,155`: replace `DECK_BOARD_VIEW_VALUES` / `DeckBoardView` with `MAINBOARD_VIEW_VALUES = ['grid', 'list']`, `SIDEBOARD_VIEW_VALUES = ['grid', 'stack', 'list']`, `CARD_SIZING_VALUES = ['fixed', 'fit']`, and types `MainboardView`, `SideboardView`, `CardSizing`.
- Modify: `shared/utils/selectOptions.ts:33`: `CARD_SIZING_SELECT_OPTIONS` (`Fixed width` / `Fit to screen`); split the view options or drop them if Deck Settings is their only reader.
- Modify: `shared/screenModeConfigs/topCards.ts`: drop `dynamicCardSize`; add `cardSizing: editorField(z.enum(CARD_SIZING_VALUES), { label: 'Card sizing' })` and `autoColumns: editorField(z.boolean(), { label: 'Auto columns' })`; defaults `'fit'` / `false`; add `'dynamicCardSize'` to `formerFields`; update the contract doc comment.
- Modify: `shared/screenModeConfigs/deck.ts`: `deckBoardLayoutShape(views)` builds the shape per board; the mainboard block takes `MAINBOARD_VIEW_VALUES` and the sideboard block takes `SIDEBOARD_VIEW_VALUES`; each block has `cardSizing` and `autoColumns` (optional, like its neighbours); defaults `'fixed'` / `false`; export `DECK_MAINBOARD_LAYOUT_FIELDS`, `DECK_SIDEBOARD_LAYOUT_FIELDS` in place of `DECK_BOARD_LAYOUT_FIELDS`; add `'dynamicCardSize'` to `FORMER_BOARD_LAYOUT_FIELDS`; `ResolvedDeckBoards.mainboard` / `.sideboard` get their own resolved types.
- Modify: `shared/screenModeTokens/deck.ts`: delete `mainboard-stack-reveal`; reword the header comment.
- Create: `server/db/migrations/sqlite/0014_card_sizing.sql` via `pnpm drizzle-kit generate --custom --name card_sizing` (journal and snapshot come with it).
- Test: `test/unit/server/db/cardSizingMigration.sqlite.test.ts`; update `test/unit/server/schemas/screen.test.ts`, `formerModeConfigFields.test.ts`, `storedModeConfigClamp.test.ts`, `screenModeConfigContracts.test.ts` where they name the old fields.

**Interfaces:**

- Produces: `CardSizing`, `CARD_SIZING_VALUES`, `MainboardView`, `SideboardView`; `TopCardsModeConfig.cardSizing` / `.autoColumns`; `ResolvedDeckBoards['mainboard' | 'sideboard'].cardSizing` / `.autoColumns`; `DECK_MAINBOARD_LAYOUT_FIELDS`, `DECK_SIDEBOARD_LAYOUT_FIELDS`.

**Migration SQL** (hand-written; follow `0008_event_canvas.sql` for the `json_valid` guard; the top-cards key must be quoted as `'$."top-cards"'`, see `0003_top_cut_screen_mode_key.sql`):

- `$."top-cards".dynamicCardSize` → `$."top-cards".cardSizing`: `true → 'fit'`, `false → 'fixed'`, removing the old key.
- The same for `$.deck.mainboard.dynamicCardSize` and `$.deck.sideboard.dynamicCardSize`.
- `$.deck.mainboard.view = 'stack'` → `'grid'`.
- Rows without these keys stay unchanged.

- [ ] **Step 1: Failing migration test** on `createSqliteD1Harness({ throughMigration: '0013' })` (model: `removeGraphicStyleSetsMigration.sqlite.test.ts`). Insert screens, `applyRemainingMigrations()`, and read `mode_configs` back. Write it as `it.each`:

| stored before                                                                                                         | after                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `{"top-cards":{"dynamicCardSize":true,"columns":5}}`                                                                  | `{"top-cards":{"cardSizing":"fit","columns":5}}`                                                              |
| `{"top-cards":{"dynamicCardSize":false}}`                                                                             | `{"top-cards":{"cardSizing":"fixed"}}`                                                                        |
| `{"deck":{"mainboard":{"view":"stack","dynamicCardSize":true},"sideboard":{"view":"stack","dynamicCardSize":false}}}` | `{"deck":{"mainboard":{"view":"grid","cardSizing":"fit"},"sideboard":{"view":"stack","cardSizing":"fixed"}}}` |
| `{"standings":{"columns":[]}}`                                                                                        | unchanged                                                                                                     |
| `null`                                                                                                                | `null`                                                                                                        |

- [ ] **Step 2:** `pnpm vitest run test/unit/server/db/cardSizingMigration.sqlite.test.ts`. Expect a FAIL.
- [ ] **Step 3:** Write the migration. Run the test and expect a PASS.
- [ ] **Step 4: Schema tests.** These rules carry the risk:
  - The mainboard refuses `view: 'stack'` and the sideboard accepts it. Cover both sides in `screen.test.ts`.
  - A stored `dynamicCardSize` is dropped on read. Use `readStored` in `formerModeConfigFields.test.ts`, which also covers Review Focus 1.
  - `screenModeConfigContracts.test.ts` stays green: its defaults parse through both write paths.
- [ ] **Step 5:** Make the contract and enum edits, then fix every compile error `pnpm typecheck` reports outside the Display, Settings and Card components. Those components are Tasks 5 and 6; give them a temporary `// TODO(card-sizing)` cast only if typecheck blocks the commit.
- [ ] **Step 6:** Run `pnpm vitest run test/unit/server`. Expect a PASS.
- [ ] **Step 7:** Commit `feat(screens): cardSizing and autoColumns replace dynamicCardSize`.

---

### Task 3: Resolve columns from canvas and Theme

**Files:**

- Modify: `app/modules/screen-mode/modeTokens.ts`: add `screenModeDimensionTokens`, and export it from `app/modules/screen-mode/index.ts:199`.
- Create: `app/composables/screen/useCardGridColumns.ts`
- Modify: `app/modules/screen-mode/editorModeData.ts:34-39`: the editor context gains `eventCanvas: computed(() => eventCanvasOf(eventStore.event))` and `themeTokens: computed(() => eventStore.eventTheme?.tokens)`.
- Test: `test/nuxt/composables/screen/useCardGridColumns.test.ts`, plus a case in the existing editorModeData test if one exists (otherwise in this file).

**Interfaces:**

- Consumes: `fitColumns`, `fixedColumns` (Task 1); `CardSizing` (Task 2); `useScreenInset()`; `useScreenContext().eventCanvas / themeTokens / screen`.
- Produces:
  - `screenModeDimensionTokens<M extends ThemedScreenMode>(mode: M, tokens: readonly ScreenModeTokenOfType<M, 'dimension'>[], theme: StoredThemeTokens, overrides: StoredThemeTokens): Record<string, number>`, keyed by the short token name. It resolves through `resolveThemeTokens` the same way `screenModeThemeTokenStyle` does.
  - `useCardGridColumns(options: { mode: 'top-cards' | 'deck'; sizing: () => CardSizing; autoColumns: () => boolean; columns: () => number; count: () => number; cardWidthToken: string; gapToken: string }): ComputedRef<number>`. Its behaviour:
    - `autoColumns` false: returns `columns`.
    - Fit: returns `fitColumns` over the canvas less 2×inset.
    - Fixed: returns `fixedColumns` over the canvas width less 2×inset, with the resolved `card-width` and `card-gap`.
    - Canvas missing: falls back to `DEFAULT_EVENT_CANVAS`. Theme missing: falls back to `DEFAULT_THEME_TOKENS`.

- [ ] **Step 1: Failing `it.each`** run under `runInScreenContext`. It covers four cases:
  - auto off returns `columns`;
  - Fit + auto on 1920×1080 matches `fitColumns`;
  - Fixed + auto with a Screen Theme Override of `top-cards-card-width: 480` gives fewer columns than the default 160;
  - a portrait canvas in context changes the result.

  Add a case where `useEditedScreenModeData` sees an Event with `canvasWidth: 1080, canvasHeight: 1920` and the composable reads it. That covers Review Focus 5.

- [ ] **Step 2:** Run it. Expect a FAIL.
- [ ] **Step 3:** Implement the three changes.
- [ ] **Step 4:** Run `pnpm vitest run --config vitest.nuxt.config.ts test/nuxt/composables/screen`. Expect a PASS.
- [ ] **Step 5:** Commit `feat(screens): resolve auto card columns from the Event Canvas`.

---

### Task 4: Fit rendering primitives

**Files:**

- Create: `app/components/Screen/CardGrid.vue`
- Create: `app/components/Mtg/CardFitBox.vue`
- Test: `test/nuxt/components/Screen/CardGrid.test.ts`

**Interfaces:**

- Produces:
  - `<ScreenCardGrid :sizing="CardSizing" :columns="number | 'auto-fill'" :rows="number | undefined" :card-width="string" :gap="string">`, which puts the cards in its default slot and sets `data-card-sizing`, `data-columns`, `data-rows`. Its layouts:
    - Fit: `grid-template-columns: repeat(c, minmax(0, 1fr))`, `grid-template-rows: repeat(rows, minmax(0, 1fr))`, `flex-1 min-h-0`.
    - Fixed: `repeat(c, max-content)`, or `repeat(auto-fill, <cardWidth>)` when `columns === 'auto-fill'`, centred.
  - `<MtgCardFitBox>`: a `flex-1 min-h-0` wrapper with `container-type: size` that centres its slot in an inner box of `width: min(100cqw, 100cqh * 63 / 88)`. The slot is the card's `relative` block, so badges follow the card.

- [ ] **Step 1: Failing `it.each`** over `{ sizing, columns, rows }` asserting the `data-*` values and the grid template strings on the root style.
- [ ] **Step 2:** Run it. Expect a FAIL.
- [ ] **Step 3:** Implement. Put the CSS in scoped `<style>`, using `aspect-ratio` from the existing `mtg-card` utility for the card's height.
- [ ] **Step 4:** Run it. Expect a PASS.
- [ ] **Step 5:** Commit `feat(screens): card grid and fit box`.

---

### Task 5: Most Played Cards

**Files:**

- Modify: `app/composables/screen/useTopCardsModeData.ts`: rows are built from `resolvedColumns` (`useCardGridColumns` with `count: entries.length`, tokens `card-width` / `card-gap`); return `resolvedColumns` and `pageRowCount = min(config.rowsPerPage, rowCount)`.
- Modify: `app/components/Screen/Modes/TopCards/Display.vue`: the display root is `flex flex-col h-full`, and the grid is a `ScreenCardGrid` with `rows = pageRowCount` in Fit.
- Modify: `app/components/Screen/Modes/TopCards/Card.vue`: replace `dynamicSize` with `sizing: 'fixed' | 'fill' | 'fit'`. Fit wraps the badge block in `MtgCardFitBox` with the name below it; fill means width 100%; fixed means `width`.
- Modify: `app/components/Screen/Modes/ArchetypeSpotlight/Display.vue:159`: `sizing="fill"`.
- Modify: `app/components/Screen/Modes/TopCards/Settings.vue`: a Card sizing select from `CARD_SIZING_SELECT_OPTIONS`, plus an Auto columns toggle that disables the Columns input when on.
- Test: update `test/nuxt/components/Screen/Modes/TopCards/{Display,Card,Settings}.test.ts`, `test/nuxt/composables/screen/useTopCardsModeData.test.ts`, `themeTokenRendering.test.ts`, `settingsEditorFields.test.ts`.

- [ ] **Step 1: Failing tests:**
  - **Display** `it.each` over sizing: `data-card-sizing` on `top-cards-grid`. Fit with 7 cards, 5 columns and `rowsPerPage: 1` gives `data-rows="1"` on page 2 as well, so a short last page keeps its size. Fixed gives no `data-rows`.
  - **Composable:** `autoColumns: true` with 10 cards on the default canvas pages by `fitColumns` columns.
  - **Settings:** toggling Auto columns writes `{ autoColumns: true }` and disables Columns, which shows as ARIA `disabled`.
- [ ] **Step 2:** Run `pnpm vitest run --config vitest.nuxt.config.ts test/nuxt/components/Screen/Modes/TopCards test/nuxt/composables/screen/useTopCardsModeData.test.ts`. Expect a FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command, then `pnpm vitest run --config vitest.nuxt.config.ts test/nuxt/components/Screen/Modes`. Expect a PASS.
- [ ] **Step 5:** Commit `feat(top-cards): fit cards to the screen, auto columns`.

---

### Task 6: Deck List

**Files:**

- Modify: `app/components/Screen/Modes/Deck/Display.vue`:
  - **Effective view:** in `visibleBoards`, the effective view is `'grid'` when `layout.view === 'stack' && !sideboardBeside`. Delete the horizontal stack-row template and the `'width'` branch of `stackCardStyle`.
  - **Heights:** `deck-body` is a `flex flex-col` column, `deck-layout` is `flex-1 min-h-0`, and each section is `flex flex-col min-h-0`.
  - **Grids:** each grid uses `ScreenCardGrid`. Columns come from `useCardGridColumns` (`mode: 'deck'`, tokens `${board}-card-width` / `${board}-card-gap`, `count: cards.length`). Fixed with `autoColumns` passes `'auto-fill'` instead. Fit rows are `ceil(cards / columns)`.
  - **Boards below:** in Fit, each board's section gets `flex-grow: rows`. Fixed sections are `flex: none`.
  - **Beside stack strip in Fit:** the strip gets `flex: 1 1 0%` beside the mainboard's `columns` weight, so it's one mainboard column wide. The strip wrapper is `flex-1 min-h-0` with `container-type: size`, and each card's width is `min(100cqw, (100cqh − (n − 1) × var(--theme-deck-sideboard-stack-reveal)) × 63 / 88)`. In Fixed it stays content-sized at `sideboard-card-width`.
- Modify: `app/components/Screen/Modes/Deck/Card.vue`: `sizing: 'fixed' | 'fill' | 'fit'` replaces `dynamicSize`, and fit wraps the card in `MtgCardFitBox`.
- Modify: `app/components/Screen/Modes/Deck/Settings.vue`:
  - **View tabs:** each board gets its own. The mainboard has no Stack tab. The sideboard's Stack tab is disabled with the description "Only beside the mainboard" unless `board === 'full' && sideboardPlacement === 'beside'`.
  - **Fields:** use the per-board fields from Task 2.
  - **Grid controls:** Card sizing select and Auto columns toggle replace the dynamic toggle. The stack view also shows Card sizing.
- Test: update `test/nuxt/components/Screen/Modes/Deck/{Display,Card,Settings}.test.ts` and `themeTokenRendering.test.ts`.

- [ ] **Step 1: Failing tests:**
  - **Display** `it.each` over placement and board selection: stack beside renders `sideboard-stack-column`. Stack below, or sideboard-only, renders `sideboard-grid` (Review Focus 2). `sideboard-stack-row` never exists.
  - **Fit grid:** 9 cards in 4 columns gives `data-rows="3"`. Fixed + auto gives `data-columns="auto-fill"`.
  - **Mainboard fit with auto columns:** `data-columns` equals `fitColumns({ count, …canvas })`.
  - **Remove** the old stack-row and stack-reveal width assertions (lines ~247-272), keeping the beside-strip reveal case.
  - **Settings:** the mainboard tabs have no Stack. The sideboard Stack tab is `aria-disabled` when placement is below and enabled when beside.
- [ ] **Step 2:** Run `pnpm vitest run --config vitest.nuxt.config.ts test/nuxt/components/Screen/Modes/Deck`. Expect a FAIL.
- [ ] **Step 3:** Implement and remove any `TODO(card-sizing)` casts.
- [ ] **Step 4:** Run the same command, then `pnpm typecheck`. Expect a PASS.
- [ ] **Step 5:** Commit `feat(deck): fit cards to the screen, auto columns, stack only beside`.

---

### Task 7: Docs, full check, eyeball, PR

**Files:**

- Modify: `DECISIONS.md`: append `## ADR-0054: Cards fit the Event Canvas or take a fixed width`. It covers:
  - Fixed vs Fit;
  - auto columns, chosen from the Event Canvas rather than measured so Settings and output agree on page counts;
  - stack only as the beside sideboard strip, and why (never used elsewhere);
  - the 0014 migration.

  It amends ADR-0051's #844 bullet: card fill is still config, now `cardSizing`.

- Modify: `CONTEXT.md`: add **Card Sizing** (Fixed width: the Mode Token width, may overflow; Fit to screen: largest size at which every card on the page fits the Event Canvas).
- Modify: spec: replace `columns: number | 'auto'` with `autoColumns`.

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Run `pnpm verify:quick`. Expect it to pass (lint, typecheck, unit, Nuxt).
- [ ] **Step 3:** Eyeball in the running app at 1920×1080. The README covers local dev; copy `.env` from the main checkout and run `pnpm install --frozen-lockfile` first. Check that nothing passes the canvas bottom in each of these:
  - Most Played Cards: 60 cards, Fit, auto columns;
  - the same at 10 cards;
  - Deck: a 75-card mainboard grid in Fit with a 15-card sideboard strip beside it;
  - Deck: a sideboard grid below.
- [ ] **Step 4:** Commit `docs(screens): ADR-0054 card sizing`, push, and open a draft PR titled `feat(screens): cards fit the screen or take a fixed width`.
