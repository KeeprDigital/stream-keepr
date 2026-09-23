/**
 * Browser-page acceptance for unattended Screen Outputs: still images and
 * silent video.
 *
 * Each page is a self-judging fixture under `public/_acceptance/`, driven in a
 * real browser because a capability query is not evidence:
 *
 * - `still-images`: a MIME-level check cannot show that a Screen Output can
 *   show an image, so each fixture must decode through both
 *   `createImageBitmap` and `HTMLImageElement`.
 * - `silent-video`: each fixture must actually play and seek without a user
 *   gesture, and VP9 alpha must reach the canvas with its transparency intact —
 *   the facts an OBS browser source depends on and that a codec-support query
 *   cannot answer.
 *
 * Usage: node scripts/run-browser-page-acceptance.mjs <still-images|silent-video> [--deployed]
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

/** Page name → the harness id it runs under and the fixture page it drives. */
export const PAGES = {
	'still-images': { harness: 'still-image-v1', path: '/_acceptance/still-image-v1.html' },
	'silent-video': { harness: 'silent-video-v1', path: '/_acceptance/silent-video-v1.html' },
};

export async function main(argv = process.argv) {
	const name = argv[2];
	const page = PAGES[name];
	if (!page)
		throw new Error(`run-browser-page-acceptance: expected one of ${Object.keys(PAGES).join(', ')}, got ${name ?? 'nothing'}`);
	const deployed = argv.includes('--deployed');

	await runAcceptanceHarness({
		harness: page.harness,
		async run({ record }) {
			const local = deployed
				? undefined
				: await serveAcceptanceRoutes({
						[page.path]: async () => ({
							body: await readFile(new URL(`../public${page.path}`, import.meta.url)),
							type: 'text/html; charset=utf-8',
						}),
					});
			try {
				const origin = deployed ? acceptanceOrigin({ deployed }) : local.origin;
				const verdict = await observeChromiumVerdict({ url: `${origin}${page.path}` });
				record(verdict.outcome === 'passed'
					? []
					: [{ code: verdictFailureCode(verdict), detail: { page: page.harness } }]);
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
