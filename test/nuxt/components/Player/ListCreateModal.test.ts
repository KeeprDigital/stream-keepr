import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';

const mockEventStore = reactive({
	eventId: 1,
});

const mockPlayerListStore = {
	createList: vi.fn(),
};

const mockToast = {
	add: vi.fn(),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('usePlayerListStore', () => () => mockPlayerListStore);
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
	template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
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

describe('player list create modal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventStore.eventId = 1;
		mockPlayerListStore.createList.mockResolvedValue({ id: 42, name: 'Top 8' });
	});

	it('creates a list through the modal footer form submitter', async () => {
		const { default: PlayerListCreateModal } = await import('~/components/Player/ListCreateModal.vue');
		const wrapper = mount(PlayerListCreateModal, {
			global: {
				stubs: {
					UModal: UModalStub,
					UForm: UFormStub,
					UFormField: UFormFieldStub,
					UInput: UInputStub,
					UButton: UButtonStub,
				},
			},
		});

		await wrapper.get('input').setValue('Top 8');
		const submitButton = wrapper.get('button[data-label="Create List"]');
		expect(submitButton.attributes('type')).toBe('submit');
		expect(submitButton.attributes('form')).toBe('create-player-list-form');

		await submitButton.trigger('click');
		await flushPromises();

		expect(mockPlayerListStore.createList).toHaveBeenCalledWith(1, { name: 'Top 8' });
		expect(wrapper.emitted('created')).toEqual([[42]]);
		expect(wrapper.emitted('close')).toEqual([[]]);
	});
});
