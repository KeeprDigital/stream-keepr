import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';

const mockEventStore = reactive({
	eventId: 1,
	event: { id: 1, game: 'mtg' },
});

const mockRoundStore = reactive({
	getRoundById: vi.fn(),
	updateRound: vi.fn(),
});

const mockPhaseStore = reactive({
	getPhaseById: vi.fn(),
	updatePhase: vi.fn(),
});

const mockToast = {
	add: vi.fn(),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('usePhaseStore', () => () => mockPhaseStore);
mockNuxtImport('useToast', () => () => mockToast);

const UModalStub = defineComponent({
	template: '<div><slot name="body" /><slot name="footer" /></div>',
});

const UFormStub = defineComponent({
	emits: ['submit'],
	setup(_, { attrs, emit, slots, expose }) {
		function submit() {
			emit('submit', new Event('submit'));
			return Promise.resolve();
		}

		expose({ submit });

		return () => h('form', {
			...attrs,
			onSubmit: (event: Event) => {
				event.preventDefault();
				emit('submit', event);
			},
		}, slots.default?.());
	},
});

const UFormFieldStub = defineComponent({
	template: '<label><slot /></label>',
});

const UInputStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-testid="text-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-testid="number-input" type="number" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))">',
});

const USelectStub = defineComponent({
	props: {
		modelValue: { type: [String, Number, Object], required: false },
		items: { type: Array, required: false, default: () => [] },
	},
	emits: ['update:modelValue'],
	template: '<select data-testid="select-input" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
});

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
		disabled: { type: Boolean, required: false },
		loading: { type: Boolean, required: false },
		type: { type: String, required: false, default: 'button' },
		form: { type: String, required: false },
	},
	setup(props, { attrs, slots }) {
		function handleClick(event: MouseEvent) {
			if (typeof attrs.onClick === 'function')
				attrs.onClick(event);

			if (props.type === 'submit' && props.form && !props.disabled) {
				event.preventDefault();
				const root = (event.currentTarget as HTMLElement).getRootNode() as ParentNode;
				root.querySelector?.(`#${props.form}`)?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
			}
		}

		return () => h('button', {
			'type': props.type,
			'form': props.form,
			'data-label': props.label,
			'disabled': props.disabled,
			'onClick': handleClick,
		}, slots.default?.() ?? props.label);
	},
});

const globalStubs = {
	UModal: UModalStub,
	UForm: UFormStub,
	UFormField: UFormFieldStub,
	UInput: UInputStub,
	UInputNumber: UInputNumberStub,
	USelect: USelectStub,
	UButton: UButtonStub,
};

describe('round edit modals', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventStore.eventId = 1;
		mockEventStore.event = { id: 1, game: 'mtg' };
		mockRoundStore.getRoundById.mockReturnValue({ id: 10, name: 'Round 1', roundNumber: 1 });
		mockRoundStore.updateRound.mockResolvedValue({ id: 10, name: 'Round 2' });
		mockPhaseStore.getPhaseById.mockReturnValue({ id: 20, name: 'Swiss' });
		mockPhaseStore.updatePhase.mockResolvedValue({ id: 20, name: 'Top 8' });
	});

	it('saves a round edit when the UForm submits', async () => {
		const { default: RoundEditModal } = await import('~/components/Round/EditModal.vue');
		const wrapper = mount(RoundEditModal, {
			props: { roundId: 10 },
			global: { stubs: globalStubs },
		});

		await wrapper.get('[data-testid="text-input"]').setValue('Round 2');
		await wrapper.get('[data-testid="number-input"]').setValue('2');
		await wrapper.get('form').trigger('submit');
		await flushPromises();

		const submitButton = wrapper.get('button[data-label="Save"]');
		expect(submitButton.attributes('type')).toBe('submit');
		expect(submitButton.attributes('form')).toBe('edit-round-10-form');
		expect(mockRoundStore.updateRound).toHaveBeenCalledWith(1, 10, { name: 'Round 2', roundNumber: 2 });
		expect(wrapper.emitted('close')).toEqual([[]]);
	});

	it('saves a phase edit through the footer form submitter', async () => {
		const { default: PhaseEditModal } = await import('~/components/Round/PhaseEditModal.vue');
		const wrapper = mount(PhaseEditModal, {
			props: { phaseId: 20 },
			global: { stubs: globalStubs },
		});

		await wrapper.get('[data-testid="text-input"]').setValue('Top 8');
		const submitButton = wrapper.get('button[data-label="Save"]');
		expect(submitButton.attributes('type')).toBe('submit');
		expect(submitButton.attributes('form')).toBe('edit-phase-20-form');

		await submitButton.trigger('click');
		await flushPromises();

		expect(mockPhaseStore.updatePhase).toHaveBeenCalledWith(1, 20, {
			name: 'Top 8',
		});
		expect(wrapper.emitted('close')).toEqual([[]]);
	});
});
