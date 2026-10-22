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
 * Its reach is `@nuxt/icon`'s default css mode, the only one the app uses. An
 * svg-mode icon (`mode="svg"`) loads through Iconify's own component, which
 * never calls the exported `loadIcon`: unbundled, it renders blank and logs
 * nothing, so it escapes this guard but cannot cause the teardown error.
 * Attribution is to the test running when the icon first renders; a re-render
 * that lands after its test ended is pinned on the next one.
 *
 * `vitest.nuxt.config.ts` runs this before the test-utils entry, so the mock
 * is in place before the app first imports `@nuxt/icon`.
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
		.map(({ name, testName }) => testName ? `\`${name}\` (rendered in "${testName}")` : `\`${name}\``)
		.join(', ');
	throw new Error(
		`Icon not in the test client bundle: ${icons}. Name it where `
		+ '`clientBundle.scan` in nuxt.config.ts can find it, or add it to `clientBundle.icons`.',
	);
}

afterEach(() => assertEveryIconBundled());
afterAll(() => assertEveryIconBundled());
