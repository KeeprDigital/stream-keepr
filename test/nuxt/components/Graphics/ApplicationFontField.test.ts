import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import ApplicationFontField from '~/components/Graphics/ApplicationFontField.vue';

/**
 * The font control of a typography Graphic Style Set Entry, which references
 * application fonts only (ADR-0001): no source to choose and no library to pick from.
 */

enableAutoUnmount(afterEach);

const USelectStub = defineComponent({
	name: 'USelect',
	props: {
		modelValue: { type: String, required: false },
		items: {
			type: Array,
			default: () => [],
		},
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" :disabled="disabled" />',
});

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, default: '' },
	},
	template: '<div :data-label="label"><slot /></div>',
});

function mountField(props: Record<string, unknown> = {}) {
	return mount(ApplicationFontField, {
		global: {
			stubs: {
				UFormField: UFormFieldStub,
				USelect: USelectStub,
			},
		},
		props: {
			fontId: 'inter',
			size: 'xs',
			testIdPrefix: 'entry',
			...props,
		},
	});
}

function selects(wrapper: ReturnType<typeof mountField>) {
	return wrapper.findAllComponents({ name: 'USelect' });
}

describe('application font field', () => {
	it('offers the application fonts and nothing else', () => {
		const wrapper = mountField();

		expect(selects(wrapper).map(select => select.attributes('data-testid'))).toEqual(['entry-font']);
		expect(wrapper.find('[data-label="Font"] [data-testid="entry-font"]').exists()).toBe(true);
		expect(selects(wrapper)[0]!.props('modelValue')).toBe('inter');
	});

	it('reports the application font the author picked', () => {
		const wrapper = mountField();

		selects(wrapper)[0]!.vm.$emit('update:modelValue', 'mplantin');

		expect(wrapper.emitted('update:fontId')).toEqual([
			['mplantin'],
		]);
	});

	it('is read-only for an observer', () => {
		const wrapper = mountField({ disabled: true });

		expect(selects(wrapper)[0]!.props('disabled')).toBe(true);
	});
});
