import type { BroadcastGraphicConfig, MediaGraphicItemConfig } from '~~/shared/types/graphics';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenStore } from '~/stores/screen';

/**
 * The Screen Output route itself — the page a capture browser is pointed at.
 *
 * Every other test of this feature enters below it: the compositor is tested against
 * a render model, and the Broadcast Graphics display against a screen context handed
 * to it directly. Both passed throughout #179's acceptance run, in which the real
 * output rendered a Broadcast Graphic's shapes and text and none of its media (#231).
 * What no test covered was the route composing those parts: reading the Screen Output
 * Asset Capability out of the URL it was opened with, putting it in the screen
 * context, and scaling the canvas the mode registers to the window it was opened in.
 *
 * So this drives the route. It navigates to `/event/42/screen/main`, with and without
 * the capability the product's own copy and open controls put there, against a Screen
 * whose *authored* Broadcast Graphics configuration pins an exact Graphic Asset
 * Revision — the primary path, and the half #231 reported as never wired.
 */

const holder = vi.hoisted(() => ({
	screen: null as unknown,
	presenceData: [] as unknown[],
}));

vi.mock('~/stores/screen', async () => {
	const { reactive } = await import('vue');
	const store = reactive({
		activeScreen: null as unknown,
		screenPresence: new Map(),
		loadScreenBySlug: async () => {
			store.activeScreen = holder.screen;
			return holder.screen;
		},
	});
	return { useScreenStore: () => store };
});

/**
 * The Event already loaded, which is the state an output that navigated here is in.
 *
 * `event.id` has to match the route's or there is no route left to test: the global
 * Event middleware treats a mismatch as an Event switch, tries to load the Event
 * itself, and redirects to `/` when it still has none — taking the page out from
 * under the test. Supplying the loaded Event is what a real navigation to this URL
 * has already done by the time the output page renders.
 */
vi.mock('~/stores/event', () => ({
	useEventStore: () => ({ eventId: 42, event: { id: 42 }, loadEvent: async () => {} }),
}));

vi.mock('~/composables/core/useRealtime', () => {
	const transport = { connectionId: 'connection-1', connectionState: 'connected' };
	return {
		useRealtime: () => transport,
		tryUseRealtime: () => transport,
	};
});

/**
 * The Screen realtime session an output starts, reduced to the one thing this cares
 * about: what the output tells the Screen about itself when it joins presence.
 */
vi.mock('~/composables/screen/useScreenRealtimeSession', () => ({
	useScreenRealtimeSession: (options: {
		getPresenceData: (eventId: number, screenId: number) => unknown;
	}) => ({
		start: async (eventId: number, screenId: number) => {
			holder.presenceData.push(options.getPresenceData(eventId, screenId));
		},
		stop: async () => {},
	}),
}));

const serverNow = 1_700_000_000_000;

mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({
	sessions: new Map([[7, { id: 55, sequence: 1 }]]),
	serverNow: () => serverNow,
	// Everything the Screen publishes is on air: what this test is about is whether a
	// composed graphic's media resolves, not which graphics compose.
	onAirGraphicIds: (_screenId: number, graphics: readonly BroadcastGraphicConfig[]) =>
		graphics.map(graphic => graphic.id),
	animationProjection: () => ({}),
	renderedInputValues: () => ({ current: {}, outgoing: {} }),
	playoutState: () => 'on-air',
	loadSession: () => {},
}));

const wordmark: MediaGraphicItemConfig = {
	type: 'media',
	id: 'wordmark',
	label: 'Brand wordmark',
	visible: true,
	anchor: 'top-left',
	x: 1540,
	y: 40,
	width: 330,
	height: 120,
	asset: { assetId: 'brand-asset' as never, revisionId: 'brand-revision-2' as never },
	mediaKind: 'image',
	fit: 'contain',
	focalPosition: { horizontal: 0.5, vertical: 0.5 },
	opacity: 1,
	playbackRate: 1,
	loop: false,
};

/** The authored stack, exactly as a Screen's stored mode configuration holds it. */
const strip: BroadcastGraphicConfig = {
	id: 'strip',
	name: 'Full-width strip',
	items: [wordmark],
};

function screenWithAuthoredMedia() {
	return {
		id: 7,
		slug: 'main',
		name: 'Program',
		currentMode: 'broadcast-graphics',
		screenConfig: { width: 1920, height: 1080 },
		modeConfigs: { 'broadcast-graphics': { graphics: [strip] } },
	};
}

