/**
 * Fails the Nuxt test that renders an icon the test client bundle lacks, with
 * the icon's name, instead of letting `@nuxt/icon` log it (#779).
 *
 * In tests `@nuxt/icon` has `provider: 'none'` and a scanned client bundle
 * (`nuxt.config.ts`). For a name outside the bundle its `loadIcon` falls through
 * to Iconify's `loadIcon`, which rejects a tick or more later, and the catch
 * logs `[Icon] failed to load icon` via `console.warn`. That line is hidden by
 * `silent: 'passed-only'`, may land in a later test, and under load lands at
 * worker teardown as `EnvironmentTeardownError: Closing rpc while
 * "onUserConsoleLog" was pending`, blamed on whatever file was running
 * (#766, vitest-dev/vitest#11153).
 *
 * The guard sits at that fall-through. `@nuxt/icon` calls Iconify's `loadIcon`
 * only after its own lookup of the bundle missed, and synchronously while the
 * icon renders, so the stand-in below records the name in the test that
 * rendered it and resolves without an icon: nothing rejects, nothing logs.
 * The `afterEach` here then fails that test, naming every unbundled icon; an
 * `afterAll` catches one rendered outside any test. Watching `console.warn`
 * instead would see the failure only after the rejection settles, which is
 * the late, misattributed signal this replaces.
 *
 * `vitest.nuxt.config.ts` runs this before the test-utils entry, so the mock
 * is in place before the app first imports `@nuxt/icon`.
 */

import { afterAll, afterEach, expect, vi } from 'vitest';

const unbundled: string[] = [];

vi.mock('@iconify/vue', async (importOriginal) => {
	const iconify = await importOriginal<typeof import('@iconify/vue')>();

	return {
		...iconify,
		loadIcon: (name: string) => {
			const test = expect.getState().currentTestName;
			unbundled.push(test ? `\`${name}\` (rendered in "${test}")` : `\`${name}\``);
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
	const icons = unbundled.splice(0).join(', ');
	throw new Error(
		`Icon not in the test client bundle: ${icons}. Name it where `
		+ '`clientBundle.scan` in nuxt.config.ts can find it, or add it to `clientBundle.icons`.',
	);
}

afterEach(() => assertEveryIconBundled());
afterAll(() => assertEveryIconBundled());
