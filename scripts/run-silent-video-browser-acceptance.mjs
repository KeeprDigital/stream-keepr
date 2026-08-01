/**
 * Silent-video browser acceptance for unattended Screen Outputs.
 *
 * Requires each fixture to actually play and seek without a user gesture, and
 * requires VP9 alpha to reach the canvas with its transparency intact — the
 * facts an OBS browser source depends on and that a codec-support query cannot
 * answer.
 *
 * Usage: node scripts/run-silent-video-browser-acceptance.mjs [--deployed]
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { observeChromiumVerdict, serveAcceptanceRoutes } from './graphics-acceptance/chromium.mjs';
import { createAcceptanceEvidence } from './graphics-acceptance/evidence.mjs';
import { acceptanceOrigin } from './graphics-acceptance/installation.mjs';

const HARNESS = 'silent-video-v1';
const ACCEPTANCE_PATH = '/_acceptance/silent-video-v1.html';

const deployed = process.argv.includes('--deployed');
const evidence = createAcceptanceEvidence({ harness: HARNESS });

const local = deployed
	? undefined
	: await serveAcceptanceRoutes({
			[ACCEPTANCE_PATH]: async () => ({
				body: await readFile(new URL(`../public${ACCEPTANCE_PATH}`, import.meta.url)),
				type: 'text/html; charset=utf-8',
			}),
		});
try {
	const origin = deployed ? acceptanceOrigin({ deployed }) : local.origin;
	const verdict = await observeChromiumVerdict({ url: `${origin}${ACCEPTANCE_PATH}` });
	if (verdict.outcome !== 'passed') {
		throw new Error(`${HARNESS} acceptance failed:\n${evidence.report([{
			code: {
				'unavailable': 'browser-driver-unavailable',
				'timed-out': 'browser-acceptance-timed-out',
			}[verdict.outcome] ?? 'browser-acceptance-failed',
			detail: { page: HARNESS },
		}])}`);
	}
	process.stdout.write(`${evidence.passed({
		mode: deployed ? 'deployed' : 'local',
	})}\n`);
}
finally {
	await local?.close();
}
