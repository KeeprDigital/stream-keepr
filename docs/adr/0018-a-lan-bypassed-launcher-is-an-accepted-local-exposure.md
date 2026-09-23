# ADR-0018: A LAN bypassed launcher is an accepted local exposure

- **Status**: Accepted
- **Date**: 2026-09-23
- **Amends**: [ADR-0017](./0017-the-local-auth-bypass-is-one-launcher-owned-name.md), in its list of launchers

## Context

ADR-0017 named two bypassed launchers, `pnpm dev:bypass` and
`pnpm preview:bypass`, both on loopback. `pnpm dev:local` binds `0.0.0.0` so the
app can be exercised from another device, and was deliberately given no bypassed
twin: unauthenticated on the LAN was the one combination the README warned
against, and a test asserted that `dev:local:bypass` did not exist.

That left LAN testing with no working route to operator pages. Better Auth admits
only the hostnames in `AUTH_ALLOWED_HOSTS` — the production domain and loopback —
so a device reaching the dev server by LAN address cannot sign in. Only Screen
Outputs, which carry a capability rather than a session, worked from another
machine.

## Decision

**`pnpm dev:local:bypass` exists, and is `dev:local` plus the bypass
assignment.** A `:bypass` suffix is the single mark of a launcher that arms the
bypass; it never changes where a launcher binds. The launcher is the only
bypassed one that leaves loopback.

Everything ADR-0017 decided holds: one name, set on the command line, written in
no file other than the `:bypass` scripts in `package.json`, refused in generated
Worker configuration by `pnpm worker:dry-run`.

## Consequences

- While it runs, every machine that can reach this one has the Local Developer
  User's access. The exposure is bounded by the network the developer is on and
  the lifetime of the process; nothing ships, and a deployed installation is
  unaffected.
- The README carries the warning at the launcher's row rather than a ban.
- `test/unit/scripts/workerSmoke.test.ts` pins the launcher to its twin's
  `--host 0.0.0.0`, and still refuses the name in every unsuffixed script.

## Alternatives rejected

- **Add LAN hostnames to `AUTH_ALLOWED_HOSTS` and sign in for real.** A LAN
  address or `.local` name is per-machine, so it either becomes a wildcard in
  the production allowlist or a per-developer edit to committed code; and
  sign-in over plain http from another host is its own cookie question. It buys
  a boundary on a network the developer already trusts.
- **Forward `--host` through `dev:bypass`.** Fewer scripts, but LAN exposure
  becomes an unnamed flag rather than a launcher the README and the test can
  point at.
