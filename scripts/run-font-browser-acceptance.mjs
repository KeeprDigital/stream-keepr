/**
 * Static font browser acceptance for unattended Screen Outputs.
 *
 * Proves in a real browser that every static font face the installation
 * serves finishes loading and then actually renders its own glyphs, and that
 * a face which would silently fall back is refused rather than accepted.
 *
 * Local mode serves the page and every face from loopback, which is where the
 * OTF face lives: the installation ships TTF, WOFF, and WOFF2 in its public
 * assets, and vendoring a fourth font solely to be downloaded by a test would
 * republish a typeface for no gain. Deployed mode runs the same page against
 * the installation's own assets, over its own delivery path.
 *
 * Usage: node scripts/run-font-browser-acceptance.mjs [--deployed]
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { observeChromiumVerdict, serveAcceptanceRoutes } from './graphics-acceptance/chromium.mjs';
import { createAcceptanceEvidence } from './graphics-acceptance/evidence.mjs';
import { acceptanceOrigin } from './graphics-acceptance/installation.mjs';

const HARNESS = 'static-font-v1';
const ACCEPTANCE_PATH = '/_acceptance/static-font-v1.html';
const MANIFEST_PATH = '/_acceptance/static-font-v1.json';

const deployed = process.argv.includes('--deployed');
const evidence = createAcceptanceEvidence({ harness: HARNESS });

const fromRepository = path => new URL(`../${path}`, import.meta.url);

/**
 * The local manifest is the committed one plus the OTF face, so a local run
 * covers the whole static-font-v1 compatibility profile.
 */
async function localManifest() {
	const committed = JSON.parse(await readFile(fromRepository(`public${MANIFEST_PATH}`), 'utf8'));
	return {
		...committed,
		faces: [
			...committed.faces,
			{ format: 'otf', url: '/_acceptance/fonts/otf-face', codePoint: 48 },
		],
	};
}

async function serveLocally() {
	const manifest = await localManifest();
	const file = async (path, type) => ({ body: await readFile(fromRepository(path)), type });
	return await serveAcceptanceRoutes({
		[ACCEPTANCE_PATH]: () => file(`public${ACCEPTANCE_PATH}`, 'text/html; charset=utf-8'),
		[MANIFEST_PATH]: async () => ({ body: JSON.stringify(manifest), type: 'application/json' }),
		'/fonts/mana.ttf': () => file('public/fonts/mana.ttf', 'font/ttf'),
		'/fonts/mplantin.woff': () => file('public/fonts/mplantin.woff', 'font/woff'),
		'/fonts/mana.woff2': () => file('public/fonts/mana.woff2', 'font/woff2'),
		'/_acceptance/fonts/otf-face': () =>
			file('node_modules/mana-font/docs/fonts/beleren.otf', 'font/otf'),
	});
}

const local = deployed ? undefined : await serveLocally();
try {
	const origin = deployed ? acceptanceOrigin({ deployed }) : local.origin;
	const verdict = await observeChromiumVerdict({ url: `${origin}${ACCEPTANCE_PATH}` });

	if (verdict.outcome === 'unavailable') {
		throw new Error(`${HARNESS} acceptance failed:\n${evidence.report([
			{ code: 'browser-driver-unavailable', detail: { driver: 'chromium' } },
		])}`);
	}
	if (verdict.outcome === 'timed-out') {
		throw new Error(`${HARNESS} acceptance failed:\n${evidence.report([
			{ code: 'browser-acceptance-timed-out', detail: { page: 'static-font-v1' } },
		])}`);
	}
	if (verdict.outcome === 'failed') {
		// The page names the stable code; the harness refuses to invent one for
		// a page that reported something the registry does not contain.
		throw new Error(`${HARNESS} acceptance failed:\n${evidence.report([
			{ code: verdict.code || 'browser-acceptance-failed', detail: { page: 'static-font-v1' } },
		])}`);
	}
	process.stdout.write(`${evidence.passed({
		faces: deployed ? 3 : 4,
		mode: deployed ? 'deployed' : 'local',
	})}\n`);
}
finally {
	await local?.close();
}
