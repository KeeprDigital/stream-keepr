# Architecture decision records

One record per settled decision, numbered in the order they were taken. A record
is never rewritten to match the code: when a decision changes, a new record
supersedes it and both stay, so the reasoning a later reader inherits is still
readable. Superseded records say so in their own **Status** line and name what
replaced them.

**Read the live records for what the installation does. Read a superseded one
for why the boundary was drawn where it was — not for current behaviour.**

`docs/agents/domain.md` is how the engineering skills consume this directory:
read the records that touch the area you are about to work in, and surface a
contradiction rather than silently overriding it.

## Live

| #    | Decision                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0001 | [Graphic Style Sets reference application fonts only](./0001-graphic-style-sets-reference-application-fonts.md)                                                                |
| 0002 | [Concurrent Graphic Animation phases compose by nesting](./0002-concurrent-graphic-animation-phases-compose-by-nesting.md)                                                     |
| 0004 | [A Live Session notification carries the difference, not the state and not only a name](./0004-live-session-notifications-carry-the-difference.md)                             |
| 0005 | [`static-font-v1`'s server-side checks are a floor; the browser is the gate](./0005-static-font-v1-server-checks-are-a-floor-and-the-browser-is-the-gate.md)                   |
| 0006 | [Over-broad Graphic Style Set override pins are not migrated](./0006-over-broad-graphic-style-set-override-pins-are-not-migrated.md)                                           |
| 0007 | [The Broadcast Graphics Graphic Item cap is set from what a show needs](./0007-broadcast-graphics-item-cap.md)                                                                 |
| 0009 | [The current page of a Page Rotation is a clock projection, not persisted state](./0009-page-rotation-is-a-clock-projection.md)                                                |
| 0010 | [Authentication replaces the anonymous author session — Better Auth, person-owned operations, deny-by-default](./0010-authentication-replaces-the-anonymous-author-session.md) |
| 0011 | [Social Profile Rotation projects into ordinary Graphic Items](./0011-social-profile-rotation-projects-into-ordinary-graphic-items.md)                                         |
| 0012 | [Environment-dependent library behaviour is stated, tested, or recorded](./0012-environment-dependent-library-behaviour-is-stated-tested-or-recorded.md)                       |
| 0014 | [Animation Effects are rebuilt in-house on three.js](./0014-animation-effects-rebuilt-in-house-on-three.md) — except its background-hosting wording, superseded by 0016        |
| 0015 | [Live overlay show/hide rides feature-match session state, not graphics config](./0015-live-overlay-show-hide-rides-feature-match-session-state.md)                            |
| 0016 | [One polymorphic Background Screen replaces Idle](./0016-one-polymorphic-background-screen-replaces-idle.md)                                                                   |
| 0017 | [The local auth bypass is one launcher-owned name](./0017-the-local-auth-bypass-is-one-launcher-owned-name.md) — its launcher list amended by 0018                             |
| 0018 | [A LAN bypassed launcher is an accepted local exposure](./0018-a-lan-bypassed-launcher-is-an-accepted-local-exposure.md)                                                       |

## Superseded

| #    | Decision                                                                                                                                     | Superseded by                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 0003 | [A Graphics Ingestion Operation stays owned by one graphics author session](./0003-graphics-ingestion-operation-ownership.md)                | 0010, at its cutover (#398)          |
| 0008 | [The installation has no authentication boundary yet, by design](./0008-no-authentication-boundary-yet-by-design.md)                         | 0010, in its "no boundary" clause    |
| 0013 | [Two-runtime-var local bypass activation is an accepted residual](./0013-two-runtime-var-local-bypass-activation-is-an-accepted-residual.md) | 0017, which carries both its grounds |

## Writing one

Follow the shape the existing records share: a title that states the decision as
a sentence, then a metadata block —

```markdown
- **Status**: Accepted
- **Date**: YYYY-MM-DD
- **Issue**: [#NNN](https://github.com/KeeprDigital/stream-keepr/issues/NNN)
```

— then Context, Decision, Consequences, and Alternatives rejected. Add
**Supersedes** / **Amended** lines when either applies, and add the record to the
right table above.

**Take the number at merge time, not at authoring time**, from `origin/main` at
the moment of the rename. Numbers come from a directory listing, which is correct
when it is read and stale by the time it merges — a filename collision is not a
merge conflict, so nothing flags it at any point. `docs/agents/parallel-rounds.md`
catalogues the two rounds this cost.
