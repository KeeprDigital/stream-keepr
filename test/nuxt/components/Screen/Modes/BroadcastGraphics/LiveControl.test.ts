import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { GraphicBindingDataSet } from '~~/shared/modules/graphics';
import type {
	BroadcastGraphicConfig,
	GraphicInputDeclaration,
	GraphicPlayoutState,
	MediaGraphicInputValue,
} from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import {
	createInitialBroadcastGraphicsLiveState,
	graphicInputTraces,
} from '~~/shared/modules/broadcast-graphics-live-session';
import { createEmptyGraphicBindingDataSet } from '~~/shared/modules/graphics';

enableAutoUnmount(afterEach);

const mockLiveState = ref<BroadcastGraphicsLiveState>(createInitialBroadcastGraphicsLiveState());
const mockSetInput = vi.fn();
const mockSetOverride = vi.fn();
const mockSelectSource = vi.fn();
const mockUpdateGraphic = vi.fn();
const mockSelectSocialProfile = vi.fn();
const mockPreviousSocialProfile = vi.fn();
const mockNextSocialProfile = vi.fn();
/** The Event Data Live Control resolves its bound values and picker options from. */
const mockBindingData = ref<GraphicBindingDataSet>(createEmptyGraphicBindingDataSet());
/** The Graphic Inputs whose last edit from this session lost a field-scoped conflict. */
const mockSupersededInputKeys = ref<string[]>([]);
/** Why the last edit to one Graphic Input was refused, as the store holds it. */
const mockInputRefusals = ref<Record<string, string>>({});
/** The engines of the Screen Outputs currently open on this Screen. */
const mockOpenOutputTargets = ref<string[]>([]);
/** The Graphics Asset Library's answer about one exact revision. */
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({
	setInput: mockSetInput,
	setOverride: mockSetOverride,
	selectSource: mockSelectSource,
	updateGraphic: mockUpdateGraphic,
	selectSocialProfile: mockSelectSocialProfile,
	previousSocialProfile: mockPreviousSocialProfile,
	nextSocialProfile: mockNextSocialProfile,
	socialProfileProjectionState: (_screenId: number, graphicId: string, projectionKey: string) =>
		mockLiveState.value.socialProfileProjections?.[graphicId]?.[projectionKey],
	inputRefusal: (_screenId: number, _graphicId: string, inputKey: string) =>
		mockInputRefusals.value[inputKey],
	sourceSelections: (_screenId: number, graphicId: string) =>
		mockLiveState.value.sources?.[graphicId] ?? {},
	inputTraces: (
		_screenId: number,
		graphic: BroadcastGraphicConfig,
		boundValues: Record<string, unknown> = {},
	) => graphicInputTraces(
		mockLiveState.value,
		graphic.id,
		graphic,
		boundValues as never,
		{
			onAir: mockLiveState.value.playout[graphic.id]?.onAir ?? false,
			supersededInputKeys: mockSupersededInputKeys.value,
		},
	),
}));

mockNuxtImport('useScreenOutputVideoTargets', () => () => computed(() => mockOpenOutputTargets.value));

mockNuxtImport('$fetch', () => mockApiFetch);

mockNuxtImport('useGraphicBindingData', () => () => ({
	dataSet: computed(() => mockBindingData.value),
	selectionOptions: (kind: string) => (kind === 'player'
		? Object.entries(mockBindingData.value.players).map(([id, player]) => ({
				label: player.name ?? id,
				value: Number(id),
			}))
		: []),
}));

