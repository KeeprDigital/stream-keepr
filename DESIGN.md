---
name: Stream Keepr
description: The operator app for preparing and running tournament broadcast coverage.
colors:
  primary: "oklch(71.5% 0.143 215.221)"
  primary-dark: "oklch(78.9% 0.154 211.53)"
  canvas: "#ffffff"
  canvas-dark: "oklch(20.8% 0.042 265.755)"
  elevated: "oklch(96.8% 0.007 247.896)"
  elevated-dark: "oklch(27.9% 0.041 260.031)"
  border: "oklch(92.9% 0.013 255.508)"
  border-dark: "oklch(27.9% 0.041 260.031)"
  text-highlighted: "oklch(20.8% 0.042 265.755)"
  text-default: "oklch(37.2% 0.044 257.287)"
  text-muted: "oklch(55.4% 0.046 257.417)"
  text-muted-dark: "oklch(70.4% 0.04 256.788)"
  success: "oklch(69.6% 0.17 162.48)"
  warning: "oklch(76.9% 0.188 70.08)"
  error: "oklch(64.5% 0.246 16.439)"
  info: "oklch(68.5% 0.169 237.323)"
typography:
  title:
    fontFamily: "IBM Plex Sans, Inter, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.556
  body:
    fontFamily: "IBM Plex Sans, Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.429
  label:
    fontFamily: "IBM Plex Sans, Inter, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.333
    letterSpacing: "0.05em"
  mono:
    fontFamily: "Inconsolata, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
rounded:
  base: "0.25rem"
  md: "0.375rem"
  lg: "0.5rem"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  button-soft:
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  button-ghost:
    textColor: "{colors.text-default}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text-highlighted}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
---

# Design System: Stream Keepr

This system covers the **operator app** only. What Screens render on air is styled by Themes and their Theme Tokens (ADR-0049, ADR-0051), never by this file; the `.broadcast-table-*` rules and the Saira Condensed display face in `app/assets/css/main.css` belong to Screens.

## Overview

**Creative North Star: "The Production Desk"**

A broadcast gallery's control desk: dark, quiet and dense, with everything within reach and colour only where it means something. The operator app is the tool behind the show, not the show. It holds back so that the tournament's data and the on-air Screens it previews are the loudest things on screen. Operators use it both for unhurried setup before a broadcast and for fast control during one, so it is calm enough for long sessions and legible enough to glance at.

The system is Nuxt UI v4, used close to stock. The look comes from the configured colour roles (`app.config.ts`), Nuxt UI's semantic tokens, small sizes and a restrained choice of variants, not from custom CSS. Dark mode follows the system preference and falls back to dark; light mode is fully supported.

**Key Characteristics:**

- Nuxt UI v4 dashboard shell: resizable, collapsible sidebar; navbar with title, page actions and toolbar.
- Dense: `xs` and `sm` control sizes, `text-sm` body, `text-xs` metadata.
- Slate neutrals with a single cyan accent; status colours only for status.
- Mostly flat: depth comes from tonal surfaces (`bg-elevated`) and rings, not shadows.
- Lucide icons throughout.

## Colors

Cool slate neutrals carry almost everything; one cyan accent marks the primary action and the current selection.

All colours are Nuxt UI semantic roles set in `app.config.ts` (`primary: 'cyan'`, `neutral: 'slate'`, `success: 'emerald'`, `warning: 'amber'`, `error: 'rose'`, `info: 'sky'`). Use the role (`text-muted`, `bg-elevated`, `color="primary"`), never a raw Tailwind palette class or hex value; each role resolves per colour mode.

### Primary

- **Gallery Cyan**: the primary action on a page (solid button), the selected item in a segmented control (soft), links and focus. Lighter in dark mode (`primary-dark`) so it holds contrast against slate.

### Neutral

