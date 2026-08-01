/**
 * Static font browser acceptance for unattended Screen Outputs.
 *
 * Proves in a real browser that a static font face finishes loading and then
 * actually renders its own glyphs, and that a face which would silently fall
 * back is refused rather than accepted.
 *
 * Two different things are being proved, and they need different setups:
 *
 * - The browser facts — that Chromium loads WOFF2, WOFF, TTF, and OTF and
 *   renders their glyphs — need no installation, so they run from loopback and
 *   belong in the ordinary test suite. The OTF face lives there: the
 *   installation ships no OTF, and vendoring a proprietary typeface solely to
 *   be downloaded by a test would republish it for no gain.
 * - The library fact — that a font Graphic Asset Revision travels from the
 *   object store through the Worker into a browser and renders — needs a
 *   running installation, because the bundled application fonts are explicitly
 *   outside the Graphics Asset Library and prove nothing about it. `--library`
 *   stages a real font ingestion, lets the page answer the server's own glyph
 *   challenge, and then loads the published revision back through the delivery
 *   route that will serve it on air.
 *
 * Usage: node scripts/run-font-browser-acceptance.mjs [--library] [--deployed]
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
	observeChromiumVerdict,
	serveAcceptanceRoutes,
	verdictFailureCode,
} from './graphics-acceptance/chromium.mjs';
import { runAcceptanceHarness } from './graphics-acceptance/harness.mjs';
import {
	acceptanceOrigin,
	openInstallation,
	stageFontIngestion,
} from './graphics-acceptance/installation.mjs';

const HARNESS = 'static-font-v1';
const ACCEPTANCE_PATH = '/_acceptance/static-font-v1.html';
const MANIFEST_PATH = '/_acceptance/static-font-v1.json';
/** Chromium loads this face, and the static-font-v1 profile accepts it. */
const LIBRARY_FACE = 'public/fonts/mana.woff2';

const deployed = process.argv.includes('--deployed');
// A deployed run always has an installation in front of it, so there would be
// no reason to visit it and skip the one fact only it can prove.
const library = deployed || process.argv.includes('--library');

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

await runAcceptanceHarness({
	harness: HARNESS,
	async run({ record }) {
		// The library face has to be reached from the installation's own origin:
		// its routes are same-origin and cookie-authorized, so a page served from
		// loopback could not read them at all.
		const local = library ? undefined : await serveLocally();
		let staged;
		try {
			let url;
			let sessionUrl;
			if (library) {
				const origin = acceptanceOrigin({ deployed });
				const session = await openInstallation(origin);
				staged = await stageFontIngestion(session, {
					bytes: new Uint8Array(await readFile(fromRepository(LIBRARY_FACE))),
					declaredMime: 'font/woff2',
					sourceFileName: 'acceptance-face.woff2',
				});
				url = `${origin}${ACCEPTANCE_PATH}?operation=${staged.operationId}`;
				// A graphics author session is issued on an ordinary page load, and
				// the library routes need one. Static assets do not pass through the
				// middleware that issues it, so the browser visits the application
				// first, exactly as an operator's browser would.
				sessionUrl = `${origin}/`;
			}
			else {
				url = `${local.origin}${ACCEPTANCE_PATH}`;
			}

			const verdict = await observeChromiumVerdict({ url, sessionUrl });
			record(verdict.outcome === 'passed'
				? []
				: [{ code: verdictFailureCode(verdict), detail: { page: HARNESS } }]);

			return {
				faces: library ? 5 : 4,
				library: library ? 'published' : 'not-exercised',
				mode: deployed ? 'deployed' : 'local',
			};
		}
		finally {
			// The published face is a real asset in a real installation, so it is
			// trashed whether the run passed or failed.
			if (staged)
				await staged.dispose(await staged.publishedAssetId());
			await local?.close();
		}
	},
});
