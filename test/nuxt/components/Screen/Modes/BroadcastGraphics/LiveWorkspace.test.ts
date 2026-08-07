import type {
	BroadcastGraphicChannelContext,
	BroadcastGraphicsLiveState,
	BroadcastGraphicsRecoveryFault,
	BroadcastGraphicsRejectionCode,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig, GraphicChannelConfig, GraphicInputValue } from '~~/shared/types/graphics';
import type { GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import {
	broadcastGraphicChannelContexts,
	broadcastGraphicPhaseProjections,
	broadcastGraphicPhaseTiming,
	broadcastGraphicPlayoutState,
	broadcastGraphicRenderedInputs,
	createInitialBroadcastGraphicsLiveState,
	graphicInputTraces,
	onAirBroadcastGraphicIds,
} from '~~/shared/modules/broadcast-graphics-live-session';
import { createEmptyGraphicBindingDataSet } from '~~/shared/modules/graphics';

enableAutoUnmount(afterEach);

const mockLiveState = ref<BroadcastGraphicsLiveState>(createInitialBroadcastGraphicsLiveState());
const mockLoadSession = vi.fn();
const mockTake = vi.fn();
const mockOut = vi.fn();
const mockPendingGraphicIds = ref<string[]>([]);
const mockError = ref<string | null>(null);
/** The domain refusal `error` is reporting, when what it is reporting is one. */
const mockRefusal = ref<{ code: BroadcastGraphicsRejectionCode; message: string } | null>(null);
/** The authoritative clock the real store derives from a server offset. */
const mockServerNow = ref(1_700_000_000_000);
const mockSessions = ref(new Map<number, { id: number; sequence: number }>());
const mockRecoveryFault = ref<BroadcastGraphicsRecoveryFault | null>(null);
const mockResetLiveState = vi.fn();

/** What the realtime transport reports; the workspace derives disconnection from it. */
const mockConnectionState = ref<'connected' | 'disconnected' | 'suspended' | 'connecting'>('connected');

mockNuxtImport('tryUseRealtime', () => () => ({
	get connectionState() {
		return mockConnectionState.value;
	},
	get isConnected() {
		return mockConnectionState.value === 'connected';
	},
}));

/** Answers the reset confirmation; `null` stands for the operator cancelling. */
const mockConfirmResult = ref<boolean>(true);
const mockConfirmOpen = vi.fn();

mockNuxtImport('useOverlay', () => () => ({
	create: () => ({
		open: (...args: unknown[]) => {
			mockConfirmOpen(...args);
			return { result: Promise.resolve(mockConfirmResult.value) };
		},
	}),
}));

mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({
	loadSession: mockLoadSession,
	take: mockTake,
	out: mockOut,
	get error() {
		return mockError.value;
	},
	get refusal() {
		return mockRefusal.value;
	},
	get sessions() {
		return mockSessions.value;
	},
	serverNow: () => mockServerNow.value,
	channelContexts: (
		graphics: readonly BroadcastGraphicConfig[],
		channels: readonly GraphicChannelConfig[] | undefined,
	) => (channels?.length ? broadcastGraphicChannelContexts({ graphics, channels }) : {}),
	isPending: (_screenId: number, graphicId: string) => mockPendingGraphicIds.value.includes(graphicId),
	playoutState: (
		_screenId: number,
		graphicId: string,
		graphic?: Pick<BroadcastGraphicConfig, 'items' | 'animation'>,
		now?: number,
		channel?: BroadcastGraphicChannelContext,
	) => broadcastGraphicPlayoutState(
		mockLiveState.value,
		graphicId,
		graphic ? broadcastGraphicPhaseTiming(graphic, now ?? mockServerNow.value, channel) : undefined,
	),
	onAirGraphicIds: (
		_screenId: number,
		graphics: readonly BroadcastGraphicConfig[],
		now?: number,
		channels?: readonly GraphicChannelConfig[],
	) => {
		const contexts = channels?.length ? broadcastGraphicChannelContexts({ graphics, channels }) : {};
		return onAirBroadcastGraphicIds(
			mockLiveState.value,
			graphics,
			graphic => broadcastGraphicPhaseTiming(
				graphic as BroadcastGraphicConfig,
				now ?? mockServerNow.value,
				contexts[graphic.id],
			),
		);
	},
	animationProjection: (
		_screenId: number,
		graphics: readonly BroadcastGraphicConfig[],
		now?: number,
		channels?: readonly GraphicChannelConfig[],
	) => {
		const contexts = channels?.length ? broadcastGraphicChannelContexts({ graphics, channels }) : {};
		return Object.fromEntries(graphics.flatMap((graphic) => {
			const projection = broadcastGraphicPhaseProjections(
				mockLiveState.value,
				graphic.id,
				broadcastGraphicPhaseTiming(graphic, now ?? mockServerNow.value, contexts[graphic.id]),
			);
			// Empty means settled, and the real store leaves a settled graphic out of the
			// map entirely so "is anything moving?" stays one question about the map's size.
			return projection.length > 0 ? [[graphic.id, projection]] : [];
		}));
	},
	inputTraces: (_screenId: number, graphic: BroadcastGraphicConfig) =>
		graphicInputTraces(mockLiveState.value, graphic.id, graphic),
	renderedInputValues: (
		_screenId: number,
		graphics: readonly BroadcastGraphicConfig[],
		now?: number,
	) => {
		const current: Record<string, Record<string, GraphicInputValue>> = {};
		const outgoing: Record<string, Record<string, GraphicInputValue>> = {};
		for (const graphic of graphics) {
			const rendered = broadcastGraphicRenderedInputs(
				mockLiveState.value,
				graphic.id,
				graphic.inputs ?? [],
				broadcastGraphicPhaseTiming(graphic, now ?? mockServerNow.value),
			);
			current[graphic.id] = rendered.current;
			if (rendered.outgoing)
				outgoing[graphic.id] = rendered.outgoing;
		}
		return { current, outgoing };
	},
	sourceSelections: (_screenId: number, graphicId: string) =>
		mockLiveState.value.sources?.[graphicId] ?? {},
	setInput: vi.fn(),
	setOverride: vi.fn(),
	selectSource: vi.fn(),
	updateGraphic: vi.fn(),
	resetLiveState: mockResetLiveState,
	recoveryFault: () => mockRecoveryFault.value,
}));