const ScreenSettingsCardStub = defineComponent({
	props: { title: { type: String, required: false } },
	template: '<section><h2>{{ title }}</h2><slot /></section>',
});
const UIEmptyStateStub = defineComponent({
	props: { title: { type: String, required: false } },
	template: '<div data-testid="empty-state">{{ title }}</div>',
});
const UAlertStub = defineComponent({
	props: { title: { type: String, required: false }, description: { type: String, required: false } },
	template: '<div>{{ title }} {{ description }}</div>',
});
const UBadgeStub = defineComponent({ template: '<span><slot /></span>' });
const UFieldGroupStub = defineComponent({ template: '<div><slot /></div>' });
const UButtonStub = defineComponent({
	props: { disabled: { type: Boolean, default: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});
const UInputStub = defineComponent({
	props: { modelValue: { type: [String, Number], default: '' } },
	emits: ['update:modelValue', 'blur'],
	template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @blur="$emit(\'blur\')" >',
});
const UInputNumberStub = defineComponent({
	props: { modelValue: { type: Number, default: undefined } },
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" >',
});
const USwitchStub = defineComponent({
	props: { modelValue: { type: Boolean, default: false } },
	emits: ['update:modelValue'],
	template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', !modelValue)" >',
});
const USelectStub = defineComponent({
	props: { modelValue: { type: String, default: undefined }, items: { type: Array, default: () => [] } },
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
});

/** The revision already staged, and the one the stubbed picker returns. */
const PINNED = {
	assetId: 'asset-badge',
	revisionId: 'revision-badge-1',
} as unknown as MediaGraphicInputValue;
const CHOSEN = {
	assetId: 'asset-badge',
	revisionId: 'revision-badge-2',
} as unknown as MediaGraphicInputValue;

/**
 * The Graphics Asset Library picker, stubbed at the seam Live Control uses it
 * through: it is handed the kinds it may offer and the engines open now, and it
 * hands back one exact Graphic Asset Revision.
 */
const GraphicsAssetFocusPickerStub = defineComponent({
	name: 'GraphicsAssetFocusPicker',
	props: {
		modelValue: { type: Object, default: undefined },
		eventId: { type: Number, required: true },
		fieldLabel: { type: String, required: true },
		assetKind: { type: [String, Array], default: 'image' },
		videoTarget: { type: String, default: 'other' },
		openOutputTargets: { type: Array, default: () => [] },
		disabled: { type: Boolean, default: false },
		clearable: { type: Boolean, default: true },
	},
	emits: ['update:modelValue', 'select'],
	setup(props, { emit }) {
		return () => h('button', {
			type: 'button',
			disabled: props.disabled,
			onClick: () => emit(
				'select',
				{ id: CHOSEN.assetId, kind: 'image', revisionId: CHOSEN.revisionId },
				{ ...CHOSEN },
			),
		}, 'Choose Graphic Asset');
	},
});

const NAME: GraphicInputDeclaration = {
	type: 'text',
	key: 'name',
	label: 'Presenter name',
	required: false,
	updatePolicy: 'staged',
	default: 'Unnamed',
	maxLength: 20,
};

const TITLE: GraphicInputDeclaration = {
	type: 'text',
	key: 'title',
	label: 'Title',
	required: true,
	updatePolicy: 'staged',
	default: '',
	maxLength: 20,
};

const BADGE: GraphicInputDeclaration = {
	type: 'media',
	key: 'badge',
	label: 'Badge',
	required: false,
	updatePolicy: 'staged',
	default: null,
	mediaKind: 'image',
};

function graphic(inputs: GraphicInputDeclaration[], overrides: Partial<BroadcastGraphicConfig> = {}): BroadcastGraphicConfig {
	return { id: 'lower-third', name: 'Lower Third', items: [], inputs, ...overrides };
}

async function mountComponent(
	config: BroadcastGraphicConfig,
	playoutState: GraphicPlayoutState = 'off',
	disconnected = false,
	pending = false,
) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/BroadcastGraphics/LiveControl.vue';
	const { default: LiveControl } = await import(componentPath);

	const wrapper = mount(LiveControl, {
		props: {
			eventId: 7,
			screen: { id: 3, slug: 'main' } as Screen,
			graphic: config,
			playoutState,
			disconnected,
			pending,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UIEmptyState: UIEmptyStateStub,
				UAlert: UAlertStub,
				UBadge: UBadgeStub,
				UFieldGroup: UFieldGroupStub,
				UButton: UButtonStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
				USwitch: USwitchStub,
				USelect: USelectStub,
				GraphicsAssetFocusPicker: GraphicsAssetFocusPickerStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('broadcastGraphicsLiveControl', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLiveState.value = createInitialBroadcastGraphicsLiveState();
		mockBindingData.value = createEmptyGraphicBindingDataSet();
		mockSupersededInputKeys.value = [];
		mockInputRefusals.value = {};
		mockOpenOutputTargets.value = [];
		mockApiFetch.mockReset();
		mockApiFetch.mockResolvedValue({ outcome: 'available', lifecycleState: 'active', kind: 'image' });
	});

	/**
	 * Generated Live Control is exactly the controls a template author declared —
	 * source pickers and typed Graphic Inputs. A template action would be an
	 * authoring control appearing in the one surface that never authors.
	 */
	it('generates no Broadcast Graphic Template action for a live operator', async () => {
		const wrapper = await mountComponent(graphic([]));

		expect(wrapper.find('[data-testid="template-library"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-place"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-name"]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain('Template');
	});

	it('generates one type-appropriate field for each declared Graphic Input', async () => {
		const wrapper = await mountComponent(graphic([
			NAME,
			{ type: 'number', key: 'score', label: 'Score', required: false, updatePolicy: 'live', default: 0, integer: true },
			{ type: 'toggle', key: 'flag', label: 'Flag', required: false, updatePolicy: 'staged', default: false },
			{ type: 'choice', key: 'side', label: 'Side', required: false, updatePolicy: 'staged', default: 'left', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
			{ type: 'color', key: 'accent', label: 'Accent', required: false, updatePolicy: 'staged', default: '#00d9ff' },
			{ type: 'media', key: 'badge', label: 'Badge', required: false, updatePolicy: 'staged', default: null, mediaKind: 'image' },
		]));

		expect(wrapper.findAll('[data-graphic-input]')).toHaveLength(6);
		expect(wrapper.get('[data-testid="live-control-field-name"]').element.tagName).toBe('INPUT');
		expect(wrapper.get('[data-testid="live-control-field-score"]').attributes('type')).toBe('number');
		expect(wrapper.get('[data-testid="live-control-field-flag"]').attributes('type')).toBe('checkbox');
		expect(wrapper.get('[data-testid="live-control-field-side"]').element.tagName).toBe('SELECT');
		expect(wrapper.find('[data-testid="live-control-clear-badge"]').exists()).toBe(true);
	});

	it('offers nothing to operate when the Broadcast Graphic declares no Graphic Inputs', async () => {
		const wrapper = await mountComponent(graphic([]));

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('No Graphic Inputs');
	});

	it('shows authoritative Social Profile Projection controls and read-only authored timing', async () => {
		mockLiveState.value = {
			...createInitialBroadcastGraphicsLiveState(),
			socialProfileProjections: {
				'lower-third': { profile: {
					talent: { id: 7, name: 'Ava Reed' },
					acceptedProfiles: [
						{ network: 'twitch', networkLabel: 'Twitch', handle: 'AvaLive', profileUrl: 'https://www.twitch.tv/AvaLive' },
						{ network: 'x', networkLabel: 'X', handle: 'AvaCasts', profileUrl: 'https://x.com/AvaCasts' },
					],
					currentNetwork: 'twitch',
				} },
			},
		};
		const wrapper = await mountComponent(graphic([], {
			sources: [{ key: 'talent', label: 'Talent', kind: 'talent' }],
			socialProfileProjections: [{
				key: 'profile',
				label: 'Social Profile',
				sourceKey: 'talent',
				presentationGroupId: 'profile-group',
				dwellMs: 8_000,
				transition: 'crossfade',
				transitionDurationMs: 250,
			}],
		}));
		const control = wrapper.get('[data-social-profile-projection="profile"]');

		expect(control.text()).toContain('Ava Reed');
		expect(control.text()).toContain('Available');
		expect(control.get('[data-testid="live-control-social-profile-profile"]').findAll('option').map(option => option.text()))
			.toEqual(['Twitch — @AvaLive', 'X — @AvaCasts']);
		expect(control.get('[data-testid="live-control-social-profile-timing"]').text())
			.toContain('8 seconds · Crossfade · 250 ms');
		expect(control.find('input').exists()).toBe(false);

		await control.get('[data-testid="live-control-social-profile-profile"]').setValue('x');
		await control.get('[data-testid="live-control-social-profile-previous-profile"]').trigger('click');
		await control.get('[data-testid="live-control-social-profile-next-profile"]').trigger('click');

		expect(mockSelectSocialProfile).toHaveBeenCalledWith(7, 3, 'lower-third', 'profile', 'x');
		expect(mockPreviousSocialProfile).toHaveBeenCalledWith(7, 3, 'lower-third', 'profile');
		expect(mockNextSocialProfile).toHaveBeenCalledWith(7, 3, 'lower-third', 'profile');
	});

	it('keeps many-profile controls operable while an earlier command is pending', async () => {
		mockLiveState.value = {
			...createInitialBroadcastGraphicsLiveState(),
			socialProfileProjections: {
				'lower-third': { profile: {
					talent: { id: 7, name: 'Ava Reed' },
					acceptedProfiles: [
						{ network: 'twitch', networkLabel: 'Twitch', handle: 'AvaLive', profileUrl: 'https://www.twitch.tv/AvaLive' },
						{ network: 'x', networkLabel: 'X', handle: 'AvaCasts', profileUrl: 'https://x.com/AvaCasts' },
					],
					currentNetwork: 'twitch',
				} },
			},
		};
		const wrapper = await mountComponent(graphic([], {
			socialProfileProjections: [{
				key: 'profile',
				label: 'Social Profile',
				sourceKey: 'talent',
				presentationGroupId: 'profile-group',
				dwellMs: 8_000,
				transition: 'crossfade',
				transitionDurationMs: 250,
			}],
		}), 'on-air', false, true);
		const control = wrapper.get('[data-social-profile-projection="profile"]');

		expect(control.get('[data-testid="live-control-social-profile-profile"]').attributes('disabled')).toBeUndefined();
		expect(control.get('[data-testid="live-control-social-profile-previous-profile"]').attributes('disabled')).toBeUndefined();
		expect(control.get('[data-testid="live-control-social-profile-next-profile"]').attributes('disabled')).toBeUndefined();
		await control.get('[data-testid="live-control-social-profile-next-profile"]').trigger('click');
		expect(mockNextSocialProfile).toHaveBeenCalledWith(7, 3, 'lower-third', 'profile');
	});

	it.each([
		['zero', [], undefined, 'Unavailable'],
		['one', [{ network: 'twitch' as const, networkLabel: 'Twitch', handle: 'SoloLive', profileUrl: 'https://www.twitch.tv/SoloLive' }], 'twitch', 'Available'],
	] as const)('disables stepping for %s populated Social Profiles', async (_case, acceptedProfiles, currentNetwork, status) => {
		mockLiveState.value = {
			...createInitialBroadcastGraphicsLiveState(),
			socialProfileProjections: {
				'lower-third': { profile: {
					talent: { id: 7, name: 'Solo Caster' },
					acceptedProfiles: [...acceptedProfiles],
					...(currentNetwork ? { currentNetwork } : {}),
				} },
			},
		};
		const wrapper = await mountComponent(graphic([], {
			socialProfileProjections: [{
				key: 'profile',
				label: 'Social Profile',
				sourceKey: 'talent',
				presentationGroupId: 'profile-group',
				dwellMs: 8_000,
				transition: 'crossfade',
				transitionDurationMs: 250,
			}],
		}));
		const control = wrapper.get('[data-social-profile-projection="profile"]');

		expect(control.text()).toContain(status);
		expect(control.get('[data-testid="live-control-social-profile-previous-profile"]').attributes('disabled')).toBeDefined();
		expect(control.get('[data-testid="live-control-social-profile-next-profile"]').attributes('disabled')).toBeDefined();
		expect(control.get('[data-testid="live-control-social-profile-profile"]').attributes('disabled'))
			.toBe(acceptedProfiles.length === 0 ? '' : undefined);
	});

	it('shows the latest bound value, the staged value, and the accepted on-air value apart', async () => {
		mockLiveState.value = {
			playout: { 'lower-third': { onAir: true, effectiveStartedAt: 0, cut: false } },
			inputs: { 'lower-third': { working: { name: 'Ava Reed' }, accepted: { name: 'Unnamed' }, acceptedRevision: 1 } },
		};

		const wrapper = await mountComponent(
			graphic([NAME], { bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }] }),
			'on-air',
		);
		const field = wrapper.get('[data-graphic-input="name"]');

		expect(field.get('[data-testid="live-control-accepted"]').text()).toBe('Unnamed');
		// The binding is declared but nothing resolves it, and an unresolved binding
		// never falls back to the template default — nor to the manual value underneath
		// it. So there is nothing staged, and program is holding a value its source no
		// longer provides.
		expect(field.get('[data-testid="live-control-bound"]').text()).toBe('Unresolved');
		expect(field.get('[data-testid="live-control-working"]').text()).toBe('—');
		expect(field.attributes('data-graphic-input-status')).toBe('stale');
	});

	it('generates one picker for each operator-selected Graphic Source Selection', async () => {
		mockBindingData.value = {
			...createEmptyGraphicBindingDataSet(),
			players: { 1: { name: 'Ava Reed' }, 2: { name: 'Sam Ortiz' } },
		};

		const wrapper = await mountComponent(graphic([NAME], {
			sources: [
				{ key: 'player', label: 'Player', kind: 'player' },
				// Neither of these is picked: the current Event is the Screen's own, and a
				// derived selection follows the one above it.
				{ key: 'event', label: 'Event', kind: 'event' },
				{ key: 'archetype', label: 'Archetype', kind: 'archetype', from: { sourceKey: 'player', relation: 'archetype' } },
			],
		}));

		expect(wrapper.findAll('[data-graphic-source]')).toHaveLength(1);
		expect(wrapper.get('[data-testid="live-control-source-player"]').findAll('option')).toHaveLength(2);
	});

	it('selects and clears a Graphic Source Selection through the authoritative command', async () => {
		mockBindingData.value = {
			...createEmptyGraphicBindingDataSet(),
			players: { 1: { name: 'Ava Reed' } },
		};
		const wrapper = await mountComponent(graphic([NAME], {
			sources: [{ key: 'player', label: 'Player', kind: 'player' }],
		}));

		await wrapper.get('[data-testid="live-control-source-player"]').setValue('1');

		expect(mockSelectSource).toHaveBeenCalledWith(7, 3, 'lower-third', 'player', 1);

		await wrapper.get('[data-testid="live-control-source-clear-player"]').trigger('click');

		expect(mockSelectSource).toHaveBeenCalledWith(7, 3, 'lower-third', 'player', null);
	});

	it('shows a bound value and edits it as a Graphic Input Override', async () => {
		mockLiveState.value = {
			playout: { 'lower-third': { onAir: true, effectiveStartedAt: 0, cut: false } },
			inputs: {},
			sources: { 'lower-third': { player: 1 } },
		};
		mockBindingData.value = {
			...createEmptyGraphicBindingDataSet(),
			event: { name: 'Regional', game: 'mtg' },
			players: { 1: { name: 'Ava Reed' } },
		};
		const bound = graphic([NAME], {
			sources: [{ key: 'player', label: 'Player', kind: 'player' }],
			bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
		});

		const wrapper = await mountComponent(bound, 'on-air');
		const field = wrapper.get('[data-graphic-input="name"]');

		expect(field.get('[data-testid="live-control-bound"]').text()).toBe('Ava Reed');
		expect((field.get('[data-testid="live-control-field-name"]').element as HTMLInputElement).value)
			.toBe('Ava Reed');

		// Correcting a bound field masks its binding rather than writing a manual value
		// the binding would go on ignoring.
		const input = field.get('[data-testid="live-control-field-name"]');
		await input.setValue('Ava "Riptide" Reed');
		await input.trigger('blur');

		// The claim it carries is the value the operator was *shown* — the resolved bound
		// value, not the working value beneath it — which is what makes a field-scoped
		// refusal describe something they actually saw.
		expect(mockSetOverride)
			.toHaveBeenCalledWith(7, 3, 'lower-third', 'name', 'Ava "Riptide" Reed', 'Ava Reed');
		expect(mockSetInput).not.toHaveBeenCalled();
	});

	it('shows the moved bound value without issuing a command for it', async () => {
		mockLiveState.value = {
			playout: { 'lower-third': { onAir: true, effectiveStartedAt: 0, cut: false } },
			inputs: {},
			sources: { 'lower-third': { player: 1 } },
		};
		mockBindingData.value = {
			...createEmptyGraphicBindingDataSet(),
			event: { name: 'Regional', game: 'mtg' },
			players: { 1: { name: 'Ava Reed' } },
		};

		const wrapper = await mountComponent(graphic([{ ...NAME, updatePolicy: 'live' }], {
			sources: [{ key: 'player', label: 'Player', kind: 'player' }],
			bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
		}), 'on-air');

		// The Realtime Event Session moved the Player under the running show.
		mockBindingData.value = {
			...mockBindingData.value,
			players: { 1: { name: 'Ava Reed-Marsh' } },
		};
		await flushPromises();

		// The latest bound value is resolved in this component from Event Data the session
		// already delivered, so it is on screen without waiting for anything.
		expect(wrapper.get('[data-graphic-input="name"]')
			.get('[data-testid="live-control-bound"]').text()).toBe('Ava Reed-Marsh');

		// And Live Control asks for nothing. Re-resolution is the authoritative side's,
		// because a watcher here could only ever speak for the one graphic on screen —
		// the scoping that left a second on-air lower third holding a stale name.
		expect(mockSetInput).not.toHaveBeenCalled();
		expect(mockSetOverride).not.toHaveBeenCalled();
		expect(mockUpdateGraphic).not.toHaveBeenCalled();
		expect(mockSelectSource).not.toHaveBeenCalled();
	});

	it('leaves a staged binding to show as pending rather than accepting it', async () => {
		mockLiveState.value = {
			playout: { 'lower-third': { onAir: true, effectiveStartedAt: 0, cut: false } },
			inputs: {},
			sources: { 'lower-third': { player: 1 } },
		};
		mockBindingData.value = {
			...createEmptyGraphicBindingDataSet(),
			event: { name: 'Regional', game: 'mtg' },
			players: { 1: { name: 'Ava Reed' } },
		};

		const wrapper = await mountComponent(graphic([NAME], {
			sources: [{ key: 'player', label: 'Player', kind: 'player' }],
			bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
		}), 'on-air');

		mockBindingData.value = {
			...mockBindingData.value,
			players: { 1: { name: 'Ava Reed-Marsh' } },
		};
		await flushPromises();

		const field = wrapper.get('[data-graphic-input="name"]');

		// A staged On-air Update Policy means an operator confirms the change. The moved
		// value is shown as the latest bound value and reported pending, while what
		// program committed to is untouched — and an acceptance is offered rather than
		// taken.
		expect(field.get('[data-testid="live-control-bound"]').text()).toBe('Ava Reed-Marsh');
		expect(field.get('[data-testid="live-control-status"]').text()).toBe('Pending');
		expect(field.get('[data-testid="live-control-accepted"]').text()).toBe('Unnamed');
		expect(mockUpdateGraphic).not.toHaveBeenCalled();
	});

	it('shows an override masking its binding, and clears it back to the bound value', async () => {
		mockLiveState.value = {
			playout: { 'lower-third': { onAir: true, effectiveStartedAt: 0, cut: false } },
			inputs: {
				'lower-third': {
					working: {},
					overrides: { name: 'Ava "Riptide" Reed' },
					accepted: { name: 'Ava "Riptide" Reed' },
					acceptedRevision: 1,
				},
			},
			sources: { 'lower-third': { player: 1 } },
		};
		mockBindingData.value = {
			...createEmptyGraphicBindingDataSet(),
			event: { name: 'Regional', game: 'mtg' },
			players: { 1: { name: 'Ava Reed' } },
		};

		const wrapper = await mountComponent(graphic([NAME], {
			sources: [{ key: 'player', label: 'Player', kind: 'player' }],
			bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
		}), 'on-air');
		const field = wrapper.get('[data-graphic-input="name"]');

		expect(field.attributes('data-graphic-input-status')).toBe('overridden');
		// The binding keeps resolving underneath it, and Live Control keeps showing it.
		expect(field.get('[data-testid="live-control-bound"]').text()).toBe('Ava Reed');

		await field.get('[data-testid="live-control-clear-override-name"]').trigger('click');

		expect(mockSetOverride).toHaveBeenCalledWith(7, 3, 'lower-third', 'name', null);
	});

	it('writes a working value when the operator leaves the field', async () => {
		const wrapper = await mountComponent(graphic([NAME]));
		const field = wrapper.get('[data-testid="live-control-field-name"]');

		await field.setValue('Ava Reed');
		await field.trigger('blur');

		// The edit carries the value the operator was editing away from — the declared
		// default here, because nobody has edited this input yet. That is its Field
		// Ownership claim, and sending nothing would let this first edit silently
		// overwrite a colleague's.
		expect(mockSetInput).toHaveBeenCalledWith(7, 3, 'lower-third', 'name', 'Ava Reed', 'Unnamed');
	});

	it('writes a discrete control the moment it changes', async () => {
		const wrapper = await mountComponent(graphic([
			{ type: 'toggle', key: 'flag', label: 'Flag', required: false, updatePolicy: 'staged', default: false },
		]));

		await wrapper.get('[data-testid="live-control-field-flag"]').trigger('change');

		// The new value, and the declared default it was toggled away from.
		expect(mockSetInput).toHaveBeenCalledWith(7, 3, 'lower-third', 'flag', true, false);
	});

	it('shows no Update Graphic action while the Broadcast Graphic is off', async () => {
		mockLiveState.value = {
			playout: {},
			inputs: { 'lower-third': { working: { name: 'Ava Reed' }, accepted: {}, acceptedRevision: 0 } },
		};

		const wrapper = await mountComponent(graphic([NAME]), 'off');

		expect(wrapper.find('[data-testid="live-control-update"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="live-control-off-note"]').text()).toContain('next Take accepts');
	});

	it('accepts the staged set through Update Graphic, and immediately through its Cut variant', async () => {
		mockLiveState.value = {
			playout: { 'lower-third': { onAir: true, effectiveStartedAt: 0, cut: false } },
			inputs: { 'lower-third': { working: { name: 'Ava Reed' }, accepted: { name: 'Unnamed' }, acceptedRevision: 1 } },
		};

		const wrapper = await mountComponent(graphic([NAME]), 'on-air');

		await wrapper.get('[data-testid="live-control-update"]').trigger('click');
		await wrapper.get('[data-testid="live-control-cut-update"]').trigger('click');

		expect(mockUpdateGraphic).toHaveBeenNthCalledWith(1, 7, 3, 'lower-third', false);
		expect(mockUpdateGraphic).toHaveBeenNthCalledWith(2, 7, 3, 'lower-third', true);
	});

	it('offers no acceptance while nothing is staged', async () => {
		mockLiveState.value = {
			playout: { 'lower-third': { onAir: true, effectiveStartedAt: 0, cut: false } },
			inputs: { 'lower-third': { working: { name: 'Ava Reed' }, accepted: { name: 'Ava Reed' }, acceptedRevision: 1 } },
		};

		const wrapper = await mountComponent(graphic([NAME]), 'on-air');

		expect(wrapper.get('[data-testid="live-control-update"]').attributes('disabled')).toBeDefined();
	});

	it('reports a value that violates its constraints as unavailable, and shows what the operator entered', async () => {
		mockLiveState.value = {
			playout: { 'lower-third': { onAir: true, effectiveStartedAt: 0, cut: false } },
			inputs: { 'lower-third': { working: { name: 'A'.repeat(50) }, accepted: { name: 'Ava Reed' }, acceptedRevision: 1 } },
		};

		const wrapper = await mountComponent(graphic([NAME]), 'on-air');
		const field = wrapper.get('[data-graphic-input="name"]');

		// Unavailable rather than stale: nothing about the operator's own over-long
		// entry says a data source moved on.
		expect(field.attributes('data-graphic-input-status')).toBe('unavailable');
		expect(field.get('[data-testid="live-control-unavailable"]').text()).toContain('Longer than 20 characters');
		// Never coerced: the field still holds exactly what was entered, and program
		// still shows the last accepted rendering.
		expect((field.get('[data-testid="live-control-field-name"]').element as HTMLInputElement).value)
			.toBe('A'.repeat(50));
		expect(field.get('[data-testid="live-control-accepted"]').text()).toBe('Ava Reed');
	});

	it('explains which required Graphic Input blocks a Take before the operator presses it', async () => {
		const wrapper = await mountComponent(graphic([NAME, TITLE]), 'off');

		expect(wrapper.get('[data-testid="live-control-take-blocked"]').text()).toContain('Title');
	});

	it('shows no Take warning once every required Graphic Input has a value', async () => {
		mockLiveState.value = {
			playout: {},
			inputs: { 'lower-third': { working: { title: 'Champion' }, accepted: {}, acceptedRevision: 0 } },
		};

		const wrapper = await mountComponent(graphic([NAME, TITLE]), 'off');

		expect(wrapper.find('[data-testid="live-control-take-blocked"]').exists()).toBe(false);
	});
	/**
	 * A media Graphic Input is declarable and resolvable on air, and until now the
	 * only way to give one a value was to POST a Set Input command by hand (#178).
	 */
	describe('choosing a value for a media Graphic Input', () => {
		it('offers the Graphics Asset Library, restricted to the kind the Graphic Input declares', async () => {
			const wrapper = await mountComponent(graphic([
				BADGE,
				{ ...BADGE, key: 'sting', label: 'Sting', mediaKind: 'silent-video' },
			]));

			expect(wrapper.find('[data-testid="live-control-media-badge"]').exists()).toBe(true);
			const pickers = wrapper.findAllComponents(GraphicsAssetFocusPickerStub);
			expect(pickers.map(picker => picker.props('assetKind'))).toEqual(['image', 'silent-video']);
		});

		it('writes the chosen revision as this Graphic Input’s value, with the value it was chosen away from', async () => {
			mockLiveState.value = {
				playout: {},
				inputs: {
					'lower-third': {
						working: { badge: PINNED },
						accepted: {},
						acceptedRevision: 0,
					},
				},
			};

			const wrapper = await mountComponent(graphic([BADGE]));
			await wrapper.get('[data-testid="live-control-media-badge"]').trigger('click');
			await flushPromises();

			// The reference alone: the pinned revision's own compatibility facts are the
			// authoritative side's to record, rebuilt from the library at acceptance.
			expect(mockSetInput).toHaveBeenCalledWith(
				7,
				3,
				'lower-third',
				'badge',
				{ assetId: 'asset-badge', revisionId: 'revision-badge-2' },
				PINNED,
			);
		});

		it('shows the chosen revision as staged, leaving what is on air alone until Update Graphic', async () => {
			mockLiveState.value = {
				playout: { 'lower-third': { onAir: true, effectiveStartedAt: 0, cut: false } },
				inputs: {
					'lower-third': {
						working: { badge: CHOSEN },
						accepted: { badge: PINNED },
						acceptedRevision: 1,
					},
				},
			};

			const wrapper = await mountComponent(graphic([BADGE]), 'on-air');
			const field = wrapper.get('[data-graphic-input="badge"]');

			expect(field.get('[data-testid="live-control-working"]').text()).toBe('asset-badge@revision-badge-2');
			expect(field.get('[data-testid="live-control-accepted"]').text()).toBe('asset-badge@revision-badge-1');
			expect(field.get('[data-testid="live-control-status"]').text()).toBe('Pending');
			expect(wrapper.get('[data-testid="live-control-update"]').attributes('disabled')).toBeUndefined();
		});

		/**
		 * `recordMediaSelectionFacts` rebuilds the value from the library and refuses a
		 * revision that does not resolve with a 409. An operator must not be able to
		 * reach that refusal by choosing from the picker, so the surface asks the same
		 * question of the same library before it writes anything.
		 */
		it('writes nothing and names the reason when the chosen revision no longer resolves', async () => {
			mockApiFetch.mockResolvedValue({ outcome: 'missing' });
			const wrapper = await mountComponent(graphic([BADGE]));

			await wrapper.get('[data-testid="live-control-media-badge"]').trigger('click');
			await flushPromises();

			expect(mockSetInput).not.toHaveBeenCalled();
			expect(wrapper.get('[data-testid="live-control-media-refused-badge"]').text())
				.toContain('Missing Graphic Asset Reference');
		});

		/**
		 * A lapsed graphics author session is not the library saying anything about the
		 * revision, and it is the one failure retrying cannot fix. Calling it
		 * temporarily unavailable content would state the wrong fact and prescribe the
		 * one action that provably cannot work.
		 */
		it('names a lapsed graphics author session rather than blaming the revision’s bytes', async () => {
			mockApiFetch.mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
			const wrapper = await mountComponent(graphic([BADGE]));

			await wrapper.get('[data-testid="live-control-media-badge"]').trigger('click');
			await flushPromises();

			const refusal = wrapper.get('[data-testid="live-control-media-refused-badge"]').text();
			expect(refusal).toContain('graphics author session has lapsed');
			expect(refusal).toContain('Reload the page');
			expect(refusal).not.toMatch(/temporarily unavailable|Try again/);
			expect(mockSetInput).not.toHaveBeenCalled();
		});

		it('writes nothing while the revision’s content is only temporarily unavailable', async () => {
			mockApiFetch.mockResolvedValue({ outcome: 'unavailable', retryable: true });
			const wrapper = await mountComponent(graphic([BADGE]));

			await wrapper.get('[data-testid="live-control-media-badge"]').trigger('click');
			await flushPromises();

			expect(mockSetInput).not.toHaveBeenCalled();
			expect(wrapper.get('[data-testid="live-control-media-refused-badge"]').text())
				.toContain('Unavailable Graphic Asset Content');
		});

		/**
		 * The residual race: the picker asked the library, was told the revision was
		 * there, and it had gone by the time the command landed. The operator gets the
		 * same words at the same field as when the picker catches it — rather than a
		 * banner saying only that a playout action failed (#203).
		 */
		it('names the authority’s refusal at the field when the revision goes between the check and the write', async () => {
			// Once, so the refusal this test installs cannot outlive it: `clearAllMocks`
			// clears calls but leaves an implementation standing.
			mockSetInput.mockImplementationOnce(() => {
				mockInputRefusals.value = { badge: 'missing-asset-reference' };
			});
			const wrapper = await mountComponent(graphic([BADGE]));

			await wrapper.get('[data-testid="live-control-media-badge"]').trigger('click');
			await flushPromises();

			expect(mockSetInput).toHaveBeenCalledOnce();
			expect(wrapper.get('[data-testid="live-control-media-refused-badge"]').text())
				.toContain('Missing Graphic Asset Reference');
		});

		it('names content that is only temporarily unavailable as retryable, not as gone', async () => {
			mockInputRefusals.value = { badge: 'unavailable-asset-content' };

			const wrapper = await mountComponent(graphic([BADGE]));

			const refusal = wrapper.get('[data-testid="live-control-media-refused-badge"]').text();
			expect(refusal).toContain('Unavailable Graphic Asset Content');
			expect(refusal).toContain('Try again');
		});

		/**
		 * The rest of the rejection vocabulary is about the show rather than about the
		 * revision, and each code is already reported where it belongs — a superseded
		 * field refreshes itself, a Take that cannot proceed says which input is
		 * missing. Repeating one beside the picker would name the wrong thing.
		 */
		it('says nothing beside the picker about a refusal that is not about the revision', async () => {
			mockInputRefusals.value = { badge: 'stale-input-edit' };

			const wrapper = await mountComponent(graphic([BADGE]));

			expect(wrapper.find('[data-testid="live-control-media-refused-badge"]').exists()).toBe(false);
		});

		it('stops naming a refusal once a revision that resolves is chosen', async () => {
			mockApiFetch.mockResolvedValue({ outcome: 'missing' });
			const wrapper = await mountComponent(graphic([BADGE]));
			await wrapper.get('[data-testid="live-control-media-badge"]').trigger('click');
			await flushPromises();
			expect(wrapper.find('[data-testid="live-control-media-refused-badge"]').exists()).toBe(true);

			mockApiFetch.mockResolvedValue({ outcome: 'available', lifecycleState: 'active', kind: 'image' });
			await wrapper.get('[data-testid="live-control-media-badge"]').trigger('click');
			await flushPromises();

			expect(wrapper.find('[data-testid="live-control-media-refused-badge"]').exists()).toBe(false);
			expect(mockSetInput).toHaveBeenCalledTimes(1);
		});

		/**
		 * Compatibility is a fact of the revision rather than a choice, and what it
		 * costs depends on which engines are watching: the picker states it against the
		 * outputs open now rather than letting an operator discover it on air (#98).
		 */
		it('tells the picker which engines the Screen Outputs currently open use', async () => {
			mockOpenOutputTargets.value = ['chromium', 'safari'];

			const wrapper = await mountComponent(graphic([BADGE]));

			expect(wrapper.getComponent(GraphicsAssetFocusPickerStub).props('openOutputTargets'))
				.toEqual(['chromium', 'safari']);
			// The authored target a Broadcast Graphics reference is indexed with, so a
			// VP9-alpha clip is offered here exactly as it is to an author.
			expect(wrapper.getComponent(GraphicsAssetFocusPickerStub).props('videoTarget')).toBe('chromium');
		});

		/**
		 * The picker reports on the revision it is given — Missing Graphic Asset
		 * Reference, Unavailable Graphic Asset Content, and the retry for it. Told
		 * nothing, it reports nothing, and a staged revision that has since gone would
		 * sit there reading as a healthy value until the operator took it on air.
		 */
		it('tells the picker which revision is staged, so its status is reported', async () => {
			mockLiveState.value = {
				playout: {},
				inputs: {
					'lower-third': { working: { badge: PINNED }, accepted: {}, acceptedRevision: 0 },
				},
			};

			const wrapper = await mountComponent(graphic([BADGE]));

			expect(wrapper.getComponent(GraphicsAssetFocusPickerStub).props('modelValue')).toEqual(PINNED);
			// Live Control shows and clears the staged value itself, so the picker is
			// asked not to offer a second Clear beside it.
			expect(wrapper.getComponent(GraphicsAssetFocusPickerStub).props('clearable')).toBe(false);
		});

		it('tells the picker nothing is staged once the value is cleared', async () => {
			const wrapper = await mountComponent(graphic([BADGE]));

			expect(wrapper.getComponent(GraphicsAssetFocusPickerStub).props('modelValue')).toBeUndefined();
		});

		it('clears a media value without asking the library to approve it', async () => {
			mockLiveState.value = {
				playout: {},
				inputs: {
					'lower-third': {
						working: { badge: PINNED },
						accepted: {},
						acceptedRevision: 0,
					},
				},
			};

			const wrapper = await mountComponent(graphic([BADGE]));
			await wrapper.get('[data-testid="live-control-clear-badge"]').trigger('click');
			await flushPromises();

			expect(mockSetInput).toHaveBeenCalledWith(
				7,
				3,
				'lower-third',
				'badge',
				null,
				PINNED,
			);
			expect(mockApiFetch).not.toHaveBeenCalled();
		});

		/**
		 * The window the library's answer arrives in is the window an operator moves
		 * on in. Every write here names a graphic, so an answer that outlives the
		 * graphic it was asked for would stage a revision nobody chose for the graphic
		 * it lands on — and its Field Ownership claim would describe that other
		 * graphic's value, which is the unconditional overwrite the claim exists to
		 * prevent.
		 */
		it('writes nothing when the operator moves to another Broadcast Graphic while the library is still answering', async () => {
			let answer!: (status: unknown) => void;
			mockApiFetch.mockReturnValueOnce(new Promise((resolve) => {
				answer = resolve;
			}));
			const wrapper = await mountComponent(graphic([BADGE]));

			await wrapper.get('[data-testid="live-control-media-badge"]').trigger('click');
			// The next Broadcast Graphic declares the same Graphic Input key, so a write
			// that escaped would land on it rather than fail to find a field.
			await wrapper.setProps({ graphic: { ...graphic([BADGE]), id: 'sting', name: 'Sting' } });
			answer({ outcome: 'available', lifecycleState: 'active', kind: 'image' });
			await flushPromises();

			expect(mockSetInput).not.toHaveBeenCalled();
		});

		it('writes nothing when Live Control is torn down while the library is still answering', async () => {
			let answer!: (status: unknown) => void;
			mockApiFetch.mockReturnValueOnce(new Promise((resolve) => {
				answer = resolve;
			}));
			const wrapper = await mountComponent(graphic([BADGE]));

			await wrapper.get('[data-testid="live-control-media-badge"]').trigger('click');
			wrapper.unmount();
			answer({ outcome: 'available', lifecycleState: 'active', kind: 'image' });
			await flushPromises();

			expect(mockSetInput).not.toHaveBeenCalled();
		});

		it('carries no refusal across to the next Broadcast Graphic an operator selects', async () => {
			mockApiFetch.mockResolvedValue({ outcome: 'missing' });
			const wrapper = await mountComponent(graphic([BADGE]));
			await wrapper.get('[data-testid="live-control-media-badge"]').trigger('click');
			await flushPromises();
			expect(wrapper.find('[data-testid="live-control-media-refused-badge"]').exists()).toBe(true);

			await wrapper.setProps({
				graphic: { ...graphic([BADGE]), id: 'sting', name: 'Sting' },
			});
			await flushPromises();

			// The library refused a revision this other graphic never named.
			expect(wrapper.find('[data-testid="live-control-media-refused-badge"]').exists()).toBe(false);
		});

		it('withholds the picker while this browser is disconnected', async () => {
			const wrapper = await mountComponent(graphic([BADGE]), 'off', true);

			expect(wrapper.get('[data-testid="live-control-media-badge"]').attributes('disabled')).toBeDefined();
			expect(wrapper.get('[data-testid="live-control-clear-badge"]').attributes('disabled')).toBeDefined();
		});
	});

	describe('a Graphic Input whose edit lost a field-scoped conflict', () => {
		it('is reported as refreshed rather than as the operator’s own accepted edit', async () => {
			mockLiveState.value = {
				playout: {},
				inputs: { 'lower-third': { working: { name: 'Ben Cole' }, accepted: {}, acceptedRevision: 0 } },
			};
			mockSupersededInputKeys.value = ['name'];

			const wrapper = await mountComponent(graphic([NAME, TITLE]));

			expect(wrapper.get('[data-graphic-input="name"]').attributes('data-graphic-input-status')).toBe('superseded');
			expect(wrapper.get('[data-graphic-input="title"]').attributes('data-graphic-input-status')).not.toBe('superseded');
		});

		it('names what happened, and which Graphic Input it happened to', async () => {
			mockSupersededInputKeys.value = ['name'];

			const wrapper = await mountComponent(graphic([NAME]));

			expect(wrapper.get('[data-testid="live-control-refreshed"]').text()).toContain('Presenter name');
			expect(wrapper.get('[data-testid="live-control-refreshed"]').text()).toMatch(/not applied/i);
		});

		it('gives the field back to the value that actually landed', async () => {
			// The refused text must not stay in the box: an operator looking at their own
			// rejected edit would believe it is on its way to air.
			const wrapper = await mountComponent(graphic([NAME]));
			const field = wrapper.get('[data-testid="live-control-field-name"]');
			await field.setValue('Ava Reed');
			expect((field.element as HTMLInputElement).value).toBe('Ava Reed');

			mockLiveState.value = {
				playout: {},
				inputs: { 'lower-third': { working: { name: 'Ben Cole' }, accepted: {}, acceptedRevision: 0 } },
			};
			mockSupersededInputKeys.value = ['name'];
			await flushPromises();

			expect((wrapper.get('[data-testid="live-control-field-name"]').element as HTMLInputElement).value)
				.toBe('Ben Cole');
		});

		it('shows nothing about conflicts when no edit was refused', async () => {
			const wrapper = await mountComponent(graphic([NAME]));

			expect(wrapper.find('[data-testid="live-control-refreshed"]').exists()).toBe(false);
		});
	});

	describe('while this browser is disconnected', () => {
		it('withholds every generated field', async () => {
			const wrapper = await mountComponent(graphic([NAME]), 'off', true);

			expect(wrapper.get('[data-testid="live-control-field-name"]').attributes('disabled')).toBeDefined();
		});

		it('withholds Update Graphic even with a staged set waiting', async () => {
			mockLiveState.value = {
				playout: { 'lower-third': { onAir: true, effectiveStartedAt: 0, cut: false } },
				inputs: { 'lower-third': { working: { name: 'Ava Reed' }, accepted: { name: 'Unnamed' }, acceptedRevision: 1 } },
			};

			const wrapper = await mountComponent(graphic([NAME]), 'on-air', true);

			expect(wrapper.get('[data-testid="live-control-update"]').attributes('disabled')).toBeDefined();
			expect(wrapper.get('[data-testid="live-control-cut-update"]').attributes('disabled')).toBeDefined();
		});

		it('queues no edit: nothing is sent while disconnected, and nothing afterwards', async () => {
			const wrapper = await mountComponent(graphic([NAME]), 'off', true);
			const field = wrapper.get('[data-testid="live-control-field-name"]');

			await field.setValue('Ava Reed');
			await field.trigger('blur');
			expect(mockSetInput).not.toHaveBeenCalled();

			// An edit formed offline would arrive claiming a value it could not have
			// checked, which is exactly the silent overwrite the conflict rule prevents.
			await wrapper.setProps({ disconnected: false });
			await flushPromises();
			expect(mockSetInput).not.toHaveBeenCalled();
		});
	});
});
