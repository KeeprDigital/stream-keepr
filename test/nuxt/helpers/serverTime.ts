import type { Ref } from 'vue';
import { ref } from 'vue';

interface FakeServerTime {
	isSynced: Ref<boolean>;
	serverTimeOffset: Ref<number>;
	getServerTime: () => number;
	deviceDelayFor: (serverMs: number) => number;
}

/**
 * A `useServerTime` stand-in for a suite that reads the shared clock: synced at
 * an offset of zero, server time the (faked) device clock's, with no correction
 * being eased in. A suite that moves any of these answers its own from `own`,
 * which is asked on first use, once the suite's own state exists. Loaded from
 * inside a `mockNuxtImport` factory, which is hoisted above the suite's imports:
 *
 *     mockNuxtImport('useServerTime', async () => (await import('~~/test/nuxt/helpers/serverTime')).fakeServerTime());
 */
export function fakeServerTime(own: () => Partial<FakeServerTime> = () => ({})) {
	let serverTime: FakeServerTime | undefined;
	return () => serverTime ??= {
		isSynced: ref(true),
		serverTimeOffset: ref(0),
		getServerTime: () => Date.now(),
		deviceDelayFor: serverMs => serverMs,
		...own(),
	};
}
