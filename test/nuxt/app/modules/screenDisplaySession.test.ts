import type { ScreenDisplaySession } from '~/modules/screen/displaySession';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive } from 'vue';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { useScreenDisplaySession } from '~/modules/screen/displaySession';

function flushPromises() {
	return new Promise(resolve => setTimeout(resolve, 0));
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

function createRoute(query: Record<string, unknown> = {}, hash = '') {
	return reactive({
		params: {
			eventId: '42',
			screenSlug: 'main',
		},
		query,
		hash,
	}) as any;
}

function sizedElement(width: number, height: number) {
	const element = document.createElement('div');
	Object.defineProperty(element, 'offsetWidth', { value: width });
	Object.defineProperty(element, 'offsetHeight', { value: height });
	return element;
}

function createHarness(options: {
	route?: ReturnType<typeof createRoute>;
	eventId?: number | null;
	query?: Record<string, unknown>;
	screens?: Record<string, ReturnType<typeof createMockScreen>>;
	exportElementPng?: ReturnType<typeof vi.fn>;
	setupSession?: (session: ScreenDisplaySession) => void;
} = {}) {
	const route = options.route ?? createRoute(options.query);
	const screens = options.screens ?? {
		main: createMockScreen({ id: 7, slug: 'main' }),
		second: createMockScreen({ id: 8, slug: 'second' }),
	};
	const order: string[] = [];
	const screenStore = reactive({
		activeScreen: null as ReturnType<typeof createMockScreen> | null,
		loadScreenBySlug: vi.fn(async (_eventId: number, slug: string) => {
			order.push(`load:${slug}`);
			screenStore.activeScreen = null;
			const screen = screens[slug];
			if (!screen)
				throw new Error('Screen not found');
			screenStore.activeScreen = screen;
			return screen;
		}),
		// The non-blanking read a resync uses: it never empties `activeScreen`,
		// because the output taking it is on program (#307).
		refreshActiveScreen: vi.fn(async (_eventId: number, slug: string) => {
			order.push(`refresh:${slug}`);
			const screen = screens[slug];
			if (!screen)
				return null;
			screenStore.activeScreen = screen;
			return screen;
		}),
	});
	const eventStore = reactive({
		eventId: options.eventId ?? null,
	});
	const realtime = reactive({
		connectionId: 'conn-1',
		connectionState: 'connected',
	});
	const realtimeCallbacks: any[] = [];
	const realtimeSession = {
		start: vi.fn(async (_eventId: number, screenId: number) => {
			order.push(`start:${screenId}`);
		}),
		stop: vi.fn(async () => {
			order.push('stop');
		}),
		updatePresenceData: vi.fn(async () => {}),
	};
	const exportElementPng = options.exportElementPng ?? vi.fn(async () => undefined);
	const closeWindow = vi.fn();
	let session!: ScreenDisplaySession;

	const TestHost = defineComponent({
		setup() {
			session = useScreenDisplaySession({
				route,
				eventStore: eventStore as any,
				screenStore: screenStore as any,
				realtime: realtime as any,
				createRealtimeSession: (callbacks) => {
					realtimeCallbacks.push(callbacks);
					return realtimeSession;
				},
				exportAdapter: {
					exportElementPng: exportElementPng as any,
					buildFilename: params => `file-${params.screenSlug}-${params.output}-${params.width}x${params.height}.png`,
					closeWindow,
				},
			});
			options.setupSession?.(session);
			return () => h('div');
		},
	});

	const wrapper = mount(TestHost);

	return {
		wrapper,
		route,
		screenStore,
		eventStore,
		realtime,
		realtimeSession,
		realtimeCallbacks,
		exportElementPng,
		closeWindow,
		order,
		get session() {
			return session;
		},
	};
}

describe('useScreenDisplaySession', () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('loads the screen from the route fallback event id when the event store has no event id', async () => {
		const harness = createHarness({ eventId: null });
		await flushPromises();

		// The third argument is the Screen Output Asset Capability from the URL
		// fragment, which the lookup itself requires since #397. Null here because this
		// harness's route carries no fragment — the shape an operator's `embed=preview`
		// surface has, and one the route admits on their session instead.
		expect(harness.screenStore.loadScreenBySlug).toHaveBeenCalledWith(42, 'main', null);
		expect(harness.session.error.value).toBeNull();
		expect(harness.session.loading.value).toBe(false);
	});

	it('passes the capability from the URL fragment to the lookup, as a Screen Output', async () => {
		// The output's only credential for the lookup. Without it the route answers
		// 404, and an output that cannot resolve its own Screen renders nothing at all
		// — so this is the argument that decides whether program comes up.
		const harness = createHarness({
			route: createRoute({}, '#asset-capability=a-screen-output-capability-token'),
		});
		await flushPromises();

		expect(harness.screenStore.loadScreenBySlug)
			.toHaveBeenCalledWith(42, 'main', 'a-screen-output-capability-token');
	});

	it('reports a missing event when neither the store nor route has an event id', async () => {
		const route = createRoute();
		route.params.eventId = '';
		const harness = createHarness({ route, eventId: null });
		await flushPromises();

		expect(harness.screenStore.loadScreenBySlug).not.toHaveBeenCalled();
		expect(harness.session.error.value).toBe('Event not found');
		expect(harness.session.loading.value).toBe(false);
	});

	it('starts realtime after a successful load when the URL carries no embed role', async () => {
		const harness = createHarness();
		await flushPromises();

		expect(harness.realtimeSession.start).toHaveBeenCalledWith(42, 7);
	});

	it('does not reconnect realtime when a missing slug follows a valid screen', async () => {
		const harness = createHarness();
		await flushPromises();
		harness.order.splice(0);

		harness.route.params.screenSlug = 'missing';
		await nextTick();
		await flushPromises();

		expect(harness.order).toEqual(['stop', 'load:missing']);
		expect(harness.screenStore.activeScreen).toBeNull();
		expect(harness.session.error.value).toBe('Screen not found');
	});

	it('does not start realtime when embed=preview', async () => {
		const harness = createHarness({ query: { embed: 'preview' } });
		await flushPromises();

		expect(harness.realtimeSession.start).not.toHaveBeenCalled();
		expect(harness.session.screenContext.isPreview?.value).toBe(true);
	});

	it('carries card data health in presence data and re-announces it when a rendering reports a change', async () => {
		const harness = createHarness();
		await flushPromises();

		const callbacks = harness.realtimeCallbacks[0]!;
		expect(callbacks.getPresenceData(42, 7)).toMatchObject({ cardData: 'complete' });
		expect(harness.realtimeSession.updatePresenceData).not.toHaveBeenCalled();

		harness.session.screenContext.cardDataHealth!.value = 'degraded';
		await nextTick();

		expect(harness.realtimeSession.updatePresenceData).toHaveBeenCalledOnce();
		expect(callbacks.getPresenceData(42, 7)).toMatchObject({ cardData: 'degraded' });

		harness.session.screenContext.cardDataHealth!.value = 'complete';
		await nextTick();

		expect(harness.realtimeSession.updatePresenceData).toHaveBeenCalledTimes(2);
		expect(callbacks.getPresenceData(42, 7)).toMatchObject({ cardData: 'complete' });
	});

	/**
	 * A Program monitor is live in every way an output is — it composes what playout
	 * took, resolves media through the capability, and composites as program — and is
	 * still not one of the Screen's outputs. It is the control surface an operator is
	 * already looking at, embedded beside the controls that drive it.
	 *
	 * So it joins no presence and answers no Screen command. Joining would have every
	 * presence-derived surface count the operator's own monitor as a client watching:
	 * the Screen's connected count would read one with nothing open, and the Open
	 * Screen Output Engines would name the operator's browser as an engine to state a
	 * Graphic Asset Revision's cost against. Answering commands would flash Identify
	 * on the one display an operator never needs to find.
	 */
	it('does not start realtime when embed=monitor, so a Program monitor is no output', async () => {
		const harness = createHarness({ query: { embed: 'monitor' } });
		await flushPromises();

		expect(harness.realtimeSession.start).not.toHaveBeenCalled();
	});

	/**
	 * And is live in the ways a preview is not. The monitor's whole job is to show
	 * what is on air, which it can only do by loading playout and resolving media as
	 * an output does — both of which the preview reading of this URL suppresses.
	 */
	it('leaves a Program monitor live: not a preview, and no preview backdrop or guides', async () => {
		const harness = createHarness({ query: { embed: 'monitor', guides: '1', safe: '1' } });
		await flushPromises();

		expect(harness.session.screenContext.isPreview?.value).toBe(false);
		expect(harness.session.screenContext.previewGuides?.value).toBe(false);
		expect(harness.session.screenContext.previewSafeAreas?.value).toBe(false);
	});

	/**
	 * An unreadable role is a live Screen Output. The safe reading of a mistyped URL
	 * is the one that reports itself: an output that joined nothing would watch
	 * invisibly, and every surface that states what the outputs cost would be wrong
	 * about it with nothing saying so.
	 */
	it('treats an unrecognised embed role as a live Screen Output', async () => {
		const harness = createHarness({ query: { embed: 'program' } });
		await flushPromises();

		expect(harness.realtimeSession.start).toHaveBeenCalledWith(42, 7);
		expect(harness.session.screenContext.isPreview?.value).toBe(false);
	});

	/**
	 * Preview guides never appear in live Screen Outputs. This is the step of that
	 * guarantee the URL owns: the guide flags carry no authority of their own, so a
	 * Screen Output URL that asks for guides without asking to be a preview gets
	 * none. Downstream is already pinned — the render model builds guide arrays only
	 * when these flags are set, and the guide layer draws exclusively from those
	 * arrays — so this closes the chain from query string to drawn guide.
	 *
	 * The Screen Output this hands back is a live one, and that is the point: it is
	 * asked for as such here so the case cannot quietly become a preview.
	 */
	it('draws no guides for guides=1 and safe=1 without embed=preview', async () => {
		const harness = createHarness({ query: { guides: '1', safe: '1' } });
		await flushPromises();

		expect(harness.session.screenContext.isPreview?.value).toBe(false);
		expect(harness.session.screenContext.previewGuides?.value).toBe(false);
		expect(harness.session.screenContext.previewSafeAreas?.value).toBe(false);
		expect(harness.realtimeSession.start).toHaveBeenCalledWith(42, 7);
	});

	/**
	 * The other side, so the refusal above is the preview flag being load-bearing
	 * rather than the flags never being read at all.
	 */
	it('draws the guides an embedded preview asks for', async () => {
		const harness = createHarness({ query: { embed: 'preview', guides: '1', safe: '1' } });
		await flushPromises();

		expect(harness.session.screenContext.previewGuides?.value).toBe(true);
		expect(harness.session.screenContext.previewSafeAreas?.value).toBe(true);
	});

	it('reads the opaque asset capability only from the URL fragment', async () => {
		const route = createRoute(
			{ assetCapability: 'query-secret-must-be-ignored' },
			'#asset-capability=opaque_fragment_capability',
		);
		const harness = createHarness({ route });
		await flushPromises();

		expect(harness.session.screenContext.assetCapability?.value)
			.toBe('opaque_fragment_capability');
	});

	it('stops the previous realtime session before loading and starting the new slug', async () => {
		const harness = createHarness();
		await flushPromises();
		harness.order.splice(0);

		harness.route.params.screenSlug = 'second';
		await nextTick();
		await flushPromises();

		expect(harness.order).toEqual(['stop', 'load:second', 'start:8']);
	});

	it('does not let an obsolete route failure replace the latest screen state', async () => {
		const harness = createHarness();
		await flushPromises();
		const obsoleteLoad = deferred<ReturnType<typeof createMockScreen>>();
		const latestScreen = createMockScreen({ id: 8, slug: 'second' });
		harness.screenStore.loadScreenBySlug.mockImplementation(async (_eventId: number, slug: string) => {
			if (slug === 'obsolete')
				return await obsoleteLoad.promise;
			harness.screenStore.activeScreen = latestScreen;
			return latestScreen;
		});

		harness.route.params.screenSlug = 'obsolete';
		await nextTick();
		harness.route.params.screenSlug = 'second';
		await nextTick();
		await flushPromises();
		obsoleteLoad.reject(new Error('obsolete failure'));
		await flushPromises();

		expect(harness.screenStore.activeScreen).toEqual(latestScreen);
		expect(harness.session.error.value).toBeNull();
		expect(harness.session.loading.value).toBe(false);
		expect(harness.realtimeSession.start).toHaveBeenLastCalledWith(42, 8);
	});

	it('identify command sets showIdentify and clears it after timeout', async () => {
		const harness = createHarness();
		await flushPromises();
		vi.useFakeTimers();

		harness.realtimeCallbacks[0].onIdentify();
		expect(harness.session.showIdentify.value).toBe(true);

		vi.advanceTimersByTime(2000);
		expect(harness.session.showIdentify.value).toBe(false);
	});

	it('debug command toggles showDebug', async () => {
		const harness = createHarness();
		await flushPromises();

		harness.realtimeCallbacks[0].onDebug();
		expect(harness.session.showDebug.value).toBe(true);

		harness.realtimeCallbacks[0].onDebug();
		expect(harness.session.showDebug.value).toBe(false);
	});

	it('download=1 exports with configured dimensions, output filename, and output background', async () => {
		const screen = createMockScreen({
			id: 12,
			slug: 'main',
			screenConfig: { width: 1920, height: 1080 } as any,
		});
		const harness = createHarness({
			query: { download: '1', output: 'fill' },
			screens: { main: screen },
			setupSession: (session) => {
				session.screenContext.overlayContainer.value = sizedElement(100, 50);
			},
		});
		await flushPromises();

		expect(harness.exportElementPng).toHaveBeenCalledWith(
			harness.session.screenContext.overlayContainer.value,
			{
				width: 1920,
				height: 1080,
				filename: 'file-main-fill-1920x1080.png',
				backgroundColor: '#000000',
			},
		);
	});

	it('export failure sets exportError without replacing screen load state', async () => {
		const harness = createHarness({
			query: { download: '1' },
			exportElementPng: vi.fn(async () => {
				throw new Error('export failed');
			}),
			setupSession: (session) => {
				session.screenContext.overlayContainer.value = sizedElement(1280, 720);
			},
		});
		await flushPromises();

		expect(harness.session.loading.value).toBe(false);
		expect(harness.session.error.value).toBeNull();
		expect(harness.session.exportError.value).toBe('export failed');
	});

	/**
	 * Ably drops message continuity after a couple of minutes suspended, and a
	 * Screen announcement carries no sequence number — so unlike a Broadcast
	 * Graphics notification, nothing about it can tell a client it fell behind. An
	 * output that missed a mode change while away rendered the old mode
	 * indefinitely, on program, with nothing reporting it (#307).
	 */
	describe('a connection that was suspended and came back', () => {
		async function suspendAndResume(harness: ReturnType<typeof createHarness>) {
			harness.realtime.connectionState = 'suspended';
			await nextTick();
			harness.realtime.connectionState = 'connected';
			await nextTick();
			await flushPromises();
		}

		it('re-reads the Screen without ever emptying what is on program', async () => {
			const harness = createHarness();
			await flushPromises();
			harness.order.splice(0);
			const onProgram = harness.screenStore.activeScreen;

			await suspendAndResume(harness);

			expect(harness.order).toEqual(['refresh:main']);
			expect(harness.screenStore.loadScreenBySlug).toHaveBeenCalledTimes(1);
			// The blanking loader is the wrong one here: a flash of nothing is the one
			// failure an operator cannot recover from in time.
			expect(harness.screenStore.activeScreen).toBe(onProgram);
		});

		it('does not re-read while still disconnected', async () => {
			const harness = createHarness();
			await flushPromises();
			harness.order.splice(0);

			harness.realtime.connectionState = 'suspended';
			await nextTick();
			await flushPromises();

			expect(harness.order).toEqual([]);
		});

		it('takes the ordinary load when there is nothing on program to protect', async () => {
			// Nothing is rendered, so there is no flash to avoid — and this is the
			// load that starts the realtime session the failed one never got.
			const harness = createHarness({ screens: {} });
			await flushPromises();
			expect(harness.screenStore.activeScreen).toBeNull();
			harness.order.splice(0);

			await suspendAndResume(harness);

			expect(harness.order).toEqual(['load:main']);
			expect(harness.screenStore.refreshActiveScreen).not.toHaveBeenCalled();
		});
	});
});
