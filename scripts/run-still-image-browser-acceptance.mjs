/**
 * Still-image browser acceptance for unattended Screen Outputs.
 *
 * A MIME-level capability check is not evidence that a Screen Output can show
 * an image, so this drives a real browser and requires each fixture to decode
 * through both `createImageBitmap` and `HTMLImageElement`.
 *
 * Usage: node scripts/run-still-image-browser-acceptance.mjs [--deployed]
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
	observeChromiumVerdict,
	serveAcceptanceRoutes,
	verdictFailureCode,
} from './graphics-acceptance/chromium.mjs';
import { runAcceptanceHarness } from './graphics-acceptance/harness.mjs';
import { acceptanceOrigin } from './graphics-acceptance/installation.mjs';

const HARNESS = 'still-image-v1';
const ACCEPTANCE_PATH = '/_acceptance/still-image-v1.html';

export async function main(argv = process.argv) {
	const deployed = argv.includes('--deployed');

	await runAcceptanceHarness({
		harness: HARNESS,
		async run({ record }) {
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
				record(verdict.outcome === 'passed'
					? []
					: [{ code: verdictFailureCode(verdict), detail: { page: HARNESS } }]);
				return { mode: deployed ? 'deployed' : 'local' };
			}
			finally {
				await local?.close();
			}
		},
	});
}

if (import.meta.main)
	await main();
