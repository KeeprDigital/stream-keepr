# Approved remote HTTPS Graphic Asset copying

A graphics author may bring a remote resource into the Graphics Asset Library as
a one-time bounded copy. The copy runs through the same durable Graphics
Ingestion Operation, the same staging bucket, the same compatibility profile,
and the same publication transaction as a local upload; only the byte source
differs. A published Graphic Asset never retains a hotlink, refresh schedule,
synchronization link, or any other dependency on the remote host.

## What the fetcher enforces exactly

`server/modules/graphics-asset-library/remote-source.ts` opens the remote source
and enforces, at the initial URL and again after every redirect:

- **public HTTPS only** — any other scheme, including a redirect that downgrades
  to plaintext HTTP, is rejected;
- **no embedded credentials** — a URL carrying userinfo is rejected, and no
  cookie, authorization header, reusable cloud credential, or interactive
  authentication is ever supplied. The only request header sent is `accept`;
- **at most three redirects**, each `Location` resolved against the current hop
  and fully revalidated, with an exactly repeated URL rejected as a loop;
- **non-public destinations rejected** — loopback, this-network, private,
  carrier-grade NAT, link-local (including the `169.254.169.254` cloud-metadata
  address), IETF protocol-assignment, documentation, benchmarking, 6to4 relay
  anycast, multicast, reserved, and broadcast ranges; their IPv6 equivalents
  (unspecified, loopback, unique-local, link-local, multicast, discard-only,
  documentation, ORCHIDv2); and every embedded-IPv4 form — IPv4-mapped,
  IPv4-compatible, NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`), each unwrapped
  and judged by the IPv4 rules. Teredo (`2001::/32`) is rejected outright
  because its relay and client addresses cannot be verified. Hostnames that
  cannot denote a public destination (`localhost`, `.local`, `.internal`,
  `.home.arpa`, reverse-DNS zones, and known cloud-metadata names) are rejected
  before any lookup;
- **a bounded transfer** — the copy is always bounded by the byte limit for the
  Graphic Asset kind, and nothing is buffered whole in Worker memory.

Redirects are followed manually (`redirect: 'manual'`). The runtime's automatic
`follow` mode forwards `Cookie` and `Authorization` across hostnames, so it is
never used here.

## What is treated as an untrusted hint

The remote `Content-Type` and any remote file name are ignored entirely. The
authoritative kind, format, canonical MIME, technical facts, and SHA-256 come
from the library's own bounded parsing and decoding of the staged bytes, exactly
as for a local upload. A remote digest is never accepted as proof of anything.

`Content-Length` is a hint too. When the origin declares a usable length it is
rejected early if it exceeds the kind's limit, and the delivered bytes must then
match it exactly. When the origin declares none — chunked HTTP/1.1, many HTTP/2
origins, and runtime-decompressed responses legitimately omit or misstate it —
or declares an unusable value, the length is simply unknown and the transfer is
bounded by the kind's maximum instead. An unknown-length copy accumulates up to
one 16 MiB multipart part; only if the source outgrows that part does a
resumable multipart transfer begin, so at most one part is ever resident.

The Graphic Asset name and the optional source file-name hint are author-supplied
at initiation, and the workspace derives the hint from the URL **path** only.

## Secrets

Query parameters and fragments are treated as secrets. The URL is supplied once
per copy attempt in the request body of
`POST /api/graphics-assets/ingestion-operations/:id/remote-copy` and is never
persisted, logged, reported, or stored in browser state. Rejection messages
carry at most `scheme://host`. Because nothing retains the URL, retrying a copy
that failed before any byte reached staging asks the author for the URL again;
once bytes are staged, the ordinary retry path resumes from them without it.

Callers must not derive the operation's idempotency key from the URL — the key
is durable state.

## Staging capacity

A remote length is unknowable at initiation, so the operation reserves the
worst-case staging envelope for the Graphic Asset kind implied by its
declarations, and the reservation is reduced to the observed length once the
copy is staged. A remote source without a recognisable path extension or an
author-declared media type is therefore bounded as a still image (25 MiB).

## Retention of a remote copy's staged input

A remote copy stages its complete input through `recordRemoteCopyStagedSource`
rather than the streamed-upload path's `recordStagedBytes`. Both record the same
durable `transfer_completed_at` fact, because retention classifies staged input
on that column alone: set means the seven-day completed-input guarantee, unset
means the 24-hour incomplete-transfer one. Stage cannot answer it, since
`failed` is reachable both mid-transfer and after the input was durably staged.
A remote copy paused at `awaiting-confirmation` therefore keeps its full seven
days, which matters because that pause is where a remote copy normally waits for
the author.

Staged-object cleanup needs no remote-specific knowledge: the copy writes only
`ingestion/<operation>/source`, already part of the set that cancellation,
terminal failure, and staged-input expiry all reclaim.

**Multipart checkpoint.** The unknown-length path can start a multipart upload
that outlives the request holding it, so the `uploadId` is written durably before
the first part is sent. The checkpoint reuses the operation's `multipart_state`
column and carries the `uploadId` alone — a remote copy has no client parts to
record — which is why a remote-copy operation never reports client-transfer facts
even while it holds one.

The checkpoint is cleared as soon as there is nothing left to abort: when the
upload completes, when the request's own abort succeeds, and again when the copy
records its durably staged source. An abort that did not land deliberately leaves
the checkpoint in place. What survives is reclaimed by the paths that already
read `multipart_state` — staged-input expiry through `releaseStagedObjects`, and
cancellation through the multipart cleanup path — with no remote-specific
knowledge and no bucket lifecycle rule.

