/**
 * Key matte rendering acceptance: every glow host, rasterised in both outputs.
 *
 * The render-model suites prove what each element is told to paint in the Key
 * Output; only a browser shows what that paint composites to. The run bundles
 * the application's own render models, draws a half-opaque glow on each host —
 * a Graphic Item, a Feature Match Overlay Source Item, and the Frame — as the
 * Overlay Output and as the Key Output in unattended Chromium, and requires the
 * Key matte to equal the Overlay alpha (and so the Fill Output it keys), the
 * glow to be grey in it, and the matte to be grayscale. A planted Source Item
 * whose Key Output withholds its glow — every Feature Match Overlay Key Output
 * before #599 — must fail, because a proof that cannot see a missing glow
 * passes everything.
 *
 * Usage: node scripts/run-key-matte-rendering-acceptance.mjs
 */

import process from 'node:process';
import { serveAcceptanceRoutes, withChromiumPage } from './graphics-acceptance/chromium.mjs';
import { runAcceptanceHarness } from './graphics-acceptance/harness.mjs';
import {
	bundleKeyMattePage,
	judgeKeyMatteReport,
	KEY_MATTE_PROOF_PAGE_PATH,
	KEY_MATTE_PROOF_SCRIPT_PATH,
	keyMatteProofPage,
	observeKeyMatte,
} from './graphics-acceptance/key-matte-proof.mjs';

const HARNESS = 'key-matte-v1';

export async function main(argv = process.argv) {
	// Built from this checkout's sources and served from memory, so there is
	// nothing deployed to point it at.
	const deployed = argv.includes('--deployed');

	await runAcceptanceHarness({
		harness: HARNESS,
		async run({ record }) {
			if (deployed) {
				record([
					{
						code: 'harness-precondition-unmet',
						detail: { reason: 'local-only' },
					},
				]);
				return { mode: 'local' };
			}

			const script = await bundleKeyMattePage();
			const local = await serveAcceptanceRoutes({
				[KEY_MATTE_PROOF_PAGE_PATH]: async () => ({
					body: keyMatteProofPage(),
					type: 'text/html; charset=utf-8',
				}),
				[KEY_MATTE_PROOF_SCRIPT_PATH]: async () => ({ body: script, type: 'text/javascript; charset=utf-8' }),
			});
			try {
				// A page that throws mid-run raises its own code from inside the
				// observation; what is left is no browser to drive, or a page that
				// never said it was ready.
				const observed = await withChromiumPage(
					{ url: `${local.origin}${KEY_MATTE_PROOF_PAGE_PATH}` },
					page => observeKeyMatte(page),
				);
				if (observed.outcome !== 'passed') {
					const outcomes = {
						'unavailable': 'browser-driver-unavailable',
						'timed-out': 'browser-acceptance-timed-out',
					};
					record([
						{
							code: outcomes[observed.outcome] ?? 'browser-acceptance-failed',
							detail: { page: HARNESS },
						},
					]);
					return { mode: 'local' };
				}

				// A report that will not parse is the page failing to publish one; its
				// text is never read, so nothing page-authored reaches the evidence line.
				let report;
				try {
					report = JSON.parse(observed.value);
				}
				catch {
					record([
						{ code: 'key-matte-page-failed' },
					]);
					return { mode: 'local' };
				}

				record(judgeKeyMatteReport(report));
				return { mode: 'local', scenes: (report.scenes ?? []).length };
			}
			finally {
				await local.close();
			}
		},
	});
}

if (import.meta.main)
	await main();
