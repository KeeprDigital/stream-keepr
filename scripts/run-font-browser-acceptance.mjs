/**
 * Static font browser acceptance for unattended Screen Outputs.
 *
 * Proves in a real browser that a static font face finishes loading and then
 * actually renders its own glyphs, and that a face which would silently fall
 * back is refused rather than accepted.
 *
 * It also proves the converse, which nothing else can: every face the
 * `static-font-v1` profile rejects for a sanitiser-level defect is refused by
 * this browser too. A unit test can only show the server-side check fires on the
 * bytes it was written for; whether those bytes are genuinely unloadable is a
 * fact about the browser, so `refusedFaces` in the manifest is checked here
 * (#153).
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
import {
	macintoshCmapLanguage,
	withCmapLanguages,
} from './graphics-acceptance/font-cmap-variants.mjs';
import { runAcceptanceHarness } from './graphics-acceptance/harness.mjs';
import {
	acceptanceOrigin,
	authoredPageRequest,
	openInstallation,
	stageFontIngestion,
} from './graphics-acceptance/installation.mjs';

const HARNESS = 'static-font-v1';
const ACCEPTANCE_PATH = '/_acceptance/static-font-v1.html';
const MANIFEST_PATH = '/_acceptance/static-font-v1.json';
/** Chromium loads this face, and the static-font-v1 profile accepts it. */
const LIBRARY_FACE = 'public/fonts/mana.woff2';

const fromRepository = path => new URL(`../${path}`, import.meta.url);

/**
 * `public/fonts/mplantin.ttf` with its cmap subtable languages restated.
 *
 * The restating itself lives in `graphics-acceptance/font-cmap-variants.mjs`,
 * shared with the `static-font-v1` unit tests so both sides build byte-identical
 * faces from one implementation. That identity is the whole point of the pairing:
 * the profile accepts these exact bytes server-side and this run loads them in a
 * browser, and two copies of the builder would let those drift apart without
 * anything failing (#153).
 *
 * Built here rather than committed for the same reason the OTF face is not
 * vendored: it exists only to be loaded by this run, and a synthetic font in
 * `public/` would be a shipped asset nothing serves.
 */
async function cmapLanguageVariant(languageForPlatform) {
	return withCmapLanguages(
		new Uint8Array(await readFile(fromRepository('public/fonts/mplantin.ttf'))),
		languageForPlatform,
	);
}

/**
 * The local manifest is the committed one plus two faces a local run can build
 * for itself, so a local run covers the whole static-font-v1 compatibility
 * profile and both sides of its cmap-language rule.
 *
 * The Macintosh-language face is the one that matters. The profile permits a
 * non-zero `language` on that platform, because OpenType defines it there as the
 * Mac language ID plus one — and the bundled face is refused by a rule with or
 * without that exemption, so nothing committed can tell the two apart. This face
 * can: it is exactly the bundled one with its Microsoft subtable's language
 * zeroed, and requiring it to load *and render* is what stops the rule quietly
 * widening back into a false positive (#153).
 */
async function localManifest() {
	const committed = JSON.parse(await readFile(fromRepository(`public${MANIFEST_PATH}`), 'utf8'));
	return {
		...committed,
		faces: [
			...committed.faces,
			{ format: 'otf', url: '/_acceptance/fonts/otf-face', codePoint: 48 },
			{ format: 'ttf', url: '/_acceptance/fonts/mac-cmap-language-face', codePoint: 48 },
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
		// Served to be refused: the profile rejects these bytes, and this run is what
		// proves the browser does too (#153).
		'/fonts/mplantin.ttf': () => file('public/fonts/mplantin.ttf', 'font/ttf'),
		'/fonts/mana.woff2': () => file('public/fonts/mana.woff2', 'font/woff2'),
		'/_acceptance/fonts/otf-face': () =>
			file('node_modules/mana-font/docs/fonts/beleren.otf', 'font/otf'),
		'/_acceptance/fonts/mac-cmap-language-face': async () => ({
			body: await cmapLanguageVariant(macintoshCmapLanguage),
			type: 'font/ttf',
		}),
	});
}

export async function main(argv = process.argv) {
	const deployed = argv.includes('--deployed');
	// A deployed run always has an installation in front of it, so there would be
	// no reason to visit it and skip the one fact only it can prove.
	const library = deployed || argv.includes('--library');

	await runAcceptanceHarness({
		harness: HARNESS,
		async run({ evidence, record }) {
			// The library face has to be reached from the installation's own origin:
			// its routes are same-origin and cookie-authorized, so a page served from
			// loopback could not read them at all.
			const local = library ? undefined : await serveLocally();
			let staged;
			try {
				let page;
				if (library) {
					const origin = acceptanceOrigin({ deployed });
					const session = await openInstallation(origin);
					// The session travels to a browser from here on, so it is registered
					// before anything else can print it, exactly as the three sibling
					// harnesses register theirs (#276).
					evidence.addSecret(session.authorCookie);
					staged = await stageFontIngestion(session, {
						bytes: new Uint8Array(await readFile(fromRepository(LIBRARY_FACE))),
						declaredMime: 'font/woff2',
						sourceFileName: 'acceptance-face.woff2',
					});
					// One expression, because the page and the identity it reads as are one
					// fact: the operation staged above is a 404 to every session but this
					// one (ADR-0003, #276).
					page = authoredPageRequest(session, `${origin}${ACCEPTANCE_PATH}?operation=${staged.operationId}`);
				}
				else {
					// Nothing to be the author of: the loopback run reads no library route.
					page = { url: `${local.origin}${ACCEPTANCE_PATH}` };
				}

				const verdict = await observeChromiumVerdict(page);
				record(verdict.outcome === 'passed'
					? []
					: [{ code: verdictFailureCode(verdict), detail: { page: HARNESS } }]);

				return {
					faces: library ? 6 : 5,
					refusedFaces: 1,
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
}

if (import.meta.main)
	await main();
