import type { ScreenDisplaySession } from '~/modules/screen/displaySession';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive, watch } from 'vue';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { createAttachSignal, createContinuitySignal } from '~~/test/helpers/realtime-mock';
import { SCREEN_OUTPUT_LOAD_RETRY_MS, useScreenDisplaySession } from '~/modules/screen/displaySession';

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
		// By the held Screen's id, because a slug can be renamed under an output on
		// program (#705).
		refreshActiveScreen: vi.fn(async (_eventId: number, screenId: number) => {
			order.push(`refresh:${screenId}`);
			const screen = Object.values(screens).find(candidate => candidate.id === screenId);
			if (!screen)
				return null;
			screenStore.activeScreen = screen;
			return screen;
		}),
	});
	const eventStore = reactive({
		eventId: options.eventId ?? null,
		outputEvent: null as unknown,
		setOutputEvent: vi.fn((outputEvent: unknown) => {
			eventStore.outputEvent = outputEvent;
		}),
	});
	// The Event context an output reads through its Screen (#604), never the
	// operator's private Event read.
	const outputReads = {
		event: vi.fn(async (scope: { eventId: number; screenId: number }) => ({
			id: scope.eventId,
			name: 'Output Event',
		})),
	};
	const { onContinuityLost, reattach } = createContinuitySignal();
	const { onceAttached, attach, detach } = createAttachSignal();
	const realtime = reactive({
		connectionId: 'conn-1',
		connectionState: 'connected',
		tokenError: null as Error | null,
		onContinuityLost,
		onceAttached,
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
				outputReads: outputReads as any,
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
		screens,
		screenStore,
		eventStore,
		outputReads,
		realtime,
		reattach,
		attach,
		detach,
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

	it('loads its Event context through the Screen it looked up, with the same capability', async () => {
		// The operator's Event read is private; an output has no Session for it, so
		// the context its modes render with comes through the Screen (#604).
		const harness = createHarness({
			route: createRoute({}, '#asset-capability=a-screen-output-capability-token'),
		});
		await flushPromises();

		expect(harness.outputReads.event).toHaveBeenCalledWith({
			eventId: 42,
			screenId: 7,
			assetCapability: 'a-screen-output-capability-token',
		});
		expect(harness.eventStore.setOutputEvent).toHaveBeenCalledWith({ id: 42, name: 'Output Event' });
		expect(harness.session.error.value).toBeNull();
	});

	it('says its Event details are unavailable, holding no Event, when its Event context read fails', async () => {
		// The Screen was found; saying otherwise sends an operator hunting for a
		// Screen that exists (#727).
		const harness = createHarness();
		harness.outputReads.event.mockRejectedValue(new Error('503 Service Unavailable'));
		await flushPromises();

		expect(harness.outputReads.event).toHaveBeenCalled();
		expect(harness.eventStore.setOutputEvent).not.toHaveBeenCalled();
		expect(harness.session.error.value).toBe('Event details unavailable');
		expect(harness.session.errorDetail.value).toBe('The screen "main" was found, but its event details could not be loaded. Retrying automatically.');
		expect(harness.realtimeSession.start).not.toHaveBeenCalled();
	});

	it('still says a genuinely missing Screen is not found', async () => {
		const harness = createHarness({ screens: {} });
		await flushPromises();

		expect(harness.outputReads.event).not.toHaveBeenCalled();
		expect(harness.session.error.value).toBe('Screen not found');
		expect(harness.session.errorDetail.value).toBe('The screen "main" could not be found for this event.');
	});

	it('retries a failed Event context read on its own, finishing the load', async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		harness.outputReads.event.mockRejectedValueOnce(new Error('503 Service Unavailable'));
		harness.outputReads.event.mockRejectedValueOnce(new Error('503 Service Unavailable'));
		await vi.advanceTimersByTimeAsync(0);
		expect(harness.session.error.value).toBe('Event details unavailable');

		await vi.advanceTimersByTimeAsync(SCREEN_OUTPUT_LOAD_RETRY_MS);
		expect(harness.outputReads.event).toHaveBeenCalledTimes(2);
		expect(harness.session.error.value).toBe('Event details unavailable');

		await vi.advanceTimersByTimeAsync(SCREEN_OUTPUT_LOAD_RETRY_MS);
		expect(harness.outputReads.event).toHaveBeenCalledTimes(3);
		expect(harness.session.error.value).toBeNull();
		expect(harness.realtimeSession.start).toHaveBeenCalledWith(42, 7);

		await vi.advanceTimersByTimeAsync(SCREEN_OUTPUT_LOAD_RETRY_MS * 2);
		expect(harness.outputReads.event).toHaveBeenCalledTimes(3);
	});

	it('stops retrying once disposed', async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		harness.outputReads.event.mockRejectedValue(new Error('503 Service Unavailable'));
		await vi.advanceTimersByTimeAsync(0);

		harness.wrapper.unmount();
		await vi.advanceTimersByTimeAsync(SCREEN_OUTPUT_LOAD_RETRY_MS * 2);

		expect(harness.outputReads.event).toHaveBeenCalledOnce();
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

	it('waits for the renderer container to mount before starting a download', async () => {
		const container = sizedElement(1280, 720);
		const harness = createHarness({
			query: { download: '1', output: 'key' },
			setupSession: (session) => {
				watch(session.loading, (loading) => {
					if (!loading)
						session.screenContext.overlayContainer.value = container;
				}, { flush: 'post' });
			},
		});
		await flushPromises();

		expect(harness.exportElementPng).toHaveBeenCalledWith(
			container,
			expect.objectContaining({
				backgroundColor: '#000000',
				filename: expect.stringContaining('file-main-key-'),
			}),
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

		it('re-reads the Screen once its Event channel is attached again, without ever emptying what is on program', async () => {
			const harness = createHarness();
			await flushPromises();
			harness.order.splice(0);
			const onProgram = harness.screenStore.activeScreen;

			await suspendAndResume(harness);
			// Channels reattach only after the connection is back; a read sent before
			// would miss what is published in between (#641).
			expect(harness.order).toEqual([]);

			harness.reattach('event:42');
			await flushPromises();

			expect(harness.order).toEqual(['refresh:7']);
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

		it('takes the ordinary load on the connection coming back when there is nothing on program to protect', async () => {
			// Nothing is rendered, so there is no flash to avoid and no channel to
			// follow yet — and this is the load that starts the realtime session the
			// failed one never got.
			const harness = createHarness({ screens: {} });
			await flushPromises();
			expect(harness.screenStore.activeScreen).toBeNull();
			harness.order.splice(0);

			await suspendAndResume(harness);

			expect(harness.order).toEqual(['load:main']);
			expect(harness.screenStore.refreshActiveScreen).not.toHaveBeenCalled();
		});

		it('recovers a renamed Screen by the id it holds, not by the slug it was opened on', async () => {
			// The route keeps the slug the output was opened on; a rename while it is on
			// program leaves that slug naming nothing (#705).
			const harness = createHarness();
			await flushPromises();
			harness.order.splice(0);
			delete harness.screens.main;
			const missedChange = createMockScreen({ id: 7, slug: 'renamed', currentMode: 'standings' });
			harness.screens.renamed = missedChange;

			harness.reattach('event:42');
			await flushPromises();

			expect(harness.screenStore.refreshActiveScreen).toHaveBeenCalledWith(42, 7, null);
			expect(harness.screenStore.activeScreen).toEqual(missedChange);
			expect(harness.screenStore.loadScreenBySlug).toHaveBeenCalledTimes(1);
		});

		it('re-reads its Event context through its Screen, applying what it missed', async () => {
			// Orientation, display formatting, Feature Match defaults and feature
			// settings every mode renders with: an `event:updated` published while away
			// is never delivered late (#705).
			const harness = createHarness({
				route: createRoute({}, '#asset-capability=a-screen-output-capability-token'),
			});
			await flushPromises();
			const missed = { id: 42, name: 'Output Event', orientation: 'portrait', featureFlags: { metagame: true } };
			harness.outputReads.event.mockResolvedValueOnce(missed as any);

			harness.reattach('event:42');
			await flushPromises();

			expect(harness.outputReads.event).toHaveBeenCalledTimes(2);
			expect(harness.outputReads.event).toHaveBeenLastCalledWith({
				eventId: 42,
				screenId: 7,
				assetCapability: 'a-screen-output-capability-token',
			});
			expect(harness.eventStore.setOutputEvent).toHaveBeenLastCalledWith(missed);
		});

		it('re-reads once more when an Event update lands while its recovery read is in flight', async () => {
			// The Event context carries no revision, so an answer cannot be ordered
			// against an `event:updated` heard meanwhile; one more read settles it.
			const harness = createHarness();
			await flushPromises();
			const inFlight = deferred<any>();
			harness.outputReads.event.mockReturnValueOnce(inFlight.promise);

			harness.reattach('event:42');
			await flushPromises();
			harness.eventStore.outputEvent = { id: 42, name: 'Heard meanwhile' };
			inFlight.resolve({ id: 42, name: 'Answered before or after it' });
			await flushPromises();

			expect(harness.outputReads.event).toHaveBeenCalledTimes(3);
			expect(harness.eventStore.setOutputEvent).not.toHaveBeenCalledWith({ id: 42, name: 'Answered before or after it' });
			expect(harness.eventStore.outputEvent).toEqual({ id: 42, name: 'Output Event' });
		});

		it('re-reads when its subscriptions stop waiting on a token', async () => {
			// A first attach after a token wait reports no continuity loss (ADR-0023),
			// yet everything published while it waited was missed.
			const harness = createHarness();
			await flushPromises();
			harness.order.splice(0);

			harness.realtime.tokenError = new Error('mint failed') as any;
			await nextTick();
			harness.realtime.tokenError = null;
			await nextTick();
			await flushPromises();

			expect(harness.order).toEqual(['refresh:7']);
			expect(harness.outputReads.event).toHaveBeenCalledTimes(2);
		});

		it('lets a recovery that arrives mid-load take over the load', async () => {
			// The load's Event context read may have been lost with the connection;
			// the recovery resumes the load from the Screen it already holds.
			const harness = createHarness();
			const lostRead = deferred<any>();
			harness.outputReads.event.mockReturnValueOnce(lostRead.promise);
			await flushPromises();
			expect(harness.session.loading.value).toBe(true);

			await suspendAndResume(harness);
			lostRead.resolve({ id: 42, name: 'Lost read' });
			await flushPromises();

			expect(harness.eventStore.setOutputEvent).not.toHaveBeenCalledWith({ id: 42, name: 'Lost read' });
			expect(harness.eventStore.setOutputEvent).toHaveBeenCalledWith({ id: 42, name: 'Output Event' });
			expect(harness.realtimeSession.start).toHaveBeenCalledOnce();
			expect(harness.session.loading.value).toBe(false);
			expect(harness.session.error.value).toBeNull();
		});

		it('holds its last accepted rendering through a recovery that fails, and recovers on the next', async () => {
			const harness = createHarness();
			await flushPromises();
			const onProgram = harness.screenStore.activeScreen;
			harness.screenStore.refreshActiveScreen.mockResolvedValueOnce(null);
			harness.outputReads.event.mockRejectedValueOnce(new Error('503 Service Unavailable'));

			harness.reattach('event:42');
			await flushPromises();

			expect(harness.screenStore.activeScreen).toBe(onProgram);
			expect(harness.eventStore.setOutputEvent).toHaveBeenCalledTimes(1);
			expect(harness.session.loading.value).toBe(false);
			expect(harness.session.error.value).toBeNull();

			// Transient: the next loss of continuity tries again.
			const missedChange = createMockScreen({ id: 7, slug: 'main', currentMode: 'standings' });
			harness.screens.main = missedChange;
			harness.reattach('event:42');
			await flushPromises();

			expect(harness.screenStore.activeScreen).toEqual(missedChange);
			expect(harness.eventStore.setOutputEvent).toHaveBeenCalledTimes(2);
		});

		it('drops a recovery that a Screen change superseded', async () => {
			const harness = createHarness();
			await flushPromises();
			const lateContext = deferred<any>();
			harness.outputReads.event.mockReturnValueOnce(lateContext.promise);

			harness.reattach('event:42');
			await flushPromises();
			harness.route.params.screenSlug = 'second';
			await nextTick();
			await flushPromises();
			lateContext.resolve({ id: 42, name: 'Read for the old Screen' });
			await flushPromises();

			expect(harness.eventStore.setOutputEvent).not.toHaveBeenCalledWith({ id: 42, name: 'Read for the old Screen' });
			expect(harness.eventStore.setOutputEvent).toHaveBeenLastCalledWith({ id: 42, name: 'Output Event' });
			expect(harness.realtimeSession.start).toHaveBeenLastCalledWith(42, 8);
		});

		/**
		 * The Screen lookup answered and its Event context did not. The output holds a
		 * Screen and renders nothing, and listens on no Event channel, because the
		 * Event context it would name is what failed. Treating the held Screen as a
		 * finished load left it so for good (#705).
		 */
		describe('when its Event context failed after its Screen lookup succeeded', () => {
			async function failedLoad(options: Parameters<typeof createHarness>[0] = {}) {
				const harness = createHarness(options);
				harness.outputReads.event.mockRejectedValueOnce(new Error('503 Service Unavailable'));
				await flushPromises();
				expect(harness.screenStore.activeScreen?.id).toBe(7);
				expect(harness.session.error.value).toBe('Event details unavailable');
				harness.order.splice(0);
				return harness;
			}

			it('finishes the load on the connection coming back: clears the error and starts realtime', async () => {
				const harness = await failedLoad({
					route: createRoute({}, '#asset-capability=a-screen-output-capability-token'),
				});

				await suspendAndResume(harness);

				// Resumed from the Screen it holds, by id, with the same capability.
				expect(harness.order).toEqual(['refresh:7', 'start:7']);
				expect(harness.outputReads.event).toHaveBeenLastCalledWith({
					eventId: 42,
					screenId: 7,
					assetCapability: 'a-screen-output-capability-token',
				});
				expect(harness.eventStore.setOutputEvent).toHaveBeenCalledWith({ id: 42, name: 'Output Event' });
				expect(harness.session.error.value).toBeNull();
				expect(harness.session.loading.value).toBe(false);
				expect(harness.realtimeSession.start).toHaveBeenCalledWith(42, 7);
			});

			it('stays retryable when the resumed load fails too', async () => {
				const harness = await failedLoad();
				harness.outputReads.event.mockRejectedValueOnce(new Error('503 Service Unavailable'));

				await suspendAndResume(harness);

				expect(harness.session.error.value).toBe('Event details unavailable');
				expect(harness.realtimeSession.start).not.toHaveBeenCalled();

				await suspendAndResume(harness);

				expect(harness.session.error.value).toBeNull();
				expect(harness.realtimeSession.start).toHaveBeenCalledWith(42, 7);
			});

			it('listens on its Event channel once loaded, and not before', async () => {
				const harness = await failedLoad();

				// No Event channel names it yet, so a reattach there finds nothing to do.
				harness.reattach('event:42');
				await flushPromises();
				expect(harness.order).toEqual([]);

				await suspendAndResume(harness);
				harness.order.splice(0);

				harness.reattach('event:42');
				await flushPromises();
				expect(harness.order).toEqual(['refresh:7']);
			});

			it('finishes a Program monitor\'s load without entering presence', async () => {
				const harness = await failedLoad({ query: { embed: 'monitor' } });

				await suspendAndResume(harness);

				expect(harness.session.error.value).toBeNull();
				expect(harness.eventStore.setOutputEvent).toHaveBeenCalledOnce();
				expect(harness.realtimeSession.start).not.toHaveBeenCalled();
			});

			it('finishes a preview\'s load without entering presence', async () => {
				const harness = await failedLoad({ query: { embed: 'preview' } });

				await suspendAndResume(harness);

				expect(harness.session.error.value).toBeNull();
				expect(harness.realtimeSession.start).not.toHaveBeenCalled();
			});

			it('lets a Screen change supersede the resumed load', async () => {
				const harness = await failedLoad();
				const lateContext = deferred<any>();
				harness.outputReads.event.mockReturnValueOnce(lateContext.promise);

				await suspendAndResume(harness);
				harness.route.params.screenSlug = 'second';
				await nextTick();
				await flushPromises();
				lateContext.resolve({ id: 42, name: 'Read for the old Screen' });
				await flushPromises();

				expect(harness.eventStore.setOutputEvent).not.toHaveBeenCalledWith({ id: 42, name: 'Read for the old Screen' });
				expect(harness.realtimeSession.start).toHaveBeenCalledTimes(1);
				expect(harness.realtimeSession.start).toHaveBeenLastCalledWith(42, 8);
				expect(harness.session.error.value).toBeNull();
			});
		});
	});

	/**
	 * The Event channel attaches only once the Event context names it, after the
	 * initial reads have answered. Whatever was published between a read and that
	 * attach reached no listener, and a first attach on an unbroken connection
	 * reports no continuity loss (ADR-0023), so the output re-reads off the attach
	 * itself (#727).
	 */
	describe('its first load, before its Event channel first attached', () => {
		it('re-reads its Screen and Event context once the channel attaches, reflecting what it missed', async () => {
			const harness = createHarness({
				route: createRoute({}, '#asset-capability=a-screen-output-capability-token'),
			});
			await flushPromises();
			harness.order.splice(0);
			const onProgram = harness.screenStore.activeScreen;
			// Published after the reads answered, before anything listened.
			const missedScreen = createMockScreen({ id: 7, slug: 'main', currentMode: 'standings' });
			harness.screens.main = missedScreen;
			const missedEvent = { id: 42, name: 'Output Event', orientation: 'portrait' };
			harness.outputReads.event.mockResolvedValueOnce(missedEvent as any);

			harness.attach('event:42');
			await flushPromises();

			expect(harness.order).toEqual(['refresh:7']);
			expect(harness.screenStore.activeScreen).toEqual(missedScreen);
			expect(harness.screenStore.activeScreen).not.toBe(onProgram);
			expect(harness.outputReads.event).toHaveBeenLastCalledWith({
				eventId: 42,
				screenId: 7,
				assetCapability: 'a-screen-output-capability-token',
			});
			expect(harness.eventStore.setOutputEvent).toHaveBeenLastCalledWith(missedEvent);
			// The non-blanking re-read: loading and error are left alone.
			expect(harness.session.loading.value).toBe(false);
			expect(harness.screenStore.loadScreenBySlug).toHaveBeenCalledOnce();
		});

		it('re-reads once loaded when the channel attached while its Event context read was in flight', async () => {
			const harness = createHarness();
			const inFlight = deferred<any>();
			harness.outputReads.event.mockReturnValueOnce(inFlight.promise);
			await flushPromises();

			harness.attach('event:42');
			await flushPromises();
			expect(harness.outputReads.event).toHaveBeenCalledOnce();

			harness.order.splice(0);
			inFlight.resolve({ id: 42, name: 'Read before the attach' });
			await flushPromises();

			expect(harness.session.loading.value).toBe(false);
			expect(harness.order).toEqual(['start:7', 'refresh:7']);
			expect(harness.outputReads.event).toHaveBeenCalledTimes(2);
			expect(harness.eventStore.setOutputEvent).toHaveBeenLastCalledWith({ id: 42, name: 'Output Event' });
		});

		it('re-reads only once, not on every later attach', async () => {
			const harness = createHarness();
			await flushPromises();
			harness.attach('event:42');
			await flushPromises();
			harness.order.splice(0);

			harness.detach('event:42');
			harness.attach('event:42');
			await flushPromises();

			// A later loss of continuity is Reconnect Resync's (ADR-0023).
			expect(harness.order).toEqual([]);
		});

		it('does not re-read for a load whose Event channel was already attached', async () => {
			// A Screen change within one Event: the channel listened throughout, so
			// nothing published during the reads went unheard.
			const harness = createHarness();
			await flushPromises();
			harness.attach('event:42');
			await flushPromises();

			harness.route.params.screenSlug = 'second';
			await nextTick();
			await flushPromises();
			harness.order.splice(0);
			harness.attach('event:42');
			await flushPromises();

			expect(harness.order).toEqual([]);
			expect(harness.outputReads.event).toHaveBeenCalledTimes(3);
		});

		it('re-reads for a Program monitor too, without entering presence', async () => {
			const harness = createHarness({ query: { embed: 'monitor' } });
			await flushPromises();
			harness.order.splice(0);

			harness.attach('event:42');
			await flushPromises();

			expect(harness.order).toEqual(['refresh:7']);
			expect(harness.realtimeSession.start).not.toHaveBeenCalled();
		});

		it('re-reads for the load that is current, not one a Screen change superseded', async () => {
			const harness = createHarness();
			const oldContext = deferred<any>();
			harness.outputReads.event.mockReturnValueOnce(oldContext.promise);
			await flushPromises();

			harness.route.params.screenSlug = 'second';
			await nextTick();
			await flushPromises();
			oldContext.resolve({ id: 42, name: 'Read for the old Screen' });
			await flushPromises();
			harness.order.splice(0);

			harness.attach('event:42');
			await flushPromises();

			expect(harness.order).toEqual(['refresh:8']);
		});

		it('does not re-read when its load failed, since it holds nothing the attach could correct', async () => {
			const harness = createHarness({ screens: {} });
			await flushPromises();
			harness.order.splice(0);

			harness.attach('event:42');
			await flushPromises();

			expect(harness.order).toEqual([]);
		});
	});
});
