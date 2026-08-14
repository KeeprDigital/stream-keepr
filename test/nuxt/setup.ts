/**
 * Shared setup for every Nuxt-environment suite: the two background singletons
 * that write through `$fetch` are stubbed here so they never reach a suite's
 * `$fetch` mock (#367).
 *
 * The class this retires: 40-odd suites mock `$fetch` module-wide, and the app
 * that boots underneath them runs two writers of its own — `useServerTime`'s
 * clock sync (three `/api/time` samples at 50ms spacing on first consumption,
 * then every 60s) and the realtime plugin's token mint (`/api/realtime/token`
 * on the first Event-scoped subscription). Any unselected count, negative, or
 * positional assertion on such a mock can be shifted by one of those calls
 * landing in its window, and a `mockResolvedValueOnce` queue drained one early
 * turns into failures that name the test's own subject — #367 catalogues five
 * costumes, including the graphics-assets page suite's 1-in-3 `idempotencyKey`
 * TypeError, where no assertion is at fault at all.
 *
 * The fix is at the declaration the writers share, not in each suite: stub the
 * writers once, here, and a suite's mock records only the suite's requests.
 * `test/nuxt/setup.test.ts` holds this file to that contract.
 *
 * Opting back in: a suite that genuinely tests one of the stubbed surfaces
 * takes the stub off in its own file — a test file's registration lands after
 * this setup's and wins. `useServerTime.test.ts` restores the real composable
 * with `vi.unmock('~/composables/core/useServerTime')`, and any suite needing
 * its own Ably shape mocks `'ably'` itself (as
 * `broadcastGraphicsLiveSessionProtocol.test.ts` already does).
 *
 * Both stubs are plain `vi.mock` with a factory that imports nothing, and that
 * is load-bearing rather than style: `mockNuxtImport` appends an eager import
 * of the mocked module to this file, which would instantiate the real module
 * graph during setup — before the suite's own `$fetch` mock registers — and
 * bind the real `$fetch` into it for the rest of the file. A factory that
 * builds its stub from nothing leaves every app module uninstantiated until
 * the suite's mocks are all in place.
 */

import { vi } from 'vitest';
import { readonly, ref } from 'vue';

/**
 * The steady state suites observed before this stub existed: against a mocked
 * `$fetch` every sample failed, so `isSynced` stayed false and the offset
 * stayed zero. Keeping that state means no suite's rendering changes — only
 * the requests stop.
 */
vi.mock('~/composables/core/useServerTime', () => {
	const serverTimeOffset = readonly(ref(0));
	const isSynced = readonly(ref(false));
	const lastSyncedAt = readonly(ref<number | null>(null));

	return {
		useServerTime: () => ({
			serverTimeOffset,
			isSynced,
			lastSyncedAt,
			getServerTime: () => Date.now(),
			sync: async () => {},
			startSync: () => {},
			stopSync: () => {},
		}),
	};
});

/**
 * An Ably that holds still: the realtime plugin runs unchanged, but its client
 * never connects and `authorize()` resolves without invoking the plugin's
 * `authCallback`, so no token is ever fetched. Channels accept subscriptions
 * and presence inertly, which keeps `$realtime`'s API answerable for the
 * suites that reach it.
 */
vi.mock('ably', () => {
	class InertChannel {
		presence = {
			enter: async () => {},
			leave: async () => {},
			get: async () => [],
			subscribe: () => {},
			unsubscribe: () => {},
		};

		subscribe() {}
		unsubscribe() {}
		async detach() {}
	}

	class InertClient {
		auth = { authorize: async () => ({}) };
		connection = {
			id: 'test-connection',
			state: 'initialized',
			on: () => {},
			connect: () => {},
			close: () => {},
		};

		channels = {
			cache: new Map<string, InertChannel>(),
			get(name: string) {
				if (!this.cache.has(name))
					this.cache.set(name, new InertChannel());
				return this.cache.get(name)!;
			},
		};
	}

	return { default: { Realtime: InertClient, Rest: InertClient } };
});
