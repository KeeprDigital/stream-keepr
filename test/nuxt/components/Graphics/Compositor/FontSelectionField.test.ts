import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import FontSelectionField from '~/components/Graphics/Compositor/FontSelectionField.vue';

/**
 * The application-only mode of the Graphic Font Selection control, which a Graphic
 * Style Set typography preset uses: a preset references application fonts only
 * (ADR-0001), so it offers no source to choose and no library to pick from.
 */

enableAutoUnmount(afterEach);

const USelectStub = defineComponent({
	name: 'USelect',
	props: {
		modelValue: { type: String, required: false },
		items: { type: Array, default: () => [] },
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" :disabled="disabled" />',
});

const UFormFieldStub = defineComponent({
	props: { label: { type: String, default: '' } },
	template: '<div :data-label="label"><slot /></div>',
});

function mountField(props: Record<string, unknown> = {}) {
	return mount(FontSelectionField, {
		global: {
			stubs: {
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				GraphicsAssetFocusPicker: defineComponent({ template: '<div data-testid="library-picker" />' }),
			},
		},
		props: {
			applicationOnly: true,
			font: { kind: 'application', fontId: 'inter' },
			size: 'xs',
			testIdPrefix: 'preset',
			...props,
		},
	});
}

function selects(wrapper: ReturnType<typeof mountField>) {
	return wrapper.findAllComponents({ name: 'USelect' });
}

describe('font selection field, application only', () => {
	it('offers the application fonts and nothing else', () => {
		const wrapper = mountField();

		expect(selects(wrapper).map(select => select.attributes('data-testid'))).toEqual(['preset-font']);
		expect(wrapper.find('[data-label="Font"] [data-testid="preset-font"]').exists()).toBe(true);
		expect(selects(wrapper)[0]!.props('modelValue')).toBe('inter');
		expect(wrapper.find('[data-testid="library-picker"]').exists()).toBe(false);
	});

	it('reports the application font the author picked', () => {
		const wrapper = mountField();

		selects(wrapper)[0]!.vm.$emit('update:modelValue', 'mplantin');

		expect(wrapper.emitted('application')).toEqual([['mplantin']]);
	});

	it('is read-only for an observer', () => {
		const wrapper = mountField({ disabled: true });

		expect(selects(wrapper)[0]!.props('disabled')).toBe(true);
	});
});
