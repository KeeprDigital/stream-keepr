# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Keepr Digital's in-house production crew: a handful of trusted operators on one
installation, each holding a User account a Graphics Administrator created.
They prepare and run broadcast coverage of Magic: The Gathering and One Piece
Card Game tournaments. Much of the work is setup before a broadcast (Events,
Players, Deck Lists, Themes, Screens, graphics templates); the rest is live
control during it (Feature Match Slots, Screen changes, Round Clocks).

## Product Purpose

Stream Keepr manages tournament Events and renders their broadcast graphics. It
holds the tournament's data (Players, Deck Lists, Rounds, Matches, standings,
Metagame) and turns it into on-air Screens shown as OBS browser sources, so the
crew produces coverage from real tournament data instead of retyping it.
Success: a broadcast's graphics are correct, current, and coherent without
manual re-keying, and any graphic a broadcast needs can be built.

## Positioning

- **Card-game-native data.** Knows Deck Lists, cards, Leaders, Archetypes,
  Metagame, standings and Game Scores; graphics are driven by that data, not
  typed text.
- **Synced, not re-keyed.** Melee Sync and TCG+ Import bring in pairings,
  results, standings and Players automatically.
- **Themed, live Screens.** One Theme gives every Screen of an Event one look;
  an edit reaches on-air Screens at once.
- **Built to the broadcast's needs.** Features are added for what a broadcast
  specifically requires, rather than fitting the show to a generic overlay tool.
- **Low-cost infrastructure.** Cloudflare Workers, D1, R2, and Ably's Free plan.

## Operating Context

- Operators work at a laptop or desktop; the operator app needn't support
  phones or tablets.
- Two surfaces with different rules:
  - **Operator app** (event management, Screen configuration, Theme and
    graphics editors, Feature Match Controls). Used both for unhurried setup
    and under live-broadcast pressure.
  - **Screen Output** (overlay Screens rendered in OBS). Authored in the
    Event's Event Canvas, a fixed pixel coordinate space (default 1920×1080)
    scaled uniformly to its window.
- Tournament data arrives from Melee.gg (Magic: The Gathering) and Bandai TCG+
  (One Piece Card Game).
- Realtime sync across connected clients via Ably.

## Capabilities and Constraints

- Nuxt 4 SPA, Vue 3, Pinia, Nuxt UI, Tailwind; Nitro on Cloudflare Workers;
  D1 with Drizzle; R2; Ably; Better Auth.
- The operator app's UI is built with Nuxt UI v4 components and its theming
  (`app/assets/css/main.css`, Nuxt UI config). Use an existing Nuxt UI
  component wherever one fits; add no other component library and don't
  hand-roll a replacement for one Nuxt UI provides.
- A Theme styles what Screens render, never the operator app. A Screen holds no
  look of its own; its look is Theme Tokens and Screen Theme Overrides
  (ADR-0049, ADR-0051).
- Feature Match Controls is an operator surface: it fills its window and
  consumes no Theme Token.
- No self-signup and no email; accounts and Password Reset Links are handed
  out by a Graphics Administrator.
- Domain language is binding: name concepts with `CONTEXT.md` terms, never its
  _Avoid_ synonyms. Settled decisions live in `DECISIONS.md`.

## Brand Commitments

- Product name: Stream Keepr. Organisation: Keepr Digital.

## Product Principles

1. Data in once. Anything the tournament already knows comes from sync or
   import, not retyping.
2. Correct on air. What a Screen shows must match the tournament's real state.
3. The operator app is a tool; the on-air look belongs to Themes.
4. Serve both setup and live use: thorough configuration before the show,
   fast and safe control during it.
5. Build what the broadcast needs, within the infrastructure's cost limits.
