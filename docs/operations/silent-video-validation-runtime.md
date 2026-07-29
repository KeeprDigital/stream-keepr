# Silent-video validation runtime

Silent-video publication requires the internal
`SilentVideoPlaybackValidator` owned by the Graphics Asset Library. Browser
clients are observation-only and cannot submit playback, browser-family,
transparency, or poster claims.

Production must bind `SILENT_VIDEO_PLAYBACK_VALIDATOR` to a private service
that starts or reconnects one idempotent Cloudflare Workflow for the supplied
validation idempotency key. That Workflow must run pinned native media tooling
in a scale-to-zero validation Container against the exact staged object
identified by the Graphics Ingestion Operation. It must independently verify
the supplied source SHA-256, byte length, canonical MIME, and inspected-facts
digest before decoding.

The pinned `@nuxthub/core` 0.10.8 public runtime interface does not expose an
API for starting or reconnecting Workflows or for executing Containers with
this idempotency contract. The provider-specific service binding is therefore
kept behind `SilentVideoPlaybackValidator`; NuxtHub remains authoritative for
the D1-backed ingestion state.

The pinned runtime must prove:

- complete decode of the exact source;
- muted inline-equivalent playback and deterministic seeks, including the
  profile poster time;
- VP9 alpha-plane decode and transparency for alpha-bearing sources; and
- deterministic transparent PNG poster generation fitted within 640 by 360
  without cropping or upscaling.

The service-binding response contract is implemented in
`silent-video-playback-validator.ts`. Every accepted or rejected result echoes
the operation identity, validation idempotency key, source digest, and facts
digest. An accepted response streams only the deterministic poster and returns
its digest and verified playback facts in response headers, including explicit
`x-stream-keepr-muted-inline-playback`, `x-stream-keepr-seeked`, and
`x-stream-keepr-transparency-rendered` booleans. Missing or malformed proof
headers fail retryably closed. Workflow durable state contains stable
identifiers and structured facts, never source or poster bytes.

This repository does not yet declare the production Workflow, Container image,
or service binding. Until deployment supplies that binding, the production
resolver deliberately returns a retryable `validation-runtime-unavailable`
failure and cannot publish silent-video revisions.
