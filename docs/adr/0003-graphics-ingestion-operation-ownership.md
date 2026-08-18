# ADR-0003: A Graphics Ingestion Operation stays owned by one graphics author session, and the session's eight hours run from its last request

- **Status**: Superseded at ADR-0010's cutover ([#398](https://github.com/KeeprDigital/stream-keepr/issues/398)), as this record pre-committed: a person now exists, so ownership belongs to the person and the sliding-8-hour session is retired. What survives is the _argument_ — ownership bounds who reads unpublished staged bytes — which now binds to the user; what does not is the session that carried it. Read below for why the boundary was drawn where it was, not for how the installation behaves today
- **Date**: 2026-08-02
- **Issue**: [#176](https://github.com/KeeprDigital/stream-keepr/issues/176)
- **Follows**: [#37](https://github.com/KeeprDigital/stream-keepr/issues/37) (the first route to require a session) and [#90](https://github.com/KeeprDigital/stream-keepr/issues/90) (the session became the only ingestion identity)

## Context

A graphics author session is the whole of the identity behind the Graphics Asset
Library's author-facing surface. It is minted server-side on an ordinary HTML
navigation, kept in an `httpOnly` cookie against a KV entry, and carries a random
`authorId`. Since #90 that `authorId` is the `initiatedBy` of every Graphics
Ingestion Operation and is matched exactly on all thirteen operation routes, so
an operation's UUID is a name rather than a right.

It is worth being explicit about what this session is **not**. There is no user,
account, or credential anywhere in the installation — the schema has no such
table, and the only other gate in the product is a shared administrator token.
Nobody logs in to become a graphics author; loading a page is what makes you one.
The session is an anonymous, self-issued, unauthenticated identity whose sole
power is over the operations that same session created.

The lifetime was eight hours **from issue**, and nothing extended it. So an
author working a long day crossed it mid-upload, and three things followed in
order:

1. every ingestion route answered `401`, and no code path in `app/` handled a
   `401` on this surface at all, so it surfaced as a raw status;
2. the obvious recovery, reloading, minted a new session with a new random
   `authorId`;
3. every operation the previous session had created was therefore owned by an
   identity nobody held — a `404` to its own author, permanently, unresumably.

A large resumable transfer is both the case most likely to span eight hours and
the most expensive to lose. Retention still reclaims the staged input on the
ordinary schedule, so this is lost work rather than leaked storage.

Adding a `401` handler alone would have produced a legible message about an
unrecoverable state. The recovery question is separate from the message, and
issue #176 named three shapes for it.

## Decision

**Two things, and they are separate answers to separate halves.**

1. **The eight hours run from the session's last request, not its first.** Every
   read of a live session in `server/modules/graphics-author-session.ts` carries
   it forward a further full TTL — the KV entry and the cookie together — so a
   session cannot lapse while its author is working. A transfer in progress is a
   stream of requests, so it holds its own session open.
2. **Ownership stays per-session.** An operation belongs to the session that
   started it and to nothing more durable, and the Library Workspace states that
   before an upload begins rather than after one is lost.

### Why sliding is the answer to the acceptance criterion

The criterion is that _an author working continuously does not lose in-flight
operations to session expiry_. Sliding removes that case completely, because
"working continuously" and "issuing requests" are the same thing here. It is
also the only one of the three shapes that closes it without changing what an
operation belongs to.

### Why not mint a session on `/api/` requests too

Because a new session is a new author. An expired session that self-heals on the
next API call would answer `404 no such operation` instead of `401 no session`,
which is strictly less legible: the author would be told their work does not
exist rather than that their session ended. Minting on `/api/` only helps in
combination with durable ownership, and on its own it removes the one signal
that says what actually happened.

### Why ownership is not made to survive re-authentication

This is the shape #176 calls the real fix, and it is refused for a specific
reason rather than for its size: **there is nothing for an operation to belong
to.** "Survive re-authentication" presumes an authentication to survive, and the
product has none. Any surrogate durable enough to outlive a session — a
long-lived second cookie, a device identifier — is a session with a longer name,
and it adds a second identity space to keep consistent with the first.

**It would genuinely help, and saying otherwise would be too convenient.** A
device-scoped identity _would_ close the residual case below: an operation
paused overnight would still be its author's in the morning. What it would not
close is a cleared cookie, a different machine, or the second browser — so it
buys a longer window rather than durable ownership, while presenting itself as
the latter.

The argument that actually carries is the read boundary #37 deliberately
narrowed. An operation's provisional staged bytes are readable by its author
through `GET .../staged-source`. Ownership is what bounds that, so a longer-lived
identity is a longer-lived grant to read unpublished bytes — and one that
outlives the browser session an author thinks they closed.

The honest form of this shape is an authentication ticket that introduces a
person to the product, at which point this ADR is reopened and ownership moves
to the person. Until then, per-session ownership is what the library can
actually enforce, and #90's documentation of it stands.

### Why the sliding lifetime has no absolute cap

An absolute cap is the standard control for a credential, and this is not one.
Anyone who can reach the application can mint a fresh graphics author session by
loading a page, without proving anything, so capping the age of an existing
session withholds nothing that a new one does not hand over freely. What the cap
did bound was how long the identity owning your in-flight work survived — which
is the harm, not the control.

The risk a lifetime bound genuinely addresses here is a session left behind on a
shared machine, and an **idle** bound addresses that better than an absolute one:
it is measured from the last use rather than from the first, so an abandoned
browser expires on schedule while a working one does not.

### Why a request does not always rewrite the session

`GRAPHICS_AUTHOR_SESSION_REFRESH_AFTER_SECONDS` is 60: a request only rewrites
the session if the stored expiry is more than a minute stale. This is not only a
cost decision. Workers KV rate-limits writes to a **single key** to roughly one
per second, and a resumable transfer sends parts concurrently — so a session
rewritten on literally every request would be rewritten many times a second
under exactly the load this ADR exists to protect. The grace takes that from one
write per request to at most one per sender per minute; a hundred-part transfer
stops costing a hundred writes.

**It does not serialise those senders, and stating otherwise would overclaim
it.** The refresh decision is made from the `expiresAt` the request has just
read, so concurrent senders can read the same stale value and all write in the
same instant — a burst of up to the concurrent-part limit, once a minute, of
which the platform may reject all but one. That is safe rather than merely rare:
every one of those writes sets the same value, so whichever lands extends the
session by the same amount, and a rejected one is swallowed. What the grace
guarantees is the bound on frequency, not the absence of a burst. The effective
idle window is eight hours, give or take a minute.

A failed rewrite is swallowed rather than raised. The caller holds a session that
is live at that instant; refusing the request would turn a lost extension into a
lost request.

## Consequences

- **The remaining gap is stated, not closed.** A session still lapses after eight
  idle hours, and the case that reaches it is an operation paused at
  `awaiting-confirmation` — where an approved remote copy waits for its author,
  and where a Template Package import waits for its confirmation — with the
  browser closed overnight. That operation is unreachable in the morning, and its
  staged input is reclaimed on the ordinary retention schedule. This is the cost
  per-session ownership is being kept at. The workspace now _says so_ at that
  moment too: reconnecting from the durable pointer used to swallow its own
  failure, so the one moment this decision costs an author something was the one
  moment they were told nothing.
- **The Workspace says so before an upload starts.** The notice is
  `GRAPHICS_AUTHOR_SESSION_OWNERSHIP_NOTICE` in
  `app/composables/useGraphicsAuthorSession.ts`, rendered in the "Add one asset"
  card, and the same composable names a lapse when one happens instead of showing
  a status code. Every catch on that surface routes through one function, because
  the surface previously had no `401` branch at all and scattering the check is
  how that happens again.
- **All four author-facing surfaces name a lapse, not just the Workspace.** The
  Broadcast Graphic Template, Feature Match Layout Template and Graphic Style Set
  libraries report every refusal through `useReusableLibraryReading`, so the
  check lives there rather than at the nine call sites that reach an ingestion or
  package route. Their imports are the paused-confirmation case above, which
  makes them the surfaces most likely to meet a lapse and the last place it
  should read as a raw status.
- **A refused part is not retried.** A `401` mid-transfer means the author is
  gone, not that the transport failed, so the client stops rather than spending
  its remaining attempts on a request that cannot succeed.
- **The same person in a second browser is still a second author.**
  `docs/operations/approved-remote-graphics-copy.md` says so, and continues to.
- **The glossary gap is real and is tracked separately.** "Graphics author
  session" is load-bearing across the whole asset library and absent from
  `CONTEXT.md`; [#177](https://github.com/KeeprDigital/stream-keepr/issues/177)
  is where it gets recorded, and this decision is what it should record about
  lifetime and ownership.
- **Reversing this** means introducing a person to the product. The test to keep
  is the integration case in `graphicsIngestionAuthorisation.test.ts` proving
  that a lapse costs the identity allowed to continue a transfer and nothing
  else: the durable multipart checkpoint survives it intact, which is what makes
  a longer-lived identity a complete fix rather than a partial one when there is
  finally something to attach it to.
