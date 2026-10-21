/**
 * `pnpm accept` — one entry point for every acceptance harness.
 *
 * Each harness used to be two or three package scripts that differed only by
 * a flag (`:deployed`, `:library`). This table is now the one list: what each
 * harness proves, what it needs to run locally, and which flags it takes.
 * Flags after the name pass straight through to the runner.
 *
 * Usage:
 *   pnpm accept                       list the harnesses
 *   pnpm accept <name> [flags…]       run one, e.g. `pnpm accept fonts --library`
 *   pnpm accept deployed              the deploy-day sequence (README § Deploy
 *                                     day), each with --deployed, stopping at
 *                                     the first failure
 */

import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadCommittedInstallation, resolveDeployedTarget } from './graphics-acceptance/deployed-target.mjs';
import { AcceptanceFailure, createAcceptanceEvidence } from './graphics-acceptance/evidence.mjs';
import { reportFailures } from './graphics-acceptance/harness.mjs';

/**
 * Name → runner script (and its leading arguments), what it proves, what a
 * local run needs, and the flags it accepts besides `--deployed`.
 * `deployed: false` marks a harness with no deployed mode.
 *
 * @type {Record<string, { script: string[], proves: string, needs: string, flags?: string, deployed?: false }>}
 */
export const HARNESSES = {
	'still-images': {
		script: ['run-browser-page-acceptance.mjs', 'still-images'],
		proves: 'PNG, JPEG, and WebP decode in an OBS-like output',
		needs: 'Chrome/Chromium',
	},
	'silent-video': {
		script: ['run-browser-page-acceptance.mjs', 'silent-video'],
		proves: 'MP4 and WebM play and seek; VP9 alpha keeps transparency on Chromium',
		needs: 'Chrome/Chromium',
	},
	'fonts': {
		script: ['run-font-browser-acceptance.mjs'],
		proves: 'Font faces load and render their glyphs; defective faces are refused',
		needs: 'Chrome/Chromium; --library also needs `pnpm preview`',
		flags: '--library',
	},
	'animation-effects': {
		script: ['run-animation-effect-rendering-acceptance.mjs'],
		proves: 'Every Animation Effect shader compiles, lights a frame, and moves; halo\'s trails fade out',
		needs: 'Chrome/Chromium',
		deployed: false,
	},
	'key-matte': {
		script: ['run-key-matte-rendering-acceptance.mjs'],
		proves: 'Every glow host keys into the Key Output at its own opacity, matching the Fill Output',
		needs: 'Chrome/Chromium',
		deployed: false,
	},
	'still-image-ingestion': {
		script: ['run-still-image-ingestion-acceptance.mjs'],
		proves: 'JPEG and WebP ingestion decodes on workerd',
		needs: '`pnpm preview` at 127.0.0.1:8787',
	},
	'silent-video-validator': {
		script: ['run-silent-video-validator-acceptance.mjs'],
		proves: 'The validator Workflow and Container accept MP4, WebM, and VP9-alpha WebM',
		needs: 'Docker',
		flags: '--cleanup (with --deployed: retry a failed run\'s deletes)',
	},
	'graphics-delivery': {
		script: ['run-graphics-delivery-acceptance.mjs'],
		proves: 'Ranged and conditional delivery, caching, authorization, revocation, failure outcomes',
		needs: '`pnpm preview`',
		flags: '--require-cache-hit, --arm <file>, --fault <name> --scenario <file>',
	},
	'graphics-package': {
		script: ['run-graphics-package-acceptance.mjs'],
		proves: 'Template Package publication is atomic and its retry is idempotent',
		needs: '`pnpm preview`',
	},
};

/** README § Deploy day, step 5, in order. */
export const DEPLOY_DAY = [
	'silent-video-validator',
	'graphics-delivery',
	'still-images',
	'silent-video',
	'fonts',
	'graphics-package',
];

function run(name, flags) {
	const [script, ...leading] = HARNESSES[name].script;
	const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...leading, ...flags], {
		stdio: 'inherit',
	});
	return new Promise((resolve) => {
		child.once('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
	});
}

function list() {
	const width = Math.max(...Object.keys(HARNESSES).map(name => name.length));
	const lines = Object.entries(HARNESSES).map(([name, harness]) => {
		const flags = [harness.deployed === false ? undefined : '--deployed', harness.flags].filter(Boolean).join(', ');
		return `  ${name.padEnd(width)}  ${harness.proves}\n  ${''.padEnd(width)}  needs: ${harness.needs}${flags ? `; flags: ${flags}` : ''}`;
	});
	process.stdout.write(`Usage: pnpm accept <name> [flags…] | pnpm accept deployed\n\n${lines.join('\n')}\n\n`
		+ `deployed  runs ${DEPLOY_DAY.join(', ')} with --deployed, stopping at the first failure\n`);
}

/**
 * The whole deploy-day target, checked once before the first gate (#619).
 *
 * Each gate also checks its own prerequisites, but the first gate writes to the
 * installation, so a later gate refusing a missing setting used to leave the
 * first one's writes behind for nothing. Pure: nothing is opened or written.
 */
async function preflightDeployDay(env) {
	const evidence = createAcceptanceEvidence({ harness: 'accept-deployed' });
	try {
		resolveDeployedTarget({ env, installation: await loadCommittedInstallation() });
		return true;
	}
	catch (error) {
		const failure = error instanceof AcceptanceFailure
			? error
			: new AcceptanceFailure('harness-precondition-unmet', { reason: 'target-unreadable' });
		const line = reportFailures(evidence, 'accept-deployed', [failure]);
		process.stderr.write(`${line}\n\n✗ the deployed target is incomplete; no deploy-day harness ran\n`);
		return false;
	}
}

/**
 * What `main` runs a harness with unless it is told otherwise: nothing.
 *
 * Only the CLI entry point below passes the real spawner. A deployed runner
 * writes to whatever installation the shell's credentials reach, so a caller
 * that imported `main` and forgot to inject a fake must fail here rather than
 * start one (#619, where a test that did exactly that ran the validator gate
 * against production).
 */
async function refuseToSpawn(name) {
	throw new Error(`accept: main() was called without a runHarness, refusing to start ${name}`);
}

/**
 * @param {string[]} [argv]
 * @param {{ env?: Record<string, string | undefined>, runHarness?: typeof run }} [options]
 */
export async function main(argv = process.argv, { env = process.env, runHarness = refuseToSpawn } = {}) {
	const [name, ...flags] = argv.slice(2);

	if (!name || name === '--list' || name === '--help') {
		list();
		return;
	}

	if (name === 'deployed') {
		if (!await preflightDeployDay(env)) {
			process.exitCode = 1;
			return;
		}
		for (const harness of DEPLOY_DAY) {
			process.stdout.write(`\n▶ accept ${harness} --deployed\n`);
			const code = await runHarness(harness, ['--deployed']);
			if (code !== 0) {
				process.stderr.write(`\n✗ ${harness} failed; later deploy-day harnesses did not run\n`);
				process.exitCode = code;
				return;
			}
		}
		return;
	}

	if (!(name in HARNESSES)) {
		process.stderr.write(`accept: unknown harness "${name}"\n\n`);
		list();
		process.exitCode = 2;
		return;
	}
	if (HARNESSES[name].deployed === false && flags.includes('--deployed')) {
		process.stderr.write(`accept: ${name} has no deployed mode\n`);
		process.exitCode = 2;
		return;
	}

	process.exitCode = await runHarness(name, flags);
}

if (import.meta.main)
	await main(process.argv, { runHarness: run });
