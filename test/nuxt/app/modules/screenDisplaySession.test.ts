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

		expect(harness.screenStore.loadScreenBySlug).toHaveBeenCalledWith(42, 'main');
		expect(harness.session.error.value).toBeNull();
		expect(harness.session.loading.value).toBe(false);
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

	it('starts realtime after a successful load when not preview', async () => {
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

	it('does not start realtime when preview=1', async () => {
		const harness = createHarness({ query: { preview: '1' } });
		await flushPromises();

		expect(harness.realtimeSession.start).not.toHaveBeenCalled();
		expect(harness.session.screenContext.isPreview?.value).toBe(true);
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
});
