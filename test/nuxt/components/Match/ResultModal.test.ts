import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMockMatch } from '~~/test/helpers/fixtures';

const mockEventStore = {
	eventId: 1,
};

const mockMatchStore = {
	updateMatch: vi.fn(),
};

const mockToast = {
	add: vi.fn(),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useMatchStore', () => () => mockMatchStore);
mockNuxtImport('useToast', () => () => mockToast);

const UModalStub = defineComponent({
	template: '<div><slot name="body" /><slot name="footer" /></div>',
});

const UFormFieldStub = defineComponent({
	template: '<label><slot /></label>',
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

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue ?? 0" @input="$emit(\'update:modelValue\', Number($event.target.value))">',
});

const UAlertStub = defineComponent({
	props: {
		title: { type: String, required: false },
		description: { type: String, required: false },
	},
	template: '<div>{{ title }}|{{ description }}</div>',
});

const UButtonStub = defineComponent({
	props: {
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
			type: props.type,
			form: props.form,
			disabled: props.disabled,
			onClick: handleClick,
		}, slots.default?.());
	},
});

async function mountComponent() {
	const { default: ResultModal } = await import('~/components/Match/ResultModal.vue');

	return mount(ResultModal, {
		props: {
			match: createMockMatch({
				player1Data: { name: 'Alice' } as never,
				player2Data: { name: 'Bob' } as never,
			}),
			bestOf: 3,
		},
		global: {
			stubs: {
				UModal: UModalStub,
				UForm: UFormStub,
				UFormField: UFormFieldStub,
				UInputNumber: UInputNumberStub,
				UAlert: UAlertStub,
				UButton: UButtonStub,
			},
		},
	});
}

describe('matchResultModal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('saves when the result form is submitted', async () => {
		mockMatchStore.updateMatch.mockResolvedValue(createMockMatch({ hasResult: true }));
		const wrapper = await mountComponent();

		const inputs = wrapper.findAll('input');
		await inputs[0]!.setValue('2');
		await inputs[1]!.setValue('1');
		await wrapper.get('form').trigger('submit');
		await flushPromises();

		const submitButton = wrapper.findAll('button')[2]!;
		expect(submitButton.attributes('type')).toBe('submit');
		expect(submitButton.attributes('form')).toBe(wrapper.get('form').attributes('id'));
		expect(mockMatchStore.updateMatch).toHaveBeenCalledWith(1, expect.any(Number), expect.objectContaining({
			hasResult: true,
			player1GameWins: 2,
			player2GameWins: 1,
			resultString: '2-1',
		}));
		expect(wrapper.emitted('saved')).toEqual([[]]);
		expect(wrapper.emitted('close')).toEqual([[]]);
	});
});
