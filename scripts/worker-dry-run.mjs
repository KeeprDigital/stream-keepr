/**
 * `pnpm worker:dry-run` — bundle the built Worker exactly as `wrangler deploy`
 * would without promoting it, then assert the bundle compiles no Wasm at
 * runtime.
 *
 * The `--outdir` is absolute, and that is the whole point of this file.
 * Wrangler resolves a *relative* `--outdir` against the directory of its
 * `--config` file for the bundle but against the working directory for the
 * README it drops beside it, and this command's config is
 * `.output/server/wrangler.json`. So the repository-relative path the README
 * documented put the real bundle at `.output/server/.output/wrangler-dry-run/`
 * while wrangler created `.output/wrangler-dry-run/` anyway and left a README
 * in it announcing "the built output assets" — a grep of the documented path
 * came back empty and read exactly like a clean bundle (#318). Writing
 * `../wrangler-dry-run` instead only moves the trap: measured, it lands the
 * bundle correctly and the README *outside the repository*. An absolute path
 * is the one form both resolutions agree on.
 *
 * The `.env` a previewed Worker reads has the same config-relative rule and cost
 * this repository more; see `scripts/stage-preview-secrets.mjs`.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { assertWorkerConfigurationDoesNotAttestLocalRuntime } from '../build/localAuthDeployment.ts';
import { nativeScryptScan } from './assert-native-scrypt.mjs';
import { runtimeWasmScan } from './assert-no-runtime-wasm.mjs';

/** Both paths as the README writes them, relative to the repository root. */
const CONFIG = '.output/server/wrangler.json';
const OUT_DIR = '.output/wrangler-dry-run';
/**
 * Where the scrypt guard reads its resolution evidence. The `workerd` export
 * condition is applied by Nitro's bundling, so the source maps recording it
 * live in the build output — wrangler's re-bundle neither repeats nor undoes
 * that resolution (#393).
 */
const NITRO_OUT_DIR = '.output/server';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const outDir = fileURLToPath(new URL(`../${OUT_DIR}`, import.meta.url));
// The repository-pinned wrangler, not whatever a bare `wrangler` would find.
const wrangler = fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url));

try {
	const configuration = JSON.parse(readFileSync(new URL(`../${CONFIG}`, import.meta.url), 'utf8'));
	assertWorkerConfigurationDoesNotAttestLocalRuntime(configuration);
}
catch (error) {
	process.stderr.write(`worker:dry-run: unsafe or unreadable generated configuration — ${error.message}\n`);
	process.exit(1);
}

// Emptied first so what the guard reads is always what this run produced. A
// scan that passes over a previous run's leftovers is the same false clean the
// misplaced `--outdir` gave us. `.output` is gitignored and rebuilt by `nuxt build`.
rmSync(outDir, { recursive: true, force: true });

const dryRun = spawnSync(
	wrangler,
	['deploy', '--dry-run', '--config', CONFIG, '--outdir', outDir],
	{ cwd: repositoryRoot, stdio: 'inherit' },
);

if (dryRun.error) {
	process.stderr.write(`worker:dry-run: could not run ${wrangler} — ${dryRun.error.message}\n`);
	process.exit(1);
}

// A signalled wrangler reports a null status; that is a failure, not a pass.
if (dryRun.status !== 0)
	process.exit(dryRun.status ?? 1);

const scans = [
	runtimeWasmScan(outDir),
	nativeScryptScan(fileURLToPath(new URL(`../${NITRO_OUT_DIR}`, import.meta.url))),
];
for (const scan of scans) {
	for (const line of scan.lines)
		(scan.ok ? process.stdout : process.stderr).write(`${line}\n`);
}

process.exit(scans.every(scan => scan.ok) ? 0 : 1);
