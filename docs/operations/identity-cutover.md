# The identity cutover

The deploy that retires the anonymous Graphics Author Session and makes the
signed-in user the only author identity ([ADR-0010](../adr/0010-authentication-replaces-the-anonymous-author-session.md),
issue #398). It is a one-way change with **no migration code**, by decision: the
work in flight when it lands is drained first, and whatever is left is reclaimed
by machinery that already exists.

This runbook is what the operator does. It is short because the design made it
short — nothing here reshapes data.

## What changes at the moment of deploy

- A Graphics Ingestion Operation is owned by a **person**. One paused overnight
  is resumed by signing in from any machine, and the same idempotency key from a
  second browser continues the first operation instead of starting a second.
- A Graphics Authoring Lease is still held by a **browser** — a Better Auth
  session id — because one person in two windows is two editors.
- The Evidence Ledger records a userId and resolves the display name when the
  ledger is read.
- Nothing mints an identity any more. The KV namespace behind the retired
  session clears itself on its own 8-hour TTL, and the two cookies it left in
  browsers are expired by
  `server/middleware/retired-author-session-cookies.ts` on the first request
  each browser makes afterwards.

## Before the deploy

1. **Pick a quiet window.** Single-tenant, so the calendar is the owner's. Not
   during a show: an operator signed in on the old build has to sign in again on
   the new one, and a Broadcast Graphics Live Session is not the moment to
   discover that.
2. **Announce a drain.** Ask authors to finish or cancel uploads in progress and
   to answer anything sitting at `awaiting-confirmation`. The Operations Cockpit
   (`/admin/graphics-assets`) lists exactly what is unfinished, under Graphics
   Ingestion Operations.
3. **Check every account can sign in.** Every author needs a user account before
   the cutover, or they arrive on the new build with nothing to sign in as. The
   first-admin bootstrap creates the first one; the admin surface creates the
   rest.

Anything still unfinished when the window closes is not a blocker. It is
reclaimed by the ordinary 24-hour staged-input retention sweep.

## The deploy

`pnpm deploy`, as any other. The migration it carries is Better Auth's tables,
which are already present from the earlier tickets in this arc; nothing in this
deploy rewrites a row of graphics data.

## After the deploy

1. **Sign in.** The login page is `/login`. A session that predates the cutover
   is not affected — Better Auth sessions were already live before it — but a
   browser holding only the retired cookie will be sent to sign in.
2. **Start and finish one small upload** in the Library Workspace
   (`/graphics-assets`). That exercises initiation, transfer, validation, and
   publication under the new identity in one action.
3. **Read the cockpit.** Under Graphics Ingestion Operations, anything left from
   before the cutover now shows its initiator as **anonymous era**. That is the
   expected reading for an anonymous-era operation, not a fault.
4. **Confirm a lease still behaves.** Open a Screen's graphics Edit workspace in
   two browser windows: the second should observe read-only, and the takeover
   should name the other session. Two windows of _one_ account is the case worth
   checking, because it is the one a user-scoped lease would get wrong.

## The known wart

An anonymous-era operation can be revived by the administrator retry action
(`/admin/graphics-assets/queues`). It will then stall at any author-scoped step
— its `initiatedBy` can never match a real user again — and re-expire under the
24-hour sweep. Harmless and self-healing. ADR-0010 records it so nobody spends
an afternoon debugging it as a mystery; the fix is to leave it alone.

## What is deliberately not here

- **No migration or adoption tooling.** Draining plus existing retention
  reclaims everything a sweep can, and the leftovers are accurately recorded as
  anonymous. Rewriting `initiated_by` to a sentinel could collide on the
  `(initiated_by, idempotency_key)` unique index and would falsify the record.
- **No rollback step.** Rolling back to a build that mints anonymous sessions
  would orphan every operation started after the cutover in exactly the way this
  deploy avoids. If the new build has to come out, the operations started under
  it are the thing to check first.
