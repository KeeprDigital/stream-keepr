/**
 * Bundle a browser-half acceptance page from the application's own sources.
 *
 * The bundle is what makes a rendering proof a proof of the shipped code rather
 * than of a copy of it: the entry imports application modules exactly as a Screen
 * Output does. esbuild is the whole toolchain, because the alternative is
 * standing up Nuxt to serve a test page.
 */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { AcceptanceFailure } from './evidence.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * @param {URL} entry The page module, beside its proof.
 * @param {string} failureCode The evidence code a bundle that will not build reports.
 */
export async function bundleAcceptancePage(entry, failureCode) {
	const built = await build({
		entryPoints: [fileURLToPath(entry)],
		bundle: true,
		write: false,
		format: 'iife',
		platform: 'browser',
		// The browser is the one the run launches, so the output only has to
		// parse there and nothing is transpiled down for older engines.
		target: 'chrome120',
		alias: { '~~': repositoryRoot, '~': `${repositoryRoot}app` },
		logLevel: 'silent',
	}).catch(() => {
		throw new AcceptanceFailure(failureCode);
	});
	const [output] = built.outputFiles ?? [];
	if (!output)
		throw new AcceptanceFailure(failureCode);
	return output.text;
}
