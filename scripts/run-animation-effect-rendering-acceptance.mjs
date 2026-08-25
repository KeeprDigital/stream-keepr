/**
 * Animation Effect rendering acceptance: every catalogue shader, rasterised.
 *
 * Nothing else in the repository draws a shader. The unit and Nuxt tiers mount
 * effects against a stubbed `three`, which proves the wiring and the params and
 * cannot tell a fragment shader that renders the effect from one that renders
 * black — so a shader edit that compiles and shows nothing on air is green
 * everywhere, exactly as it was through all fifteen slices of #473. Each of
 * those slices rebuilt this proof by hand in a session scratchpad and threw it
 * away; this is that recipe, committed (#499).
 *
 * The run bundles the application's own effect modules, mounts every catalogue
 * effect at its defaults and at named range extremes in unattended Chromium on
 * SwiftShader, and requires each one to compile, light a dark frame, and move
 * between two frames. Two controls hold the run honest: fog, which has rendered
 * on air since the first slice, and a planted broken shader that must fail all
 * three checks — because a proof whose checks have stopped biting passes
 * everything.
 *
 * Usage: node scripts/run-animation-effect-rendering-acceptance.mjs
 */

import process from 'node:process';
import {
	ANIMATION_EFFECT_PROOF_EXPRESSION,
	ANIMATION_EFFECT_PROOF_PAGE_PATH,
	ANIMATION_EFFECT_PROOF_SCRIPT_PATH,
	animationEffectProofPage,
	bundleAnimationEffectPage,
	judgeAnimationEffectReport,
	SWIFTSHADER_ARGS,
} from './graphics-acceptance/animation-effect-proof.mjs';
import { observeChromiumValue, serveAcceptanceRoutes } from './graphics-acceptance/chromium.mjs';
import { runAcceptanceHarness } from './graphics-acceptance/harness.mjs';

const HARNESS = 'animation-effect-v1';

/**
 * Compiling fifteen effects on a software rasteriser is slower than any other
 * page this suite drives, and a scenario that hangs must still end as a named
 * timeout rather than as a run nobody is waiting on. Measured at well under a
 * minute on a laptop; the ceiling is for a loaded CI box.
 */
const MEASUREMENT_TIMEOUT_MS = 300_000;

export async function main(argv = process.argv) {
	// The page is built from this checkout's own sources and served from memory,
	// so unlike the rest of the family there is nothing deployed to point it at:
	// a `--deployed` run would prove a bundle nobody ships.
	const deployed = argv.includes('--deployed');

	await runAcceptanceHarness({
		harness: HARNESS,
		async run({ record }) {
			// Said rather than ignored: an unknown flag that quietly runs something
			// else is how a reader ends up believing a deployed installation was
			// proven by a run that never left this checkout.
			if (deployed) {
				record([{ code: 'harness-precondition-unmet', detail: { reason: 'local-only' } }]);
				return { mode: 'local' };
			}

			const script = await bundleAnimationEffectPage();
			const local = await serveAcceptanceRoutes({
				[ANIMATION_EFFECT_PROOF_PAGE_PATH]: async () => ({
					body: animationEffectProofPage(),
					type: 'text/html; charset=utf-8',
				}),
				[ANIMATION_EFFECT_PROOF_SCRIPT_PATH]: async () => ({
					body: script,
					type: 'text/javascript; charset=utf-8',
				}),
			});
			try {
				const observed = await observeChromiumValue({
					url: `${local.origin}${ANIMATION_EFFECT_PROOF_PAGE_PATH}`,
					expression: ANIMATION_EFFECT_PROOF_EXPRESSION,
					extraArgs: SWIFTSHADER_ARGS,
					timeoutMs: MEASUREMENT_TIMEOUT_MS,
				});
				// Three ways the browser can end without measurements, and they are
				// three different facts: no browser to drive, a page that threw while
				// being read, and a page that never published anything. The last is a
				// timeout rather than a page failure because nothing was observed at
				// all — including whether the page was still working.
				if (observed.outcome !== 'passed') {
					const outcomes = {
						'unavailable': 'browser-driver-unavailable',
						'failed': 'animation-effect-page-failed',
						'timed-out': 'browser-acceptance-timed-out',
					};
					record([{
						code: outcomes[observed.outcome] ?? 'browser-acceptance-failed',
						detail: { page: HARNESS },
					}]);
					return { mode: 'local' };
				}

				// A report that will not parse is the page failing to publish one,
				// which is the same fact as the page failing to finish — and its text
				// is never read, so nothing page-authored reaches the evidence line.
				let report;
				try {
					report = JSON.parse(observed.value);
				}
				catch {
					record([{ code: 'animation-effect-page-failed' }]);
					return { mode: 'local' };
				}

				record(judgeAnimationEffectReport(report));
				return {
					mode: 'local',
					backend: report.backend,
					effects: (report.catalogue ?? []).length,
					scenarios: (report.scenarios ?? []).length,
				};
			}
			finally {
				await local.close();
			}
		},
	});
}

if (import.meta.main)
	await main();
