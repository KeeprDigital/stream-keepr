/**
 * Drops Vue's one-line `<Suspense> is an experimental feature` notice, which
 * every Nuxt-environment file prints when the test-utils entry mounts the app.
 *
 * It is not noise worth keeping, and it is not harmless: Vitest forwards each
 * console line to the main process as a call it awaits, and a file that
 * finishes before a loaded main process answers fails the whole run with
 * `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`
 * though every test passed (vitest-dev/vitest#11153). Short files lose that
 * race under `pnpm verify`, and this notice is usually the only line they log.
 *
 * It has to run before the entry, so `vitest.nuxt.config.ts` puts it first;
 * anything else a file logs still reaches the reporter.
 */
const SUSPENSE_NOTICE = '<Suspense> is an experimental feature and its API will likely change.';

// eslint-disable-next-line no-console -- wraps the method rather than logging
const info = console.info.bind(console);
// eslint-disable-next-line no-console -- wraps the method rather than logging
console.info = (...data: unknown[]) => {
	if (data.length === 1 && data[0] === SUSPENSE_NOTICE)
		return;
	info(...data);
};
