import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig, GraphicInputValue } from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import {
	broadcastGraphicPhaseTiming,
	broadcastGraphicRenderedInputs,
	createInitialBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';

enableAutoUnmount(afterEach);

const mockLiveState = ref<BroadcastGraphicsLiveState>(createInitialBroadcastGraphicsLiveState());
/** The authoritative clock the real store derives from a server offset. */
const mockServerNow = ref(1_700_000_000_000);
const mockSessions = ref(new Map<number, { id: number; sequence: number }>());

mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({
	get sessions() {
		return mockSessions.value;
	},
	serverNow: () => mockServerNow.value,
	// The monitor never animates anything itself; an empty projection is a settled
	// Screen, which is what lets its clock stop.
	animationProjection: () => ({}),
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
	name: 'ScreenSettingsCard',
	props: {
		title: { type: String, required: false },
		collapsible: { type: Boolean, default: true },
	},
	template: '<section><h2>{{ title }}</h2><slot name="actions" :open="true" /><slot /></section>',
});

const UFieldGroupStub = defineComponent({ template: '<div><slot /></div>' });
const USelectStub = defineComponent({
	name: 'USelect',
	props: { modelValue: { type: String, required: false }, items: { type: Array, default: () => [] } },
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
});
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
	compact = false,
) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/BroadcastGraphics/ProgramMonitor.vue';
	const { default: ProgramMonitor } = await import(componentPath);

	const wrapper = mount(ProgramMonitor, {
		props: {
			eventId: 7,
			screen: { id: 3, slug: 'main' } as Screen,
			graphics,
			channels: [],
			canvasWidth: 1920,
			canvasHeight: 1080,
			compact,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UFieldGroup: UFieldGroupStub,
				USelect: USelectStub,
				UButton: UButtonStub,
				UAlert: UAlertStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('broadcastGraphicsProgramMonitor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLiveState.value = createInitialBroadcastGraphicsLiveState();
		mockPresence.value = [];
		mockCapabilityResponse.value = 'program-capability';
		mockApiFetch.mockImplementation(async (path: string) => {
			if (String(path).endsWith('/asset-capability')) {
				if (!mockCapabilityResponse.value)
					throw new Error('no capability');
				return { assetCapability: mockCapabilityResponse.value };
			}
			throw new Error(`unexpected request: ${String(path)}`);
		});
	});

	it('gives the Program monitor a capability, so it can resolve media at all', async () => {
		// The monitor renders as a live output does, not as a preview: without a
		// capability in its URL it renders every graphic except its media, silently.
		const wrapper = await mountComponent();

		const src = wrapper.get('[data-testid="program-monitor"]').attributes('src')!;
		expect(src).toContain('output=overlay');
		expect(src).toContain(`#asset-capability=${encodeURIComponent('program-capability')}`);
	});

	/**
	 * The monitor is the operator's own view of program, not one of the Screen's
	 * outputs, and says so in its URL.
	 *
	 * Without that it joined this Screen's presence like any output, so the Live
	 * workspace reported one client live with nothing open anywhere — and the Open
	 * Screen Output Engines named the operator's own browser among the engines a
	 * Graphic Asset Revision's cost is stated against.
	 *
	 * `embed=monitor` rather than `embed=preview`, because a preview composes the
	 * stack an editor pushes it instead of loading playout, and resolves media as an
	 * author instead of through the capability. A monitor showing either is not
	 * showing program.
	 */
	it('opens the Program monitor as a monitor, so it is not counted as an output', async () => {
		const wrapper = await mountComponent();

		const src = wrapper.get('[data-testid="program-monitor"]').attributes('src')!;
		expect(src).toContain('embed=monitor');
		expect(src).not.toContain('embed=preview');
	});

	it('fits the Program monitor to the canvas ratio and offers fixed zoom controls', async () => {
		const wrapper = await mountComponent();
		const monitor = wrapper.get('[data-testid="program-monitor"]');
		const canvas = monitor.element.parentElement;
		let style = canvas?.getAttribute('style') ?? '';

		expect(style).toContain('aspect-ratio: 1920 / 1080');
		expect(style).toContain('max-width: 100%');
		expect(style).not.toContain('max-height');
		expect(canvas?.classList).toContain('transparent-checkerboard-backdrop');
		expect(canvas?.parentElement?.classList).not.toContain('transparent-checkerboard-backdrop');

		await wrapper.get('[aria-label="50% program monitor zoom"]').trigger('click');
		style = monitor.element.parentElement?.getAttribute('style') ?? '';
		expect(style).toContain('width: 960px');
		expect(style).toContain('height: 540px');
	});

	it('shows Program transparency or a selected solid monitor background', async () => {
		const wrapper = await mountComponent();
		const canvas = wrapper.get('[data-testid="program-monitor"]').element.parentElement!;

		expect(canvas.classList).toContain('transparent-checkerboard-backdrop');
		await wrapper.get('[aria-label="Program monitor background"]').setValue('green');

		expect(canvas.classList).not.toContain('transparent-checkerboard-backdrop');
		expect(canvas.getAttribute('style')).toContain('background-color: #00b140');
	});

	/**
	 * The monitor is never pointed at a URL without a capability — not even for the
	 * moment before the capability arrives.
	 *
	 * The capability is fetched asynchronously and starts null, so an iframe bound
	 * straight to the URL navigates on the first render and stays where it navigated:
	 * a monitor rendering this composition without its media, which is not what
	 * program looks like (#231).
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
			throw new Error(`unexpected request: ${String(path)}`);
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

	/**
	 * Story 23 asks for a *persistent* monitor: one the operator always has, in both
	 * workspaces. A collapse control is a way for it to be absent exactly when the
	 * mistake it guards against happens, so the card offers none — in either
	 * workspace (#335).
	 */
	it('offers no collapse: a Program monitor that can be hidden is not persistent', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.getComponent(ScreenSettingsCardStub).props('collapsible')).toBe(false);
	});

	/**
	 * In the Edit workspace the monitor shares the viewport with the authoring tree,
	 * preview, and inspector, so it draws smaller — but it is the same monitor,
	 * composing playout through the same capability, not a preview (#335).
	 */
	it('draws compactly where space is shared, at the same canvas ratio', async () => {
		const wrapper = await mountComponent([lowerThird, slate], true);

		const style = wrapper.get('[data-testid="program-monitor"]').element.parentElement?.getAttribute('style') ?? '';
		expect(style).toContain('aspect-ratio: 1920 / 1080');
		// Compact halves the monitor's viewport share; the ratio and the composition
		// it shows do not change.
		expect(style).toContain('width: calc(');
		expect(style).toContain('23vh');
	});

	/**
	 * The Program monitor resolves media through the same capability a Screen Output
	 * does and always holds one, so it cannot show an operator what a capture
	 * browser opened without one is showing:
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
	 * Before #237 the Live workspace had no way to hand out the output it is watching,
	 * so an operator either walked to the Screen settings page or typed the address
	 * they could see — and a hand-typed URL carries no Screen Output Asset Capability,
	 * so what it opens renders every graphic except its media, silently (#231).
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
		 * when the monitor mounted, and that is the failure rather than an academic one:
		 * the Screen settings page has a rotate control, so a workspace left open across a
		 * rotation would hand out a URL whose capability is already dead — which loads,
		 * renders, and silently omits every image, video and library font (#231). The
		 * Program monitor keeps the capability it mounted with; only the hand-out is
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
});