An operation has one checkpoint, so a retry must not take a second upload while
the first is still recorded — the retry would overwrite the only record of it.
Each attempt therefore reclaims what it finds: it aborts any checkpointed upload
before opening the remote source, and refuses to start, leaving that checkpoint
intact, if the abort does not land. Copying is then unavailable until the upload
can be aborted or the 24-hour sweep expires the operation, which is the trade the
client-driven transfer already makes when it cannot resume its own checkpointed
upload. Deleting `ingestion/<operation>/source` does not substitute for the
abort: a multipart upload is independent of the object key it will become.

**Residual gap.** An upload goes unreferenced only if the catalogue write that
would record it fails _and_ the abort that follows also fails — the catalogue and
the object store unavailable within one attempt. Nothing then names those parts,
and the staging bucket has no lifecycle rule that would bound them.

## Browser confirmation

A local upload arrives with browser decode or font evidence for the author's own
file. An approved remote copy has no client-side bytes, so after server-side
validation the operation pauses at `awaiting-confirmation`. The workspace reads
the exact staged bytes from
`GET /api/graphics-assets/ingestion-operations/:id/staged-source` — private,
`no-store`, gated on an authenticated graphics author session, scoped to the
session that initiated the operation, and readable only while that operation is
awaiting confirmation — produces the evidence, and submits it to
`POST /api/graphics-assets/ingestion-operations/:id/browser-evidence`.

## Who a Graphics Ingestion Operation belongs to

The authenticated graphics author session is the author identity, on this route
and on every other. An operation records the session that initiated it as its
`initiatedBy`, every route resolves the asking author the same way, and the
library matches the two before it will answer at all — so an operation's UUID is
a name, not a right, and a second author who learns one is told the operation
does not exist. The same holds for an idempotency key: keys are unique per
author, so reusing another author's key opens a new operation of one's own
rather than reconnecting to theirs.

There is no longer any client-supplied author header. The former
`x-graphics-author-id` was unauthenticated and is gone from the whole library;
nothing on the wire names an author except the session cookie.

Two consequences worth stating plainly, and one of them has changed.

A graphics author session lasts eight hours **from its last request**, not from
the moment it was minted. Every request that presents a live session carries it
forward a further eight hours — the KV entry and the cookie together, and no
more often than once a minute, because Workers KV rate-limits writes to a single
key. A transfer in progress is a stream of requests, so it holds its own session
open and cannot be expired out from under itself. What still lapses is a session
nobody is using: an operation paused at `awaiting-confirmation` with the browser
closed overnight is unreachable in the morning, because it belongs to a session
that has ended. Retention still reclaims its staged input on the ordinary
schedule, but its author cannot resume it.

And an operation is owned by one session rather than by a person: the same author
in a second browser is a second author here. That is deliberate, and there is
nothing more durable to own it — the installation has no accounts, so nobody logs
in to become a graphics author. [ADR-0003](../adr/0003-graphics-ingestion-operation-ownership.md)
records the decision, what it costs, and what would have to exist before it could
be reversed. The Library Workspace states it before an upload begins, and names a
lapsed session rather than a bare `401` if one happens.

`docs/operations/graphics-operations-cockpit.md` describes the administrator
surface, which is gated by the installation's admin token instead. That gate is
unchanged. What the Evidence Ledger records for an administrator's action did
change: the actor was a client-supplied header, so any holder of the admin token
could write any name into the ledger, and it is now the asking graphics author
session where there is one and a plain `graphics-administrator` where there is
not.

## Still unauthenticated

Guarding ingestion and lifecycle did not gate the library's read surface.
`GET /api/graphics-assets`, `capacity`, `thumbnail`, `usage` and `retention`
still answer an unauthenticated caller, so the installation's asset names,
thumbnails, usage and capacity remain enumerable without a session. Tracked as
issue #172; gating the listing route also needs the Library Workspace's
server-side render to forward its cookie, which is what makes it more than a
guard.

## Platform limitation: DNS rebinding

DNS resolution uses Cloudflare's DNS-over-HTTPS JSON API through
`remote-source-resolver.ts`, and every returned A and AAAA record must be public
before the request is made. A resolver failure, or a partially resolved
hostname, fails closed as retryably unavailable and is never treated as a public
answer.

**The resolved-address rule is best-effort, not airtight.** The Workers runtime
exposes no API that reveals the address `fetch` actually connects to, and
`fetch` cannot be pinned to a pre-resolved address:

- `node:dns` and Cloudflare DoH both resolve independently of the later
  subrequest, leaving a window in which an authoritative server can return a
  public address to us and a private one to the runtime;
- `SocketInfo.remoteAddress` from `cloudflare:sockets` echoes the address that
  was passed in, so it cannot verify a peer after connecting;
- nothing on `Response` or in the `cf` object carries the origin's resolved IP.

Cloudflare additionally blocks Worker subrequests to IP literals and returns
error 1021 for hosts a Worker may not access, but that behaviour has no
published CIDR list and does not apply in local `wrangler dev`, so it is treated
as defence in depth rather than as the control.

Every other rule in this document — scheme, credentials, hostname literals and
denied suffixes, redirect count, and byte limits — is enforced exactly and is
unaffected by this window.

## NuxtHub integration

No new direct Cloudflare dependency is introduced. Authoritative operation state
stays in `hub:db`, bytes stay behind the existing Graphics Object Store staging
adapter, and both the remote fetcher and its resolver use ordinary `fetch`
behind the internal `GraphicsRemoteSourceFetcher` and
`GraphicsRemoteHostResolver` seams, which module tests substitute directly.
