/**
 * The Node half of the Key matte rendering proof: what the browser is given,
 * how the two outputs are captured, and what the measurements are worth.
 *
 * As in the Animation Effect proof, the page measures and this file judges:
 * `judgeKeyMatteReport` is a pure function over numbers, so a page that drew
 * nothing cannot talk itself into a pass.
 */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { AcceptanceFailure } from './evidence.mjs';
import {
	KEY_MATTE_PROOF_CONTROL,
	KEY_MATTE_PROOF_FLOORS,
	KEY_MATTE_PROOF_HOSTS,
	KEY_MATTE_PROOF_SCENE,
	KEY_MATTE_PROOF_SCENES,
} from './key-matte-scenarios.mjs';

export const KEY_MATTE_PROOF_PAGE_PATH = '/_acceptance/key-matte-v1.html';
export const KEY_MATTE_PROOF_SCRIPT_PATH = '/_acceptance/key-matte-v1.js';

/** The captured area: every scene, side by side. */
export const KEY_MATTE_PROOF_VIEWPORT = Object.freeze({
	width: KEY_MATTE_PROOF_SCENE.width * KEY_MATTE_PROOF_SCENES.length,
	height: KEY_MATTE_PROOF_SCENE.height,
});

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Bundle the page from the application's own render models, so the paint
 * measured is the paint a Screen Output draws: a change to
 * `~/modules/screen/outputPaint.ts` or either render model is what this run
 * rasterises.
 */
export async function bundleKeyMattePage() {
	const built = await build({
		entryPoints: [fileURLToPath(new URL('./key-matte-page.mjs', import.meta.url))],
		bundle: true,
		write: false,
		format: 'iife',
		platform: 'browser',
		target: 'chrome120',
		alias: { '~~': repositoryRoot, '~': `${repositoryRoot}app` },
		logLevel: 'silent',
	}).catch(() => {
		throw new AcceptanceFailure('key-matte-bundle-failed');
	});
	const [output] = built.outputFiles ?? [];
	if (!output)
		throw new AcceptanceFailure('key-matte-bundle-failed');
	return output.text;
}

/** A transparent page, so the Overlay Output's screenshot keeps its alpha. */
export function keyMatteProofPage() {
	const { width, height } = KEY_MATTE_PROOF_VIEWPORT;
	return `<!doctype html>
<meta charset="utf-8">
<title>key-matte-v1</title>
<style>
	html, body { margin: 0; background: transparent; }
	#scenes { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }
</style>
<body>
	<div id="scenes"></div>
	<script src="${KEY_MATTE_PROOF_SCRIPT_PATH}"></script>
</body>
`;
}

async function evaluate(page, expression) {
	const evaluated = await page.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
	if (evaluated.exceptionDetails)
		throw new AcceptanceFailure('key-matte-page-failed');
	return evaluated.result?.value;
}

/**
 * Draw every scene as the Overlay Output and then as the Key Output, screenshot
 * each, and have the page measure the pair.
 *
 * The screenshots are the compositor's own pixels: a CSS filter or an SVG filter
 * is only evidence once Chromium has painted it. The default background is made
 * transparent so the Overlay capture carries the alpha the Key Output must equal.
 */
export async function observeKeyMatte(page, { timeoutMs = 30_000 } = {}) {
	const { width, height } = KEY_MATTE_PROOF_VIEWPORT;
	await page.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
	await page.command('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

	const deadline = Date.now() + timeoutMs;
	while (await evaluate(page, `document.body?.dataset.ready === 'true'`) !== true) {
		if (Date.now() > deadline)
			return { outcome: 'timed-out' };
		await new Promise(resolve => setTimeout(resolve, 100));
	}

	const captures = {};
	for (const output of ['overlay', 'key']) {
		await evaluate(page, `window.keyMatteProof.render(${JSON.stringify(output)})`);
		const shot = await page.command('Page.captureScreenshot', {
			format: 'png',
			clip: { x: 0, y: 0, width, height, scale: 1 },
			fromSurface: true,
		});
		captures[output] = shot.data;
	}
	const report = await evaluate(
		page,
		`window.keyMatteProof.measure(${JSON.stringify(captures.overlay)}, ${JSON.stringify(captures.key)})`,
	);
	return { outcome: 'passed', value: report };
}

/**
 * What one scene must show: its Key Output is the Overlay Output's alpha, a
 * half-opaque glow is grey in it, and nothing in it carries colour.
 */
export function judgeKeyMatteScene(scene, floors = KEY_MATTE_PROOF_FLOORS) {
	const failures = [];
	if (!(scene.maxMatteError <= floors.maxMatteError))
		failures.push({ code: 'key-matte-diverges-from-fill', detail: { scene: scene.name, measured: scene.maxMatteError } });
	if (!(scene.greyPixels >= floors.minGreyPixels))
		failures.push({ code: 'key-matte-glow-not-grey', detail: { scene: scene.name, measured: scene.greyPixels } });
	if (!(scene.maxChroma <= floors.maxChroma))
		failures.push({ code: 'key-matte-not-greyscale', detail: { scene: scene.name, measured: scene.maxChroma } });
	return failures;
}

/**
 * The whole run: every host scene present and passing, and the planted control
 * failing the matte check. A control that passes means the comparison cannot
 * see a glow missing from the Key Output, and then no pass means anything.
 */
export function judgeKeyMatteReport(report) {
	const scenes = new Map((report?.scenes ?? []).map(scene => [scene.name, scene]));
	const failures = [];
	for (const name of KEY_MATTE_PROOF_HOSTS) {
		const scene = scenes.get(name);
		if (!scene)
			failures.push({ code: 'key-matte-scene-missing', detail: { scene: name } });
		else
			failures.push(...judgeKeyMatteScene(scene));
	}
	const control = scenes.get(KEY_MATTE_PROOF_CONTROL);
	if (!control)
		failures.push({ code: 'key-matte-scene-missing', detail: { scene: KEY_MATTE_PROOF_CONTROL } });
	else if (!judgeKeyMatteScene(control).some(failure => failure.code === 'key-matte-diverges-from-fill'))
		failures.push({ code: 'key-matte-checks-not-biting', detail: { scene: KEY_MATTE_PROOF_CONTROL } });
	return failures;
}
