import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import {
	createInitialBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import { liveSessionSelectors } from '~~/test/nuxt/helpers/broadcastGraphicsLiveSessionReads';
import ProgramMonitor from '~/components/Screen/Modes/BroadcastGraphics/ProgramMonitor.vue';
import { ScreenSettingsSectionStub } from '~~/test/nuxt/helpers/screenSettingsSection';

enableAutoUnmount(afterEach);

const mockLiveState = ref<BroadcastGraphicsLiveState>(createInitialBroadcastGraphicsLiveState());
/** The authoritative clock the real store derives from a server offset. */
const mockServerNow = ref(1_700_000_000_000);
const mockSessions = ref(new Map<number, { id: number; sequence: number }>());

mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({
	...liveSessionSelectors(() => mockLiveState.value, () => mockServerNow.value),
	get sessions() {
		return mockSessions.value;
	},
	// The monitor animates nothing itself; a settled projection lets its clock stop.
	animationProjection: () => ({}),
}));

// What the Screen Outputs watching this Screen report about themselves.
const mockPresence = ref<Array<{ data?: { assetAccess?: 'granted' | 'absent' } }>>([]);

mockNuxtImport('useScreenStore', () => () => ({
	get screenPresence() {
		return new Map([
			[
				3,
				{ count: mockPresence.value.length, members: mockPresence.value },
			],
		]);
	},
}));

/** What the Screen Output Asset Capability endpoint issues, if anything. */
const mockCapabilityResponse = ref<string | null>('program-capability');
const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));

mockNuxtImport('$fetch', () => mockApiFetch);

mockNuxtImport('useToast', () => () => ({
	add: vi.fn(),
}));

const UAlertStub = defineComponent({
	props: {
		title: { type: String, required: false },
		description: { type: String, required: false },
	},
	template: '<div><strong>{{ title }}</strong><span>{{ description }}</span></div>',
});