- **Canvas**: the page background, white in light mode and deep slate in dark (`canvas-dark`).
- **Elevated Slate**: tonal lift for the sidebar (`bg-elevated/25`), subtle cards, table headers and grouped panels.
- **Hairline Slate**: dividers and card rings (`border-default`, often at 60–70% opacity).
- **Highlighted Ink**: titles and values that must be read first (`text-highlighted`).
- **Muted Slate**: the workhorse secondary text for descriptions, metadata, labels and empty states (`text-muted`; `text-dimmed` for the least important).

### Status

- **Success / Warning / Error / Info** (emerald, amber, rose, sky): connection and sync state, validation, alerts and destructive confirmations. They are never decoration.

### Named Rules

**The Signal Colour Rule.** Colour signals something: the primary action, the current selection, or a state. A surface that is merely "a section" stays neutral.

**The Role Not Hue Rule.** Name the Nuxt UI role, not the palette. To change the brand colour you edit `app.config.ts` once, and every screen follows.

## Typography

**Body Font:** IBM Plex Sans (with Inter, sans-serif)
**Mono Font:** Inconsolata (with monospace)

**Character:** IBM Plex Sans is a technical, slightly engineered sans that reads like equipment labelling; Inconsolata sets ids, numbers and code-like values.

### Hierarchy

- **Title** (600, 1.125rem): card and section headings, empty-state titles. Larger sizes (`text-xl`/`text-2xl`) are rare and reserved for page-level values.
- **Body** (400, 0.875rem): the default for content, form controls and tables.
- **Label** (600, 0.75rem, uppercase, wide tracking): sidebar group labels and small section kickers. Plain `text-xs` in `text-muted` is used for metadata.
- **Mono** (400, Inconsolata): identifiers, counts and tabular values; use `tabular-nums` where numbers align.

### Named Rules

**The Two Sizes Rule.** Nearly everything is `text-sm` or `text-xs`. Hierarchy comes from weight (`font-medium`, `font-semibold`) and from `text-highlighted` versus `text-muted`, not from size jumps.

## Layout

The default layout is `UDashboardGroup`: a resizable, collapsible sidebar (15% width, its collapse remembered under the fixed id `app`) and a `UDashboardPanel` with `UDashboardNavbar` (title, sidebar toggle, `#actions`) and an optional `#toolbar`. Editor Focus Mode removes the sidebar to give a graphics editor the full width, and moves the connection statuses into the navbar.

The page body is padded `p-4 sm:p-6`. Collection pages (`UICollectionPage`) centre their content at `max-w-7xl`, or `max-w-3xl` when narrow, and reserve the toolbar's height when it is hidden so content doesn't jump. Editors and canvases use `flush` to go edge to edge.

The spacing rhythm is Tailwind's 4px scale, used mostly as `gap-2` (8px), `gap-3` (12px) and `gap-4` (16px). Use `gap-1`/`gap-1.5` inside controls and `gap-6` between major blocks. The operator app targets laptop and desktop widths and does not design for phones.

## Elevation & Depth

Flat by default. Depth comes from tonal surfaces (`bg-default` → `bg-elevated`) and Nuxt UI's ring borders. Shadows belong to floating layers that Nuxt UI already styles (modals, popovers, dropdowns, slideovers, toasts) and are rarely added by hand.

**The Tonal Lift Rule.** To set something apart, step it up a surface (`bg-elevated`, `UCard variant="subtle"`) rather than adding a shadow.

## Shapes

Gently rounded: Nuxt UI's default `--ui-radius` (0.25rem) is left unchanged. Controls take `rounded-md` (6px), cards and panels `rounded-lg` (8px), and badges, avatars and status dots `rounded-full`. Magic card images keep the printed card's own corner via the `mtg-card` utility (`--mtg-card-radius`). Transparent overlay output is previewed on the checkerboard backdrop (`.transparent-checkerboard-backdrop`), never on a flat colour.

## Components

Every component is a Nuxt UI v4 component or a thin `UI*` composition of them (`app/components/UI/`). Reach for an existing one before writing markup.

### Buttons

