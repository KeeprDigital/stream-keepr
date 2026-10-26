/**
 * Fails the Nuxt test that renders an icon the test client bundle lacks, naming it,
 * instead of letting `@nuxt/icon` log it late (#779). A late `[Icon] failed to load
 * icon` warning is hidden by `silent: 'passed-only'` and, under load, surfaces as a
 * misattributed `EnvironmentTeardownError` (#766, vitest-dev/vitest#11153).
 *
 * `@nuxt/icon` falls through to Iconify's `loadIcon` only when its bundle lookup
 * misses, synchronously while rendering, so the stand-in below records the name in
 * the test that rendered it and resolves without an icon. css mode only: an
 * unbundled `mode="svg"` icon renders blank and logs nothing. `vitest.nuxt.config.ts`
 * runs this before the test-utils entry, so the mock precedes `@nuxt/icon`.
 */

import { afterAll, afterEach, expect, vi } from 'vitest';

/** Each icon that missed the bundle, with the test it rendered in, if any. */
const unbundled: { name: string; testName: string | undefined }[] = [];

vi.mock('@iconify/vue', async (importOriginal) => {
	const iconify = await importOriginal<typeof import('@iconify/vue')>();

	return {
		...iconify,
		loadIcon: (name: string) => {
			unbundled.push({ name, testName: expect.getState().currentTestName });
			return Promise.resolve(null);
		},
	};
});

/**
 * Throws naming every icon rendered outside the test client bundle since the
 * last call, and forgets them. Exported so the guard's own test can prove it.
 */
export function assertEveryIconBundled(): void {
	if (unbundled.length === 0)
		return;
	const icons = unbundled.splice(0)
		.map(({ name, testName }) => testName
			? `\`${name}\` (rendered in "${testName}")`
			: `\`${name}\``)
		.join(', ');
	throw new Error(
		`Icon not in the test client bundle: ${icons}. Name it where `
		+ '`clientBundle.scan` in nuxt.config.ts can find it, or add it to `clientBundle.icons`.',
	);
}

afterEach(() => assertEveryIconBundled());
afterAll(() => assertEveryIconBundled());