const UFieldGroupStub = defineComponent({ template: '<div><slot /></div>' });
const USelectStub = defineComponent({
	name: 'USelect',
	props: {
		modelValue: { type: String, required: false },
		items: {
			type: Array,
			default: () => [],
		},
	},
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
});
const UButtonStub = defineComponent({
	name: 'UButton',
	props: {
		disabled: { type: Boolean, default: false },
	},
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const lowerThird: BroadcastGraphicConfig = { id: 'lower-third', name: 'Lower Third', items: [] };
const slate: BroadcastGraphicConfig = { id: 'slate', name: 'Slate', items: [] };

async function mountComponent(
	graphics: BroadcastGraphicConfig[] = [lowerThird, slate],
	compact = false,
) {
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
				ScreenSettingsSection: ScreenSettingsSectionStub,
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

	// The monitor is the operator's own view of program, not one of the Screen's outputs, and says
	// so in its URL.
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

	// The monitor is never pointed at a URL without a capability — not even for the moment before
	// the capability arrives.
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

	// And never at all when the answer is no.
	it('shows no monitor, and says why, when asset access cannot be obtained', async () => {
		mockCapabilityResponse.value = null;

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="program-monitor"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="program-monitor-unavailable"]').text())
			.toContain('Program monitor unavailable');
	});

	// Story 23 asks for a *persistent* monitor: one the operator always has, in both workspaces.
	it('offers no collapse: a Program monitor that can be hidden is not persistent', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.getComponent(ScreenSettingsSectionStub).props('collapsible')).toBe(false);
	});

	// In the Edit workspace the monitor shares the viewport with the authoring tree, preview, and
	// inspector, so it draws smaller — but it is the same monitor, composing playout through the…
	it('draws compactly where space is shared, at the same canvas ratio', async () => {
		const wrapper = await mountComponent([lowerThird, slate], true);

		const style = wrapper.get('[data-testid="program-monitor"]').element.parentElement?.getAttribute('style') ?? '';
		expect(style).toContain('aspect-ratio: 1920 / 1080');
	});

	// The Program monitor resolves media through the same capability a Screen Output does and
	// always holds one, so it cannot show an operator what a capture browser opened without one is…
	describe('outputs that cannot resolve this Screen’s media', () => {
		const branded: BroadcastGraphicConfig = {
			id: 'branded',
			name: 'Branded slate',
			items: [
				{
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
				},
			],
		};

		it('names an output that reported it cannot', async () => {
			mockPresence.value = [
				{
					data: { assetAccess: 'absent' },
				},
			];

			const wrapper = await mountComponent([branded]);

			expect(wrapper.get('[data-testid="outputs-without-asset-access"]').text())
				.toContain('One Screen Output cannot resolve this Screen\'s assets');
		});

		// A Screen publishing nothing but Shapes and Text loses nothing to a missing capability,
		// and warning about it would teach an operator to ignore the warning that matters.
		it('says nothing when the Screen publishes no media', async () => {
			mockPresence.value = [
				{
					data: { assetAccess: 'absent' },
				},
			];

			const wrapper = await mountComponent([lowerThird]);

			expect(wrapper.find('[data-testid="outputs-without-asset-access"]').exists()).toBe(false);
		});

		/**
		 * An output that reports nothing is silent about its asset access rather than
		 * lacking it, and a silence is not a fault to put in front of an operator.
		 */
		it('says nothing about an output that reported nothing', async () => {
			mockPresence.value = [
				{ data: {} },
				{},
			];

			const wrapper = await mountComponent([branded]);

			expect(wrapper.find('[data-testid="outputs-without-asset-access"]').exists()).toBe(false);
		});

		it('says nothing when every open output holds its capability', async () => {
			mockPresence.value = [
				{
					data: { assetAccess: 'granted' },
				},
			];

			const wrapper = await mountComponent([branded]);

			expect(wrapper.find('[data-testid="outputs-without-asset-access"]').exists()).toBe(false);
		});

		// A Broadcast Graphics Screen publishes from two places, and only one of them is in its
		// authored configuration.
		describe('media that arrives only through a live Graphic Input', () => {
			/** Nothing authored pins an asset: the only media here is chosen at runtime. */
			const runtimeChosen: BroadcastGraphicConfig = {
				id: 'promo',
				name: 'Promo',
				items: [],
				inputs: [
					{
						type: 'media',
						key: 'backdrop',
						label: 'Backdrop',
						required: false,
						updatePolicy: 'staged',
						mediaKind: 'image',
						default: null,
					},
				],
			};

			function accepted(value: Record<string, unknown>) {
				return {
					playout: {},
					inputs: {
						promo: { working: {}, accepted: value, acceptedRevision: 1 },
					},
				} as unknown as BroadcastGraphicsLiveState;
			}

			it('warns about an output that cannot resolve a value the operator chose live', async () => {
				mockPresence.value = [
					{
						data: { assetAccess: 'absent' },
					},
				];
				mockLiveState.value = accepted({
					backdrop: { assetId: 'chosen-asset', revisionId: 'chosen-revision-1' },
				});

				const wrapper = await mountComponent([runtimeChosen]);

				expect(wrapper.get('[data-testid="outputs-without-asset-access"]').text())
					.toContain('One Screen Output cannot resolve this Screen\'s assets');
			});

			// The half that keeps the widening honest.
			it('says nothing about a declared media Graphic Input with no accepted value', async () => {
				mockPresence.value = [
					{
						data: { assetAccess: 'absent' },
					},
				];
				mockLiveState.value = accepted({});

				const wrapper = await mountComponent([runtimeChosen]);

				expect(wrapper.find('[data-testid="outputs-without-asset-access"]').exists()).toBe(false);
			});

			it('says nothing about a non-media Graphic Input, whatever its accepted value holds', async () => {
				mockPresence.value = [
					{
						data: { assetAccess: 'absent' },
					},
				];
				mockLiveState.value = {
					playout: {},
					inputs: {
						promo: {
							working: {},
							accepted: {
								title: { assetId: 'chosen-asset', revisionId: 'chosen-revision-1' },
							},
							acceptedRevision: 1,
						},
					},
				} as unknown as BroadcastGraphicsLiveState;

				const wrapper = await mountComponent([
					{
						...runtimeChosen,
						inputs: [
							{
								type: 'text',
								key: 'title',
								label: 'Title',
								required: false,
								updatePolicy: 'staged',
								default: '',
								maxLength: 40,
							},
						],
					},
				]);

				expect(wrapper.find('[data-testid="outputs-without-asset-access"]').exists()).toBe(false);
			});
		});
	});

	// Wiring only: the shared hand-out owns its controls and their words.
	it('hands out this Screen\'s Overlay Output where the operator watches it', async () => {
		const outputWindow = {
			opener: {} as unknown,
			location: { href: '' },
			close: vi.fn(),
		};
		vi.stubGlobal('open', vi.fn(() => outputWindow));
		const wrapper = await mountComponent();

		await wrapper.get('[data-hand-out="open"]').trigger('click');
		await flushPromises();

		expect(outputWindow.location.href).toBe(
			`${window.location.origin}/event/7/screen/main?output=overlay#asset-capability=program-capability`,
		);
		vi.unstubAllGlobals();
	});
});
