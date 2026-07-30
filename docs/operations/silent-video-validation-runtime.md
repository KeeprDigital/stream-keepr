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

## Production runtime

The runtime lives in `workers/silent-video-validator/`, a dedicated private
Worker named `stream-silent-video-validator`:

- `src/index.ts` exposes the `/validate` service-binding entrypoint. Each
  validation idempotency key maps to exactly one Workflow instance (the
  SHA-256 of the key), so repeated calls start or reconnect the same
  idempotent `silent-video-validation` Workflow. The entrypoint re-verifies
  the idempotency-key composition and the facts digest before touching any
  state, polls briefly for completion, and otherwise returns a retryable 503
  so the ingestion operation retries and reconnects later.
- The Workflow verifies the staged object at `ingestion/<operation>/source`,
  streams the exact bytes into the scale-to-zero validation Container, and
  stores only structured facts durably. The deterministic poster is written to
  `validation/silent-video/<validation-id>/poster` in the staging bucket and
  streamed back on the accepted response; durable state never contains binary
  payloads. Consumed posters are reclaimed by the staging bucket's
  `silent-video-validation-posters` lifecycle rule (30-day expiry on the
  `validation/silent-video/` prefix), created at first deployment with
  `wrangler r2 bucket lifecycle add`.
- Validations map deterministically onto a small warm Container pool sized to
  the container application's `max_instances`; a busy Container answers 409
  and the Workflow step retries, so bursts queue instead of exhausting
  container capacity.
- Automatic retries stay bounded inside the Workflow's per-step retry
  configuration. An instance that settles as errored or terminated is never
  restarted automatically; the service binding keeps answering with a
  retryable failure until an operator fixes the cause and runs
  `wrangler workflows instances restart silent-video-validation <id>`.
- `container/` holds the pinned image: the base image is digest-pinned and
  chromium/ffmpeg resolve from a fixed `snapshot.debian.org` archive
  (`DEBIAN_SNAPSHOT` build argument), so rebuilds produce identical tool
  versions and identical deterministic poster bytes.
  The Container independently recomputes the source
  SHA-256 and byte length, verifies container/codec/dimension/duration
  identity with ffprobe, proves complete decode and the exact inspected frame
  count with ffmpeg (libvpx-vp9 for VP9 so alpha planes decode), proves muted
  inline playback, deterministic seeks including the poster time, and
  VP9-alpha transparency in headless Chromium, and then renders the
  deterministic transparent PNG poster at the settled fit dimensions. It has
  no outbound network access.

`workers_dev` and preview URLs are disabled: the Worker is reachable only
through the `SILENT_VIDEO_PLAYBACK_VALIDATOR` service binding declared in the
root `wrangler.jsonc`.

## Deployment

Deploy the validator before the first `pnpm deploy` that carries the service
binding, and again whenever `workers/silent-video-validator/` changes:

1. `pnpm deploy:validator` (requires a running Docker engine to build the
   pinned Container image; Workflows and Containers must be enabled on the
   Cloudflare account).
2. `pnpm deploy` for the stream Worker.
3. `pnpm test:validator:silent-video:deployed` stages the exact fixture
   revisions in production R2, runs the deployed Workflow and Container for
   H.264 MP4, VP9 WebM, and VP9-alpha WebM, verifies acceptance facts and
   poster digests, and cleans up.

`pnpm test:validator:silent-video` runs the same acceptance locally against
`wrangler dev` (Docker required), including a deterministic metadata
rejection. The fixtures and their inspector-derived facts live in
`scripts/silent-video-validator-fixtures.json` and are pinned to the bounded
inspector by `test/unit/server/modules/silentVideoValidatorFixtures.test.ts`.
