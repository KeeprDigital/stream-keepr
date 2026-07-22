import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	template: '<label data-testid="form-field"><span>{{ label }}</span><slot /></label>',
});

const UInputStub = defineComponent({
	props: {
		modelValue: { type: [String, Number], required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-testid="u-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-testid="u-input-number" type="number" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
});

const USelectStub = defineComponent({
	props: {
		modelValue: { type: [String, Number, Boolean], required: false },
		items: { type: Array, required: false },
		valueKey: { type: String, required: false, default: 'value' },
	},
	emits: ['update:modelValue'],
	setup(props, { emit }) {
		function optionValue(item: any) {
			if (item && typeof item === 'object')
				return item.value ?? item[props.valueKey];
			return item;
		}

		function selectItem(item: any) {
			emit('update:modelValue', optionValue(item));
		}

		return { optionValue, selectItem };
	},
	template: `
		<div data-testid="u-select" :data-model-value="String(modelValue ?? '')">
			<button
				v-for="item in items || []"
				:key="String(optionValue(item))"
				type="button"
				:data-value="String(optionValue(item))"
				@click="selectItem(item)"
			>{{ item.label ?? item }}</button>
		</div>
	`,
});

const ColorPickerStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-testid="color-picker" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const BackgroundFieldsStub = defineComponent({
	props: {
		emptyColorValue: { type: String, required: false },
	},
	emits: ['update'],
	template: '<button type="button" data-testid="background-fields" :data-empty-color-value="emptyColorValue" @click="$emit(\'update\', { color: emptyColorValue })" />',
});

async function mountComponent(props: Record<string, unknown> = {}) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/BoxStyleFields.vue';
	const { default: BoxStyleFields } = await import(componentPath);

	return mount(BoxStyleFields, {
		props: {
			includeText: false,
			includeBackground: true,
			includeRadius: false,
			includeBorder: false,
			...props,
		},
		global: {
			stubs: {
				FeatureMatchOverlayBackgroundFields: BackgroundFieldsStub,
				UIColorPicker: ColorPickerStub,
				UFormField: UFormFieldStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
				USelect: USelectStub,
			},
		},
	});
}

describe('featureMatchOverlayBoxStyleFields', () => {
	it('preserves transparent background selections', async () => {
		const wrapper = await mountComponent();
		const backgroundFields = wrapper.get('[data-testid="background-fields"]');

		expect(backgroundFields.attributes('data-empty-color-value')).toBe('transparent');

		await backgroundFields.trigger('click');

		expect(wrapper.emitted('update')?.at(-1)).toEqual([{ backgroundColor: 'transparent' }]);
	});

	it('offers registered font faces instead of a raw font text input', async () => {
		const wrapper = await mountComponent({
			includeText: true,
			includeBackground: false,
			boxStyle: { fontFamily: 'ibm-plex-sans' },
		});

		expect(wrapper.find('[data-value=""]').exists()).toBe(false);
		expect(wrapper.get('[data-value="saira-condensed"]').text()).toBe('Saira Condensed');
		expect(wrapper.get('[data-value="ibm-plex-sans"]').text()).toBe('IBM Plex Sans');

		await wrapper.get('[data-value="saira-condensed"]').trigger('click');

		expect(wrapper.emitted('update')).toContainEqual([{ fontFamily: 'saira-condensed' }]);
	});

	it('keeps legacy custom font-family values selectable', async () => {
		const wrapper = await mountComponent({
			includeText: true,
			includeBackground: false,
			boxStyle: { fontFamily: 'Impact, Arial Black, sans-serif' },
		});

		expect(wrapper.get('[data-value="Impact, Arial Black, sans-serif"]').text()).toBe('Custom: Impact, Arial Black, sans-serif');
	});
});