// Live Control resolves its displayed bound values from Event Data; this workspace
// suite is about which graphic's controls are generated, so it supplies none.
mockNuxtImport('useGraphicBindingData', () => () => ({
	dataSet: computed(() => createEmptyGraphicBindingDataSet()),
	selectionOptions: () => [],
}));

/**
 * What the Screen Outputs watching this Screen report about themselves.
 *
 * Only Screen Outputs join a Screen's presence, so every member here is one — and
 * `assetAccess` is each one's own answer to whether it can resolve this Screen's
 * media at all.
 */
const mockPresence = ref<Array<{ data?: { assetAccess?: 'granted' | 'absent' } }>>([]);

mockNuxtImport('useScreenStore', () => () => ({
	get screenPresence() {
		return new Map([[3, { count: mockPresence.value.length, members: mockPresence.value }]]);
	},
}));

/** What every Graphic Asset Revision status request answers with. */
const mockReferenceStatus = ref<GraphicAssetReferenceStatus>({
	outcome: 'available',
	lifecycleState: 'active',
	kind: 'image',
});
/** What the Screen Output Asset Capability endpoint issues, if anything. */
const mockCapabilityResponse = ref<string | null>('program-capability');
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockApiFetch);

/** What the hand-out controls report through, and what they were handed. */
const mockCopyToClipboard = vi.fn();
const mockToastAdd = vi.fn();

mockNuxtImport('useCopyToClipboard', () => () => ({ copyToClipboard: mockCopyToClipboard }));
mockNuxtImport('useToast', () => () => ({ add: mockToastAdd }));

const UAlertStub = defineComponent({
	props: { title: { type: String, required: false }, description: { type: String, required: false } },
	template: '<div><strong>{{ title }}</strong><span>{{ description }}</span></div>',
});

const ScreenSettingsCardStub = defineComponent({
	props: { title: { type: String, required: false } },
	template: '<section><h2>{{ title }}</h2><slot name="actions" :open="true" /><slot /></section>',
});

const UIEmptyStateStub = defineComponent({
	props: { title: { type: String, required: false } },
	template: '<div data-testid="empty-state">{{ title }}</div>',
});

