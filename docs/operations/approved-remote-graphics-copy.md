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
  and fully revalidated, with repeat destinations rejected as a loop;
- **non-public destinations rejected** — loopback, this-network, private,
  carrier-grade NAT, link-local (including the `169.254.169.254` cloud-metadata
  address), IETF protocol-assignment, documentation, benchmarking, 6to4 relay,
  multicast, reserved, and broadcast ranges, their IPv6 equivalents, and
  IPv4-mapped and NAT64-embedded forms of all of the above. Hostnames that
  cannot denote a public destination (`localhost`, `.local`, `.internal`,
  `.home.arpa`, reverse-DNS zones, and known cloud-metadata names) are rejected
  before any lookup;
- **an exact declared length** — the response must declare a `Content-Length`
  within the byte limit for the Graphic Asset kind, and the observed bytes must
  match it exactly while streaming into staging. Nothing is buffered whole in
  Worker memory.

Redirects are followed manually (`redirect: 'manual'`). The runtime's automatic
`follow` mode forwards `Cookie` and `Authorization` across hostnames, so it is
never used here.

## What is treated as an untrusted hint

The remote `Content-Type` and any remote file name are ignored entirely. The
authoritative kind, format, canonical MIME, technical facts, and SHA-256 come
from the library's own bounded parsing and decoding of the staged bytes, exactly
as for a local upload. The declared length is a bound that must be matched, not
a fact that is trusted. A remote digest is never accepted as proof of anything.

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

## Browser confirmation

A local upload arrives with browser decode or font evidence for the author's own
file. An approved remote copy has no client-side bytes, so after server-side
validation the operation pauses at `awaiting-confirmation`. The workspace reads
the exact staged bytes from
`GET /api/graphics-assets/ingestion-operations/:id/staged-source` — private,
`no-store`, gated on a graphics-author session, scoped to the initiating author,
and only while that operation is awaiting confirmation — produces the evidence,
and submits it to
`POST /api/graphics-assets/ingestion-operations/:id/browser-evidence`.

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