- **Shape:** `rounded-md` (6px), `font-medium`, colour transition.
- **Primary:** solid `primary` (the default `UButton`). Use one per view, for the main action (e.g. "Add Screen").
- **Soft / Ghost / Outline / Subtle:** carry everything else. `ghost` for toolbar and row actions, `outline` for secondary choices, `soft` for the selected state, `link` for inline navigation.
- **Size:** `sm` or `xs` in dense areas (rows, toolbars, cards); default size for page actions.
- **Icons:** Lucide (`i-lucide-*`). An icon-only button carries `aria-label`.

### Segmented Tabs (`UISegmentedTabs`)

A `UFieldGroup` of buttons: the selected item is `primary` + `soft`, the rest `neutral` + `outline`. It exposes `data-active` for tests.

### Cards / Containers

- **Corner Style:** `rounded-lg` (8px).
- **Background:** `bg-default` with a `ring-default` hairline; `variant="subtle"` for tonal lift.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Internal Padding:** `p-4 sm:p-6` body; footers right-aligned (`:ui="{ footer: 'justify-end' }"`).

### Inputs / Fields

- Always wrapped in `UFormField` for its label, hint and error, inside a `UForm` where a form exists.
- `UInput`, `USelect`, `USelectMenu`, `UInputNumber`, `USwitch`, `UTextarea` at `sm`/`xs` in dense editors.
- Focus is Nuxt UI's primary ring; errors use the `error` role and `UFormField`'s message.

### Feedback

- **`UAlert`** for inline state on a page (`soft`/`subtle`, status colour).
- **`UBadge`** for compact status and counts (`soft`/`subtle`/`outline`).
- **Toasts** appear bottom-left (`UApp :toaster`).
- **`UIConfirmActionModal` / `UIConfirmDeleteModal` / `UIUnsavedChangesModal`** for confirmations.

### Empty, loading and error states

- **`UIEmptyState`**: a Lucide icon in `text-muted`, a title and an optional description, plus actions. Use the `page` variant to centre a whole page, `card` inside a page and `inline` inside a card or modal.
- **`UILoadingSpinner`** and **`UIInitialLoadError`** (with retry) for loading and load failure.

### Navigation

`UNavigationMenu` (vertical) in the sidebar, grouped under uppercase `text-xs` `text-muted` labels and filtered by the Event's Card Game. The sidebar footer holds the account, sign-out, the colour-mode toggle and the live status indicators (`UIRealtimeStatus`, `UIServerTimeStatus`).

### Named Rules

**The Stock First Rule.** Reach for a Nuxt UI prop or variant first. Theme-wide changes go in `app.config.ts` so every screen follows. A per-instance `:ui` override is for layout fixes only (padding, alignment, justify), not restyling. Custom CSS is for what Nuxt UI cannot express, such as card geometry or the checkerboard preview.

## Do's and Don'ts

### Do:

- **Do** build with Nuxt UI v4 components and the `UI*` compositions; add a new composition to `app/components/UI/` when a pattern repeats.
- **Do** use semantic roles (`text-muted`, `bg-elevated`, `border-default`, `color="primary"`), so both colour modes work.
- **Do** keep controls at `sm`/`xs` and text at `text-sm`/`text-xs` in dense operator surfaces.
- **Do** keep a single solid primary button per view.
- **Do** expose component state through ARIA or `data-*` attributes.
- **Do** check every screen in both dark and light mode.

### Don't:

- **Don't** add another component library or hand-roll a component Nuxt UI provides.
- **Don't** use raw palette classes or hex values (`text-cyan-500`, `#0ea5e9`) in the operator app.
- **Don't** restyle Nuxt UI components through `:ui` or CSS beyond layout fixes; change `app.config.ts` instead.
- **Don't** add shadows to raise a surface; use a tonal step.
- **Don't** style the operator app with Theme Tokens, or on-air Screens with these rules.
- **Don't** use icon sets other than Lucide.