const UBadgeStub = defineComponent({ template: '<span><slot /></span>' });
const UIconStub = defineComponent({ template: '<i />' });
const UFieldGroupStub = defineComponent({ template: '<div><slot /></div>' });
const UButtonStub = defineComponent({
	name: 'UButton',
	props: { disabled: { type: Boolean, default: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const lowerThird: BroadcastGraphicConfig = { id: 'lower-third', name: 'Lower Third', items: [] };
const slate: BroadcastGraphicConfig = { id: 'slate', name: 'Slate', items: [] };

async function mountComponent(
	graphics: BroadcastGraphicConfig[] = [lowerThird, slate],
	selectedGraphicId: string | null = null,
	channels: GraphicChannelConfig[] = [],
) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/BroadcastGraphics/LiveWorkspace.vue';
	const { default: LiveWorkspace } = await import(componentPath);

	const wrapper = mount(LiveWorkspace, {
		props: {
			eventId: 7,
			screen: { id: 3, slug: 'main' } as Screen,
			graphics,
			channels,
			selectedGraphicId,
			canvasWidth: 1920,
			canvasHeight: 1080,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UIEmptyState: UIEmptyStateStub,
				UBadge: UBadgeStub,
				UIcon: UIconStub,
				UFieldGroup: UFieldGroupStub,
				UButton: UButtonStub,
				UAlert: UAlertStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

function entryFor(wrapper: Awaited<ReturnType<typeof mountComponent>>, graphicId: string) {
	return wrapper.get(`[data-playout-entry="${graphicId}"]`);
}

describe('broadcastGraphicsLiveWorkspace', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLiveState.value = createInitialBroadcastGraphicsLiveState();
		mockPendingGraphicIds.value = [];
		mockError.value = null;
		mockRefusal.value = null;
		mockRecoveryFault.value = null;
		mockConnectionState.value = 'connected';
		mockConfirmResult.value = true;
		mockPresence.value = [];
		mockReferenceStatus.value = { outcome: 'available', lifecycleState: 'active', kind: 'image' };
		mockCapabilityResponse.value = 'program-capability';
		mockApiFetch.mockImplementation(async (path: string) => {
			if (String(path).endsWith('/asset-capability')) {
				if (!mockCapabilityResponse.value)
					throw new Error('no capability');
				return { assetCapability: mockCapabilityResponse.value };
			}
			return mockReferenceStatus.value;
		});
	});

	/**
	 * The Program monitor is one Screen Output and always has its capability, so it
	 * cannot show an operator what a capture browser opened without one is showing:
	 * the same composition with every image and video missing, which looks like a
	 * composition that has no media at all (#231).
	 *
	 * The outputs say, and this states what they said.
	 */
	describe('outputs that cannot resolve this Screen’s media', () => {
		const branded: BroadcastGraphicConfig = {
			id: 'branded',
			name: 'Branded slate',
			items: [{
				type: 'media',
				id: 'wordmark',
				label: 'Wordmark',
				visible: true,
				anchor: 'top-left',
				x: 0,
				y: 0,
				width: 480,
				height: 270,
				asset: { assetId: 'brand-asset' as never, revisionId: 'brand-revision-2' as never },
				mediaKind: 'image',
				fit: 'contain',
				focalPosition: { horizontal: 0.5, vertical: 0.5 },
				opacity: 1,
				playbackRate: 1,
				loop: false,
			}],
		};

		it('names an output that reported it cannot', async () => {
			mockPresence.value = [{ data: { assetAccess: 'absent' } }];

			const wrapper = await mountComponent([branded]);

			expect(wrapper.get('[data-testid="outputs-without-asset-access"]').text())
				.toContain('One Screen Output cannot resolve this Screen\'s assets');
		});

		/**
		 * A Screen publishing nothing but Shapes and Text loses nothing to a missing
		 * capability, and warning about it would teach an operator to ignore the
		 * warning that matters.
		 */
		it('says nothing when the Screen publishes no media', async () => {
			mockPresence.value = [{ data: { assetAccess: 'absent' } }];

			const wrapper = await mountComponent([lowerThird]);

			expect(wrapper.find('[data-testid="outputs-without-asset-access"]').exists()).toBe(false);
		});

		/**
		 * An output that reports nothing is silent about its asset access rather than
		 * lacking it, and a silence is not a fault to put in front of an operator.
		 */
		it('says nothing about an output that reported nothing', async () => {
			mockPresence.value = [{ data: {} }, {}];

			const wrapper = await mountComponent([branded]);

			expect(wrapper.find('[data-testid="outputs-without-asset-access"]').exists()).toBe(false);
		});

		it('says nothing when every open output holds its capability', async () => {
			mockPresence.value = [{ data: { assetAccess: 'granted' } }];

			const wrapper = await mountComponent([branded]);

			expect(wrapper.find('[data-testid="outputs-without-asset-access"]').exists()).toBe(false);
		});

		/**
		 * A Broadcast Graphics Screen publishes from two places, and only one of them is
		 * in its authored configuration. Until #238 this warning read the authored stack
		 * alone, so a Screen whose every image was chosen live — through a media Graphic
		 * Input its Live Session accepted (#96, #178) — warned about nothing while its
		 * outputs lost every one of those choices.
		 */
		describe('media that arrives only through a live Graphic Input', () => {
			/** Nothing authored pins an asset: the only media here is chosen at runtime. */
			const runtimeChosen: BroadcastGraphicConfig = {
				id: 'promo',
				name: 'Promo',
				items: [],
				inputs: [{
					type: 'media',
					key: 'backdrop',
					label: 'Backdrop',
					required: false,
					updatePolicy: 'staged',
					mediaKind: 'image',
					default: null,
				}],
			};

			function accepted(value: Record<string, unknown>) {
				return {
					playout: {},
					inputs: { promo: { working: {}, accepted: value, acceptedRevision: 1 } },
				} as unknown as BroadcastGraphicsLiveState;
			}

			it('warns about an output that cannot resolve a value the operator chose live', async () => {
				mockPresence.value = [{ data: { assetAccess: 'absent' } }];
				mockLiveState.value = accepted({
					backdrop: { assetId: 'chosen-asset', revisionId: 'chosen-revision-1' },
				});

				const wrapper = await mountComponent([runtimeChosen]);

				expect(wrapper.get('[data-testid="outputs-without-asset-access"]').text())
					.toContain('One Screen Output cannot resolve this Screen\'s assets');
			});

			/**
			 * The half that keeps the widening honest. A declared media Graphic Input that
			 * nothing has chosen a value for publishes no media at all, and warning there
			 * would spend the credibility of every later warning on a Screen that is
			 * showing program exactly.
			 */
			it('says nothing about a declared media Graphic Input with no accepted value', async () => {
				mockPresence.value = [{ data: { assetAccess: 'absent' } }];
				mockLiveState.value = accepted({});

				const wrapper = await mountComponent([runtimeChosen]);

				expect(wrapper.find('[data-testid="outputs-without-asset-access"]').exists()).toBe(false);
			});

			it('says nothing about a non-media Graphic Input, whatever its accepted value holds', async () => {
				mockPresence.value = [{ data: { assetAccess: 'absent' } }];
				mockLiveState.value = {
					playout: {},
					inputs: {
						promo: {
							working: {},
							accepted: { title: { assetId: 'chosen-asset', revisionId: 'chosen-revision-1' } },
							acceptedRevision: 1,
						},
					},
				} as unknown as BroadcastGraphicsLiveState;

				const wrapper = await mountComponent([{
					...runtimeChosen,
					inputs: [{
						type: 'text',
						key: 'title',
						label: 'Title',
						required: false,
						updatePolicy: 'staged',
						default: '',
						maxLength: 40,
					}],
				}]);

				expect(wrapper.find('[data-testid="outputs-without-asset-access"]').exists()).toBe(false);
			});
		});
	});

	/**
	 * Before #237 this workspace had no way to hand out the output it is watching, so an
	 * operator either walked to the Screen settings page or typed the address they could
	 * see — and a hand-typed URL carries no Screen Output Asset Capability, so what it
	 * opens renders every graphic except its media, silently (#231).
	 */
	describe('handing out the real Overlay Output', () => {
		/** A fresh window per `open`, so a second hand-out can be told from the first. */
		function stubOutputWindows() {
			const opened: Array<{ opener: unknown; location: { href: string }; close: () => void }> = [];
			vi.stubGlobal('open', vi.fn(() => {
				const outputWindow = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
				opened.push(outputWindow);
				return outputWindow;
			}));
			return opened;
		}

		function capabilityRequests() {
			return mockApiFetch.mock.calls.filter(([path]) => String(path).endsWith('/asset-capability'));
		}

		function accessUrl(capability: string) {
			return `${window.location.origin}/event/7/screen/main?output=overlay#asset-capability=${capability}`;
		}

		/**
		 * The capability is rotated between mount and the click, and the copied URL has to
		 * carry the new one.
		 *
		 * Asserting only that some capability appears would pass against a value cached
		 * when the workspace mounted, and that is the failure rather than an academic one:
		 * the Screen settings page has a rotate control, so a workspace left open across a
		 * rotation would hand out a URL whose capability is already dead — which loads,
		 * renders, and silently omits every image, video and library font (#231). The
		 * Program monitor above keeps the capability it mounted with; only the hand-out is
		 * obliged to be current.
		 */
		it('copies a URL carrying asset access, obtained at the moment of the hand-out', async () => {
			const wrapper = await mountComponent();
			mockCapabilityResponse.value = 'rotated-capability';

			await wrapper.get('[data-testid="copy-screen-output-url"]').trigger('click');
			await flushPromises();

			expect(mockApiFetch).toHaveBeenCalledWith('/api/events/7/screens/3/asset-capability');
			expect(mockCopyToClipboard).toHaveBeenCalledWith(
				`${window.location.origin}/event/7/screen/main?output=overlay#asset-capability=rotated-capability`,
				expect.objectContaining({
					successTitle: 'Output URL copied',
					successDescription: expect.stringContaining('asset access'),
				}),
			);
		});

		/**
		 * And obtained again on every later hand-out, not once and remembered.
		 *
		 * "At the moment of the hand-out" is only tested by a *second* hand-out: a
		 * capability acquired on the first click and reused after is correct exactly once
		 * and dead from then on. The pins above catch a capability cached at mount and
		 * miss one cached on first use, which is the same defect one click later — #250's
		 * review found exactly that gap on the settings page, where the reviewer's
		 * cache-on-first-use mutant survived the whole suite (#258).
		 *
		 * The rotate control is on the Screen settings page rather than this one, so the
		 * operator this catches is the one who rotated in another tab and came back to a
		 * workspace that has been open across it.
		 */
		it('obtains asset access again for a second copy, rather than reusing the first', async () => {
			const wrapper = await mountComponent();
			// The Program monitor asks once on mount and keeps what it is given; the two
			// counted below are the hand-outs, which are the only ones obliged to be current.
			expect(capabilityRequests()).toHaveLength(1);

			await wrapper.get('[data-testid="copy-screen-output-url"]').trigger('click');
			await flushPromises();
			mockCapabilityResponse.value = 'rotated-capability';
			await wrapper.get('[data-testid="copy-screen-output-url"]').trigger('click');
			await flushPromises();

			expect(capabilityRequests()).toHaveLength(3);
			// The first hand-out carried the old capability, so the second cannot pass by
			// having been rotated all along.
			expect(mockCopyToClipboard).toHaveBeenNthCalledWith(1, accessUrl('program-capability'), expect.anything());
			expect(mockCopyToClipboard).toHaveBeenNthCalledWith(2, accessUrl('rotated-capability'), expect.anything());
		});

		/** The same second hand-out, for the same reason: opening twice must ask twice. */
		it('obtains asset access again for a second open, rather than reusing the first', async () => {
			const opened = stubOutputWindows();
			const wrapper = await mountComponent();
			expect(capabilityRequests()).toHaveLength(1);

			await wrapper.get('[data-testid="open-screen-output"]').trigger('click');
			await flushPromises();
			mockCapabilityResponse.value = 'rotated-capability';
			await wrapper.get('[data-testid="open-screen-output"]').trigger('click');
			await flushPromises();

			expect(capabilityRequests()).toHaveLength(3);
			expect(opened).toHaveLength(2);
			expect(opened[0]!.location.href).toBe(accessUrl('program-capability'));
			expect(opened[1]!.location.href).toBe(accessUrl('rotated-capability'));
			vi.unstubAllGlobals();
		});

		/**
		 * Refused rather than degraded: the empty string is what the clipboard helper
		 * reports as having nothing to copy, and it costs the operator a retry — where a
		 * URL without the capability costs them their media on program and says nothing.
		 *
		 * The words go with it. "Copy failed" would send this operator to the address in
		 * their own browser's bar, which is the media-losing URL the refusal exists to
		 * withhold — so the refusal's reason is the caller's to name (#231, #250, #257).
		 */
		it('copies nothing at all when asset access cannot be obtained, and names why', async () => {
			mockCapabilityResponse.value = null;
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="copy-screen-output-url"]').trigger('click');
			await flushPromises();

			expect(mockCopyToClipboard).toHaveBeenCalledWith('', expect.objectContaining({
				nothingToCopyTitle: 'Nothing copied',
				nothingToCopyDescription: expect.stringContaining('Asset access for this Screen could not be obtained'),
			}));
		});

		/** Rotated between mount and the click here too, for the same reason. */
		it('opens the output in a tab it points only once asset access is in hand', async () => {
			const outputWindow = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
			vi.stubGlobal('open', vi.fn(() => outputWindow));
			const wrapper = await mountComponent();
			mockCapabilityResponse.value = 'rotated-capability';

			await wrapper.get('[data-testid="open-screen-output"]').trigger('click');
			await flushPromises();

			expect(window.open).toHaveBeenCalledWith('', '_blank');
			expect(outputWindow.opener).toBeNull();
			expect(outputWindow.location.href).toBe(
				`${window.location.origin}/event/7/screen/main?output=overlay#asset-capability=rotated-capability`,
			);
			expect(outputWindow.close).not.toHaveBeenCalled();
			vi.unstubAllGlobals();
		});

		it('opens no output, and says why, when asset access cannot be obtained', async () => {
			mockCapabilityResponse.value = null;
			const outputWindow = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
			vi.stubGlobal('open', vi.fn(() => outputWindow));
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="open-screen-output"]').trigger('click');
			await flushPromises();

			expect(outputWindow.location.href).toBe('');
			expect(outputWindow.close).toHaveBeenCalledOnce();
			// The tab opened and closed again, so nothing visibly happened. Left unsaid it
			// reads as a popup blocker rather than as the media-losing hand-out it refused.
			//
			// Exactly once, because `toHaveBeenCalledWith` asks only whether *some* call
			// matched: a handler firing both sentences passes it, and hands the operator
			// two contradictory instructions (#278).
			expect(mockToastAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
				description: expect.stringContaining('Asset access for this Screen could not be obtained'),
			}));
			vi.unstubAllGlobals();
		});

		/**
		 * And the popup blocker it was being mistaken for gets its own words.
		 *
		 * Until #258 both failures arrived as one `false`, so a blocked tab was reported
		 * as an asset access refusal — which tells the operator to try again, and trying
		 * again is blocked identically. The fix an operator needs is in their browser,
		 * and nothing on this page was going to say so.
		 */
		it('names the browser, not asset access, when the output window is blocked', async () => {
			vi.stubGlobal('open', vi.fn(() => null));
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="open-screen-output"]').trigger('click');
			await flushPromises();

			// Counted before it is read. Reading the last call cannot see a spurious
			// earlier one, and with no toast at all the destructure throws `undefined is
			// not iterable` rather than saying what was expected (#278).
			expect(mockToastAdd).toHaveBeenCalledOnce();
			const [reported] = mockToastAdd.mock.calls[0] as [{ description: string }];
			expect(reported.description).toContain('pop-up');
			expect(reported.description).not.toContain('Asset access');
			vi.unstubAllGlobals();
		});

		/**
		 * The #234 precedent: a control says what it does. An operator choosing between
		 * these and the address in their browser's bar has to be able to see that only
		 * these two resolve media.
		 */
		it('names both controls by what they hand out and what the hand-out carries', async () => {
			const wrapper = await mountComponent();

			const open = wrapper.get('[data-testid="open-screen-output"]');
			const copy = wrapper.get('[data-testid="copy-screen-output-url"]');
			expect(open.text()).toBe('Open output');
			expect(copy.text()).toBe('Copy output URL');
			expect(open.attributes('title')).toContain('asset access');
			expect(copy.attributes('title')).toContain('asset access');
		});
	});

	/**
	 * Broadcast Graphic Template actions are authoring, and the Live workspace is not
	 * an authoring surface. Nothing here may save, place, rename, or delete a design:
	 * a live operator's Screen must not change shape under them.
	 */
	it('offers no Broadcast Graphic Template action anywhere in the Live workspace', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="template-library"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-place"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-library-save"]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain('Template');
	});

	/**
	 * Authoring a Graphic Source Selection or a Graphic Input Binding is the same kind
	 * of structural change as a template action, and belongs to the same side of the
	 * split: Live Control selects declared sources and edits values, and can never
	 * author a binding, a query, or an expression.
	 */
	it('offers no Graphic Source Selection or Graphic Input Binding authoring', async () => {
		const wrapper = await mountComponent([
			{
				...slate,
				inputs: [{
					type: 'text',
					key: 'name',
					label: 'Name',
					required: false,
					updatePolicy: 'staged',
					default: '',
					maxLength: 200,
				}],
				sources: [{ key: 'player', label: 'Player', kind: 'player' }],
				bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
			},
		], 'slate');

		expect(wrapper.find('[data-testid="graphic-event-data-bindings"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="graphic-source-add"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="graphic-source-delete"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="graphic-binding-source"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="graphic-binding-field"]').exists()).toBe(false);
	});

	it('loads the authoritative playout snapshot for the Screen', async () => {
		await mountComponent();

		expect(mockLoadSession).toHaveBeenCalledWith(7, 3);
	});

	it('lists every placed Broadcast Graphic with its Graphic Playout State', async () => {
		mockLiveState.value = { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} };

		const wrapper = await mountComponent();

		expect(entryFor(wrapper, 'lower-third').attributes('data-playout-state')).toBe('off');
		expect(entryFor(wrapper, 'slate').attributes('data-playout-state')).toBe('on-air');
	});

	it('takes a Broadcast Graphic on air', async () => {
		const wrapper = await mountComponent();

		await entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').trigger('click');

		expect(mockTake).toHaveBeenCalledWith(7, 3, 'slate', false);
	});

	it('takes a Broadcast Graphic off air', async () => {
		mockLiveState.value = { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} };
		const wrapper = await mountComponent();

		await entryFor(wrapper, 'slate').get('[data-testid="playout-out"]').trigger('click');

		expect(mockOut).toHaveBeenCalledWith(7, 3, 'slate', false);
	});

	it('offers Cut variants of both actions', async () => {
		const wrapper = await mountComponent();

		await entryFor(wrapper, 'slate').get('[data-testid="playout-cut-take"]').trigger('click');
		await entryFor(wrapper, 'slate').get('[data-testid="playout-cut-out"]').trigger('click');

		expect(mockTake).toHaveBeenCalledWith(7, 3, 'slate', true);
		expect(mockOut).toHaveBeenCalledWith(7, 3, 'slate', true);
	});

	it('keeps both actions available so a repeat converges on the operator’s latest intent', async () => {
		mockLiveState.value = { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} };
		const wrapper = await mountComponent();
		const entry = entryFor(wrapper, 'slate');

		expect(entry.get('[data-testid="playout-take"]').attributes('disabled')).toBeUndefined();
		expect(entry.get('[data-testid="playout-out"]').attributes('disabled')).toBeUndefined();
	});

	it('reports how many Broadcast Graphics are on air', async () => {
		mockLiveState.value = { playout: { 'slate': { onAir: true, effectiveStartedAt: 0, cut: false }, 'lower-third': { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} };

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="on-air-count"]').text()).toContain('2');
	});

	it('shows an empty stack rather than playout controls when nothing is placed', async () => {
		const wrapper = await mountComponent([]);

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('No Broadcast Graphics');
		expect(wrapper.find('[data-playout-entry]').exists()).toBe(false);
	});

	it('disables a Broadcast Graphic’s own actions while its action is in flight, and no others', async () => {
		mockPendingGraphicIds.value = ['slate'];

		const wrapper = await mountComponent();

		const slate = entryFor(wrapper, 'slate');
		expect(slate.get('[data-testid="playout-take"]').attributes('disabled')).toBeDefined();
		expect(slate.get('[data-testid="playout-out"]').attributes('disabled')).toBeDefined();
		expect(slate.get('[data-testid="playout-cut-take"]').attributes('disabled')).toBeDefined();
		expect(entryFor(wrapper, 'lower-third').get('[data-testid="playout-take"]').attributes('disabled')).toBeUndefined();
	});

	it('surfaces a failed playout action instead of failing silently on air', async () => {
		mockError.value = 'Broadcast graphics live session has ended';

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="playout-error"]').text()).toContain('live session has ended');
		// Nothing refused it, so it is what it says: an action this client could not
		// complete.
		expect(wrapper.get('[data-testid="playout-error"]').text()).toContain('Playout action failed');
	});

	it('names a Take the authority refused for what it is, in the words the stack already uses', async () => {
		// The pre-check blocks this before the button in the ordinary case, so what gets
		// here is the residual race and the second operator on stale data — the moment an
		// operator has nothing else to go on. "Playout action failed" said neither what
		// was wrong nor what to do about it (#230).
		mockError.value = 'Graphic Asset Reference at graphics.promo.items.sting.asset is missing, '
			+ 'so this Broadcast Graphic cannot be taken on air';
		mockRefusal.value = { code: 'missing-asset-reference', message: mockError.value };

		const wrapper = await mountComponent();

		const alert = wrapper.get('[data-testid="playout-error"]');
		expect(alert.text()).toContain('Missing Graphic Asset Reference');
		expect(alert.text()).toContain('graphics.promo.items.sting.asset');
		expect(alert.text()).not.toContain('Playout action failed');
	});

	it('separates content that is only temporarily unavailable from a reference that has gone', async () => {
		// Repair or replace it, versus retry: the two refusals prescribe opposite moves,
		// and the title is what tells an operator which one they are looking at.
		mockError.value = 'Graphic Asset Content at graphics.promo.items.sting.asset is temporarily '
			+ 'unavailable, so this Broadcast Graphic cannot be taken on air';
		mockRefusal.value = { code: 'unavailable-asset-content', message: mockError.value };

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="playout-error"]').text()).toContain('Unavailable Graphic Asset Content');
	});

	it('still reports a field-scoped refusal, which Live Control may not be on screen to show', async () => {
		// Deliberate double report. Live Control renders only for the selected Broadcast
		// Graphic, so an operator who has selected nothing — or another graphic — would
		// watch a media selection fail in silence. The field keeps the better report,
		// naming the choice; this one exists so there is always some report.
		mockError.value = 'Graphic Asset Reference for Graphic Input badge is missing';
		mockRefusal.value = { code: 'missing-asset-reference', message: mockError.value };

		const wrapper = await mountComponent([lowerThird, slate], null);

		expect(wrapper.find('[data-testid="live-control"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="playout-error"]').text()).toContain('Missing Graphic Asset Reference');
	});

	it('reports a refusal about the show as a refusal rather than as a fault', async () => {
		// A required Graphic Input with no value is the authority answering, and its own
		// sentence already names the thing. It is not given the Graphic Asset words for a
		// failure that has nothing to do with an asset.
		mockError.value = 'Title must have a value before this Broadcast Graphic can go on air';
		mockRefusal.value = { code: 'required-input-unavailable', message: mockError.value };

		const wrapper = await mountComponent();

		const alert = wrapper.get('[data-testid="playout-error"]');
		expect(alert.text()).toContain('Playout action refused');
		expect(alert.text()).toContain('must have a value');
		expect(alert.text()).not.toContain('Graphic Asset');
	});

	it('shows no error banner while playout is healthy', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="playout-error"]').exists()).toBe(false);
	});

	it('selects a Broadcast Graphic without changing what is on air', async () => {
		const wrapper = await mountComponent();

		await entryFor(wrapper, 'slate').get('[data-testid="playout-select"]').trigger('click');

		expect(wrapper.emitted('select')).toEqual([['slate']]);
		expect(mockTake).not.toHaveBeenCalled();
	});

	it('generates Live Control for the Broadcast Graphic the operator selected, and for none until they do', async () => {
		const unselected = await mountComponent();
		expect(unselected.find('[data-testid="live-control"]').exists()).toBe(false);
		expect(unselected.text()).not.toContain('Live Control');

		const selected = await mountComponent([lowerThird, slate], 'slate');
		expect(selected.text()).toContain('Live Control');
	});

	it('gives the Program monitor a capability, so it can resolve media at all', async () => {
		// The monitor is a real Screen Output, not a preview: without a capability in
		// its URL it renders every graphic except its media, silently.
		const wrapper = await mountComponent();

		const src = wrapper.get('[data-testid="program-monitor"]').attributes('src')!;
		expect(src).toContain('output=overlay');
		expect(src).toContain(`#asset-capability=${encodeURIComponent('program-capability')}`);
	});

	/**
	 * The monitor is never pointed at a URL without a capability — not even for the
	 * moment before the capability arrives.
	 *
	 * The capability is fetched asynchronously and starts null, so an iframe bound
	 * straight to the URL navigates on the first render and stays where it navigated:
	 * a real Screen Output rendering this composition without its media, which is not
	 * what program looks like. It would also join this Screen's presence reporting
	 * `absent`, raising the warning above against the operator's own monitor (#231).
	 */
	it('points the monitor nowhere until the capability has been answered for', async () => {
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		mockApiFetch.mockImplementation(async (path: string) => {
			if (String(path).endsWith('/asset-capability')) {
				await pending;
				return { assetCapability: 'program-capability' };
			}
			return mockReferenceStatus.value;
		});

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="program-monitor"]').exists()).toBe(false);
		// Not the failure state either: the answer is simply not in yet.
		expect(wrapper.find('[data-testid="program-monitor-unavailable"]').exists()).toBe(false);

		release();
		await flushPromises();

		expect(wrapper.get('[data-testid="program-monitor"]').attributes('src'))
			.toContain(`#asset-capability=${encodeURIComponent('program-capability')}`);
	});

	/**
	 * And never at all when the answer is no. A capability that failed to load never
	 * retries, so a monitor pointed at a bare URL then is bare for the life of the
	 * page — permanently showing a composition this Screen is not putting on air.
	 */
	it('shows no monitor, and says why, when asset access cannot be obtained', async () => {
		mockCapabilityResponse.value = null;

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="program-monitor"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="program-monitor-unavailable"]').text())
			.toContain('Program monitor unavailable');
	});

	describe('graphic asset references', () => {
		const withMedia: BroadcastGraphicConfig = {
			id: 'slate',
			name: 'Slate',
			items: [{
				type: 'media',
				id: 'logo',
				label: 'Sponsor',
				visible: true,
				anchor: 'top-left',
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				asset: { assetId: 'asset-1' as never, revisionId: 'revision-1' as never },
				mediaKind: 'image',
				fit: 'cover',
				focalPosition: { horizontal: 0.5, vertical: 0.5 },
				opacity: 1,
				playbackRate: 1,
				loop: true,
			}],
		};

		it('blocks Take on a Broadcast Graphic whose Graphic Asset Reference is missing, and says which item', async () => {
			mockReferenceStatus.value = { outcome: 'missing' };

			const wrapper = await mountComponent([lowerThird, withMedia]);

			const entry = entryFor(wrapper, 'slate');
			expect(entry.get('[data-testid="playout-take"]').attributes('disabled')).toBeDefined();
			expect(entry.get('[data-testid="playout-cut-take"]').attributes('disabled')).toBeDefined();
			// Named by the Graphic Item's authored label, which is what an operator can
			// find on the canvas — not by the internal owner slot.
			expect(wrapper.get('[data-testid="playout-asset-blocked-slate"]').text())
				.toContain('Sponsor');
			// Only the owning graphic is invalidated; the rest of the stack still operates.
			expect(entryFor(wrapper, 'lower-third').get('[data-testid="playout-take"]').attributes('disabled'))
				.toBeUndefined();
		});

		it('keeps Out available on an invalidated Broadcast Graphic, so it can leave air', async () => {
			mockReferenceStatus.value = { outcome: 'missing' };
			mockLiveState.value = { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} };

			const wrapper = await mountComponent([lowerThird, withMedia]);

			const entry = entryFor(wrapper, 'slate');
			expect(entry.get('[data-testid="playout-out"]').attributes('disabled')).toBeUndefined();

			await entry.get('[data-testid="playout-out"]').trigger('click');
			expect(mockOut).toHaveBeenCalledWith(7, 3, 'slate', false);
		});

		it('offers a retry for Unavailable Graphic Asset Content, and none for a missing reference', async () => {
			// Unavailable is retryable because the revision still exists; missing is an
			// integrity failure that only a repair in the Edit workspace resolves.
			mockReferenceStatus.value = { outcome: 'unavailable', retryable: true };
			const unavailable = await mountComponent([withMedia]);

			expect(unavailable.get('[data-testid="playout-asset-blocked-slate"]').text()).toContain('Retry');
			expect(unavailable.find('[data-testid="playout-retry-asset-content"]').exists()).toBe(true);

			mockReferenceStatus.value = { outcome: 'missing' };
			const missing = await mountComponent([withMedia]);

			expect(missing.find('[data-testid="playout-retry-asset-content"]').exists()).toBe(false);
		});

		it('leaves every action available when each pinned revision resolves', async () => {
			mockReferenceStatus.value = { outcome: 'available', lifecycleState: 'active', kind: 'image' };

			const wrapper = await mountComponent([withMedia]);

			expect(wrapper.find('[data-testid="playout-asset-blocked-slate"]').exists()).toBe(false);
			expect(entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').attributes('disabled'))
				.toBeUndefined();
		});

		it('keeps a known-broken graphic blocked while a re-check is in flight', async () => {
			// Any edit anywhere in the stack re-runs the check. Falling back to a
			// not-yet-known state would re-enable Take on a graphic already known to be
			// broken — every time somebody touched an unrelated graphic.
			mockReferenceStatus.value = { outcome: 'missing' };
			const wrapper = await mountComponent([lowerThird, withMedia]);
			expect(entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').attributes('disabled'))
				.toBeDefined();

			// A new stack array with the same pinned revision, as an unrelated edit yields.
			await wrapper.setProps({
				graphics: [{ ...lowerThird, name: 'Renamed' }, { ...withMedia }],
			});

			expect(entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').attributes('disabled'))
				.toBeDefined();
			expect(wrapper.find('[data-testid="playout-asset-blocked-slate"]').exists()).toBe(true);
		});

		it('never asks about a Broadcast Graphic that pins no assets at all', async () => {
			const wrapper = await mountComponent([lowerThird]);

			// The monitor still asks for its capability; what must not happen is a
			// revision-status request for a graphic that pins nothing.
			const statusRequests = mockApiFetch.mock.calls
				.map(([path]) => String(path))
				.filter(path => path.includes('/revisions/'));
			expect(statusRequests).toEqual([]);
			expect(entryFor(wrapper, 'lower-third').get('[data-testid="playout-take"]').attributes('disabled'))
				.toBeUndefined();
		});
	});
	describe('a disconnected Live Control', () => {
		it('says so, rather than looking like a Live Control that is up to date', async () => {
			mockConnectionState.value = 'disconnected';

			const wrapper = await mountComponent();

			expect(wrapper.get('[data-testid="playout-disconnected"]').text()).toContain('Disconnected');
		});

		it('withholds every playout action, so nothing is formed offline to be replayed later', async () => {
			mockConnectionState.value = 'disconnected';

			const wrapper = await mountComponent();

			const entry = entryFor(wrapper, 'slate');
			for (const action of ['playout-take', 'playout-cut-take', 'playout-out', 'playout-cut-out'])
				expect(entry.get(`[data-testid="${action}"]`).attributes('disabled')).toBeDefined();
		});

		it('queues nothing: a click while disconnected sends no command then and none on reconnection', async () => {
			mockConnectionState.value = 'disconnected';
			const wrapper = await mountComponent();

			await entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').trigger('click');
			expect(mockTake).not.toHaveBeenCalled();

			mockConnectionState.value = 'connected';
			await flushPromises();

			// A playout intent states what should be on air *now*. Replaying one formed
			// during an outage would put a graphic on program the operator decided about
			// minutes ago and has since watched not happen.
			expect(mockTake).not.toHaveBeenCalled();
		});

		it('reloads the authoritative snapshot on reconnection, because nothing arrives late', async () => {
			mockConnectionState.value = 'disconnected';
			await mountComponent();
			mockLoadSession.mockClear();

			mockConnectionState.value = 'connected';
			await flushPromises();

			expect(mockLoadSession).toHaveBeenCalledWith(7, 3);
		});

		it('holds its last known state rather than blanking the stack', async () => {
			// Live Control shows the same thing a disconnected output shows: what was last
			// accepted. A dropped websocket is not news about what is on air.
			mockLiveState.value = { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} };
			const wrapper = await mountComponent();

			mockConnectionState.value = 'disconnected';
			await flushPromises();

			expect(entryFor(wrapper, 'slate').attributes('data-playout-state')).toBe('on-air');
		});

		it('shows no disconnection while the first connection is still being made', async () => {
			mockConnectionState.value = 'connecting';

			const wrapper = await mountComponent();

			expect(wrapper.find('[data-testid="playout-disconnected"]').exists()).toBe(false);
		});
	});

	describe('durable live state that could not be recovered', () => {
		it('states the fault prominently and says what puts a graphic back on air', async () => {
			mockRecoveryFault.value = { reason: 'corrupt', detail: 'the playout record for slate is not a record' };

			const wrapper = await mountComponent();

			const fault = wrapper.get('[data-testid="playout-recovery-fault"]');
			expect(fault.text()).toContain('the playout record for slate is not a record');
			expect(fault.text()).toMatch(/transparent/i);
			// The recovery action, named: an operator will not guess that a Take is what
			// clears this.
			expect(fault.text()).toMatch(/Take/);
		});

		it('leaves Take available, because Take is the recovery', async () => {
			mockRecoveryFault.value = { reason: 'missing', detail: 'no durable live state' };

			const wrapper = await mountComponent();

			expect(entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').attributes('disabled'))
				.toBeUndefined();
		});

		it('shows no fault while live state reads normally', async () => {
			const wrapper = await mountComponent();

			expect(wrapper.find('[data-testid="playout-recovery-fault"]').exists()).toBe(false);
		});
	});

	describe('resetting live state', () => {
		it('resets only after the operator confirms', async () => {
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="playout-reset-live-state"]').trigger('click');
			await flushPromises();

			expect(mockResetLiveState).toHaveBeenCalledWith(7, 3);
		});

		it('does nothing when the operator cancels', async () => {
			mockConfirmResult.value = false;
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="playout-reset-live-state"]').trigger('click');
			await flushPromises();

			expect(mockResetLiveState).not.toHaveBeenCalled();
		});

		it('warns that prepared Graphic Input values go with it', async () => {
			// The one action that discards staged work, so the confirmation has to say so
			// — a mode change deliberately preserves it, and an operator will expect the
			// same here unless told otherwise.
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="playout-reset-live-state"]').trigger('click');
			await flushPromises();

			expect(mockConfirmOpen).toHaveBeenCalledWith(expect.objectContaining({
				description: expect.stringMatching(/Graphic Input values are discarded/),
			}));
		});
	});
	describe('a rundown organised by Graphic Channel', () => {
		const alpha: BroadcastGraphicConfig = { id: 'alpha', name: 'Alpha', items: [], channelId: 'thirds' };
		const bravo: BroadcastGraphicConfig = { id: 'bravo', name: 'Bravo', items: [], channelId: 'thirds' };
		const thirds: GraphicChannelConfig = { id: 'thirds', name: 'Lower thirds', handoff: 'out-then-in' };

		it('groups each Graphic Channel\'s members together and names its Handoff Policy', async () => {
			const wrapper = await mountComponent([alpha, bravo, slate], null, [thirds]);

			const headings = wrapper.findAll('[data-testid="playout-channel-heading"]');
			expect(headings.map(heading => heading.text())).toEqual([
				'Lower thirdsOut then in',
				'No Graphic Channel',
			]);

			const channelled = wrapper.get('[data-playout-channel="thirds"]');
			expect(channelled.findAll('[data-playout-entry]').map(entry => entry.attributes('data-playout-entry')))
				.toEqual(['bravo', 'alpha']);
		});

		it('states a Graphic Channel that declares no policy as Overlap', async () => {
			const wrapper = await mountComponent([alpha, bravo], null, [{ id: 'thirds', name: 'Lower thirds' }]);

			expect(wrapper.get('[data-testid="playout-channel-policy"]').text()).toBe('Overlap');
		});

		it('leaves a Screen with no Graphic Channels reading as one flat stack', async () => {
			const wrapper = await mountComponent();

			expect(wrapper.find('[data-testid="playout-channel-heading"]').exists()).toBe(false);
			expect(wrapper.findAll('[data-playout-entry]').map(entry => entry.attributes('data-playout-entry')))
				.toEqual(['slate', 'lower-third']);
		});

		it('reads a Broadcast Graphic its channel is holding as waiting, and not as on air', async () => {
			// alpha is on its way off program; bravo is the channel's latest selection and
			// is held off every output until that exit completes.
			mockLiveState.value = {
				playout: {
					alpha: { onAir: false, effectiveStartedAt: mockServerNow.value, cut: false },
					bravo: { onAir: true, effectiveStartedAt: mockServerNow.value + 500, cut: false },
				},
				inputs: {},
			};
			const animated = (id: string, name: string): BroadcastGraphicConfig => ({
				id,
				name,
				items: [],
				channelId: 'thirds',
				animation: { exit: { duration: 500, easing: 'linear', delay: 0, fade: { opacity: 0 } } },
			});
			const wrapper = await mountComponent([animated('alpha', 'Alpha'), animated('bravo', 'Bravo')], null, [thirds]);

			expect(entryFor(wrapper, 'bravo').attributes('data-playout-state')).toBe('waiting');
			expect(entryFor(wrapper, 'alpha').attributes('data-playout-state')).toBe('exiting');
			// A waiting graphic is absent from every program output, so it is not counted.
			expect(wrapper.get('[data-testid="on-air-count"]').text()).toBe('1 of 2 on air');
		});
	});
});
