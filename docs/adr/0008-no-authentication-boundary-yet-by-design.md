# ADR-0008: The installation has no authentication boundary yet, by design

- **Status**: Accepted
- **Date**: 2026-08-06 (decision recorded on the issue; promoted to this record 2026-08-07)
- **Issue**: [#205](https://github.com/KeeprDigital/stream-keepr/issues/205)
- **Decided by**: the owner, on #205; this record carries that decision verbatim in substance

## Context

There is no login and no role anywhere in this codebase. `server/middleware/graphics-author-session.ts` mints a Graphics Author Session on any non-`/api/` HTML `GET`, unconditionally and with no credential of any kind; `requireGraphicsAuthorSession` checks only that a session exists. The session is **attribution, not authentication** — it gives the Evidence Ledger an actor, separates one browser from another, and scopes ingestion operations to a session (ADR-0003). Nothing in it is checked against anything.

Every guard resting on it therefore admits any caller willing to make one extra request: the #90 ingestion and lifecycle write routes, the #116 lifecycle-actions route, and the #172 library read routes. #172 closed a real asymmetry (writes guarded, reads open), but its problem statement — an unauthenticated caller who can reach the API can enumerate the whole installation's Graphics Asset Library — remains literally true afterwards, at the cost of two requests instead of one. #205 was filed so this stopped being implicit: the fact was previously written down only in a test docblock, which is not where a deployer looks.

## Decision

**The application has no authentication yet by design, and authentication will be added to the app later — no boundary is being introduced now.** The installation trusts its network perimeter.

The Graphics Author Session remains what ADR-0003 and CONTEXT.md describe: an anonymous, self-issued attribution identity. The #90/#116/#172 guards stand as the structural seam a real credential will strengthen when app-level authentication lands.

## Consequences

- Deployments must treat the network perimeter as the security boundary. A browser source, operator console, or output page that can reach the server can mint an author session and read the whole Graphics Asset Library; `CONTEXT.md`'s capability-bound delivery rule ("a Screen Output may resolve only the Graphic Assets referenced by its Screen") holds within the delivery surface, not for the browser rendering it.
- Guards added in this codebase are session-scoping and attribution, and must not be described as authentication. A future guard inherits this record rather than the ambiguity it replaced.
- When app-level authentication lands, the existing `requireGraphicsAuthorSession` / capability seams are where a real credential attaches; that work supersedes this record's "no boundary" clause and should say so here.

## Alternatives rejected

- **Introduce a boundary now** (a shared token, a login) — rejected by the owner: authentication is planned app-level work, and a stopgap boundary would harden the wrong seam ahead of that design.
- **Leave the stance implicit** — rejected by #205 itself: every future guard inherits the ambiguity and looks stronger than it is.

## Related

ADR-0003 (the author session as attribution identity) · #205 (the decision) · #90, #116, #172 (the guards that are seams, not authentication) · #244, #270 (open authoring-surface questions that assume this stance)
