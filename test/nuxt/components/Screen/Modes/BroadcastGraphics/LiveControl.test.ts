import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { GraphicBindingDataSet } from '~~/shared/modules/graphics';
import type { BroadcastGraphicConfig, GraphicInputDeclaration, GraphicPlayoutState } from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
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
const mockResolveBindings = vi.fn();
/** The Event Data Live Control resolves its bound values and picker options from. */
const mockBindingData = ref<GraphicBindingDataSet>(createEmptyGraphicBindingDataSet());
/** The Graphic Inputs whose last edit from this session lost a field-scoped conflict. */
const mockSupersededInputKeys = ref<string[]>([]);

mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({
	setInput: mockSetInput,
	setOverride: mockSetOverride,
	selectSource: mockSelectSource,
	updateGraphic: mockUpdateGraphic,
	resolveBindings: mockResolveBindings,
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

function graphic(inputs: GraphicInputDeclaration[], overrides: Partial<BroadcastGraphicConfig> = {}): BroadcastGraphicConfig {
	return { id: 'lower-third', name: 'Lower Third', items: [], inputs, ...overrides };
}

async function mountComponent(
	config: BroadcastGraphicConfig,
	playoutState: GraphicPlayoutState = 'off',
	disconnected = false,
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

	it('asks the server to re-resolve when Event Data behind a live-policy binding moves', async () => {
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

		await mountComponent(graphic([{ ...NAME, updatePolicy: 'live' }], {
			sources: [{ key: 'player', label: 'Player', kind: 'player' }],
			bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
		}), 'on-air');

		expect(mockResolveBindings).not.toHaveBeenCalled();

		// The Realtime Event Session moved the Player under the running show.
		mockBindingData.value = {
			...mockBindingData.value,
			players: { 1: { name: 'Ava Reed-Marsh' } },
		};
		await flushPromises();

		// It asks for an acceptance rather than sending a value: the server re-resolves.
		expect(mockResolveBindings).toHaveBeenCalledWith(7, 3, 'lower-third');
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

		await mountComponent(graphic([NAME], {
			sources: [{ key: 'player', label: 'Player', kind: 'player' }],
			bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
		}), 'on-air');

		mockBindingData.value = {
			...mockBindingData.value,
			players: { 1: { name: 'Ava Reed-Marsh' } },
		};
		await flushPromises();

		expect(mockResolveBindings).not.toHaveBeenCalled();
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