/** Every request the page made, so an absent capability can be told from an unused one. */
let requests: string[] = [];

async function mountOutputRoute(route: string) {
	const pagePath = '../../../../../../app/pages/event/[eventId]/screen/[screenSlug].vue';
	const { default: ScreenOutputPage } = await import(pagePath);

	const wrapper = await mountSuspended(ScreenOutputPage, { route });
	/*
	 * The Screen load, the mode's display component and the capability session are
	 * three rounds of promises deep, and each one starts only once the one before it
	 * has settled. The display component in particular is reached by a dynamic import
	 * the Screen Mode Definition holds, which resolves on its own schedule rather than
	 * on a microtask — so this waits for the canvas the mode renders rather than
	 * guessing at a number of ticks.
	 */
	for (let round = 0; round < 200 && !wrapper.find('.broadcast-graphics').exists(); round++) {
		await flushPromises();
		await nextTick();
		await new Promise(resolve => setTimeout(resolve, 5));
	}
	await flushPromises();
	await nextTick();
	return wrapper;
}

const capability = 'HG7fQ2mS4kLp9xRt0ZbNvCyE1JdWqUoA3hMi5nTgKrs';

describe('screen output route', () => {
	beforeEach(() => {
		holder.screen = screenWithAuthoredMedia();
		holder.presenceData = [];
		requests = [];
		useScreenStore().activeScreen = null;
		vi.stubGlobal('fetch', vi.fn(async (input: string) => {
			requests.push(String(input));
			return new Response(JSON.stringify({ unplayableRevisions: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		}));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/**
	 * #231's first acceptance criterion, at the route rather than at the delivery API:
	 * an authored image on a graphic that is on air is on the Screen Output.
	 */
	it('renders an authored Media Graphic Item through the capability its URL carries', async () => {
		const wrapper = await mountOutputRoute(
			`/event/42/screen/main#asset-capability=${capability}`,
		);

		expect(wrapper.get('[data-graphic-item-kind="media"] img').attributes('src')).toBe(
			'/api/screen-output/screens/7/assets/brand-asset/revisions/brand-revision-2/content',
		);
		expect(requests).toEqual(['/api/screen-output/screens/7/asset-capability-session']);
		expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
			method: 'POST',
			headers: { authorization: `Bearer ${capability}` },
		});
	});

	/**
	 * The other side of it, so the test above is the capability doing the work rather
	 * than media rendering whatever the URL says.
	 *
	 * This is the state #179 found the real output in, and the reason it took an
	 * acceptance run to find: the page loads, the Screen composes, every Shape and Text
	 * on air renders, and the image is absent with nothing to say so.
	 */
	it('renders no media at all, and opens no session, without a capability', async () => {
		const wrapper = await mountOutputRoute('/event/42/screen/main');

		expect(wrapper.find('[data-graphic-item-kind="media"]').exists()).toBe(true);
		expect(wrapper.find('[data-graphic-item-kind="media"] img').exists()).toBe(false);
		expect(requests).toEqual([]);
	});

	/**
	 * And it says so where an operator can see it, which is the whole of what an output
	 * without media can do about it: it cannot fetch a capability of its own without
	 * making the capability's revocation meaningless, and it must not paint a
	 * diagnostic onto program.
	 */
	it('reports its asset access to the Screen when it joins presence', async () => {
		await mountOutputRoute(`/event/42/screen/main#asset-capability=${capability}`);
		expect(holder.presenceData).toEqual([expect.objectContaining({ assetAccess: 'granted' })]);

		holder.presenceData = [];
		await mountOutputRoute('/event/42/screen/main');
		expect(holder.presenceData).toEqual([expect.objectContaining({ assetAccess: 'absent' })]);
	});

	/**
	 * #232, at the size of the window the output is actually open in.
	 *
	 * The environment's window is 1024×768 and the canvas is 1920×1080, so width
	 * decides the scale and the leftover height is split above and below. Before this,
	 * the output rendered the canvas at native size and clipped it: everything past
	 * x=1024 and y=768 was simply not on the page, and nothing scrolled to it.
	 */
	it('scales the canvas uniformly to fit the window it is opened in', async () => {
		const wrapper = await mountOutputRoute('/event/42/screen/main');

		const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
		expect(scale).toBeLessThan(1);
		expect(wrapper.get('.screen-renderer').attributes('style')).toContain(
			`transform: translate(0px, ${(window.innerHeight - 1080 * scale) / 2}px) scale(${scale})`,
		);
	});
});
