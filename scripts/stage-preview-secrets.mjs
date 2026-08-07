/**
 * Put `.dev.vars` where the previewed Worker will actually look for it.
 *
 * Wrangler resolves `.dev.vars` against the directory of its **config file**,
 * and `pnpm preview` passes `--config .output/server/wrangler.json` — so the
 * file it opens is `.output/server/.dev.vars`, never the repository root's.
 * Nothing copied it there, and nothing said so: the previewed Worker simply
 * came up with no environment variables at all, and the first authored request
 * answered 503. `docs/agents/parallel-rounds.md` meanwhile told every agent
 * that copying `.dev.vars` into the worktree was what made `pnpm preview` work,
 * so following the repository's own instructions exactly still produced the
 * failure — necessary and not sufficient, with nothing anywhere naming the gap
 * (#274).
 *
 * Measured rather than reasoned about, twice over and independently: a probe
 * with a minimal Worker showed the root file delivering nothing and the same
 * file beside the config delivering the value, and #189's run of the real
 * preview showed wrangler's own bindings table listing no environment
 * variables before the copy and both names after it.
 *
 * Staging rather than a flag. `wrangler dev --env-file` can deliver the same
 * value, but it resolves relative paths against the config directory too — so
 * it needs the same `.output/server` knowledge this step has, spelled into a
 * command line where nothing checks it. Its behaviour on a path it cannot read
 * is not something to build on either: probing it produced a served-but-
 * unconfigured Worker in one shape and an immediate `node: <path>: not found`
 * exit in another, and this repository pins wrangler 4.113 while a
 * `pnpm dlx wrangler` picks up 4.119. A step that must be reliable should not
 * rest on a flag whose failure mode we could not pin down. A copy either
 * happens or reports why it did not, and the repository root stays the single
 * documented source of truth that the preflight also reads.
 *
 * Safe to leave behind: `.output` is gitignored and rebuilt by every `nuxt
 * build`, and `.dev.vars` is dev-only to Wrangler. Checked against a deploy dry
 * run with one beside the config: the value appears in none of the emitted
 * files, and no binding is created from it — the bindings the real
 * `.output/server/wrangler.json` declares (KV, D1, two R2 buckets, the
 * validator service, ASSETS) are all it lists, with nothing from `.dev.vars`
 * among them.
 *
 * Never fails the preview. Plenty of this application runs without these names,
 * and a worktree opened to look at the UI should not be stopped from previewing
 * it; the same judgement #130 made about the dev-server warning.
 */

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import {
	localConfigurationNotice,
	missingLocalAcceptanceNames,
	previewStagingPlan,
	RESOLVED_PREVIEW_DEV_VARS,
	suppliedNames,
} from './graphics-acceptance/local-configuration.mjs';

const SOURCE = new URL('../.dev.vars', import.meta.url);
// The same constant the preflight reads, so the two cannot drift apart.
const RESOLVED = new URL(`../${RESOLVED_PREVIEW_DEV_VARS}`, import.meta.url);
const RESOLVED_DIRECTORY = new URL('./', RESOLVED);

/** Absent is the ordinary state of both of these, and never an error here. */
function read(path) {
	try {
		return readFileSync(path, 'utf8');
	}
	catch {
		return null;
	}
}

const body = read(SOURCE);
const plan = previewStagingPlan({ source: body, existing: read(RESOLVED) });

for (const line of plan.lines)
	process.stdout.write(`${line}\n`);

if (plan.stage) {
	mkdirSync(RESOLVED_DIRECTORY, { recursive: true });
	copyFileSync(SOURCE, RESOLVED);
}

// Keyed on the name being unusable rather than on the file being absent, so a
// verbatim copy of `.dev.vars.example` — every name present and empty — is told
// the same thing as a checkout with no file at all.
const missing = missingLocalAcceptanceNames(suppliedNames([process.env, body]));
if (missing.length > 0)
	process.stderr.write(`${localConfigurationNotice(missing)}\n`);
