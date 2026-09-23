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
		proves: 'Every Animation Effect shader compiles, lights a frame, and moves',
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
	'safari-vp9-alpha': {
		script: ['run-safari-vp9-alpha-acceptance.mjs'],
		proves: 'A Screen Output refuses Safari a VP9-alpha revision while its session opens',
		needs: 'Safari automation (README § Safari automation)',
		flags: '--allow-manual',
	},
};

/** README § Deploy day, step 5, in order. */
export const DEPLOY_DAY = [
	'silent-video-validator',
	'graphics-delivery',
	'still-images',
	'silent-video',
	'fonts',
	'safari-vp9-alpha',
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

export async function main(argv = process.argv) {
	const [name, ...flags] = argv.slice(2);

	if (!name || name === '--list' || name === '--help') {
		list();
		return;
	}

	if (name === 'deployed') {
		for (const harness of DEPLOY_DAY) {
			process.stdout.write(`\n▶ accept ${harness} --deployed\n`);
			const code = await run(harness, ['--deployed']);
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

	process.exitCode = await run(name, flags);
}

if (import.meta.main)
	await main();
