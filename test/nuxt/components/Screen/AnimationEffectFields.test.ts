import type { AnimationEffectSelection } from '~~/shared/animationEffects';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { ANIMATION_EFFECT_VALUES } from '~~/shared/animationEffects';

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	template: '<label :data-label="label"><slot /></label>',
});

const UIColorPickerStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
		placeholder: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="color-picker" @click="$emit(\'update:modelValue\', \'#123456\')">{{ modelValue }}</button>',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
		min: { type: Number, required: false },
		max: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-testid="u-input-number" type="number" :value="modelValue" :min="min" :max="max" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
});

const USelectStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	template: '<select data-testid="u-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items || []" :key="String(item.value ?? item)" :value="item.value ?? item">{{ item.label ?? item }}</option></select>',
});

const ScreenSettingsToggleStub = defineComponent({
	props: {
		label: { type: String, required: false },
		description: { type: String, required: false },
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="settings-toggle" :data-description="description" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
});

async function mountComponent(selection: AnimationEffectSelection, onUpdate = vi.fn()) {
	const { default: AnimationEffectFields } = await import('../../../../app/components/Screen/AnimationEffectFields.vue');

	const wrapper = mount(AnimationEffectFields, {
		props: {
			selection,
			'onUpdate:selection': onUpdate,
		},
		global: {
			stubs: {
				UFormField: UFormFieldStub,
				UIColorPicker: UIColorPickerStub,
				UInputNumber: UInputNumberStub,
				USelect: USelectStub,
				ScreenSettingsToggle: ScreenSettingsToggleStub,
			},
		},
	});
	return { wrapper, onUpdate };
}

describe('screenAnimationEffectFields', () => {
	it('offers every effect in the closed vocabulary, labelled from the catalogue', async () => {
		const { wrapper } = await mountComponent({ effect: 'fog' });
		const options = wrapper.findAll('[data-testid="u-select"] option');

		expect(options.map(option => option.attributes('value'))).toEqual([...ANIMATION_EFFECT_VALUES]);
		expect(options.map(option => option.text())).toContain('Fog');
	});

	it('switching effect starts over from that effect’s schema defaults — no params carry over', async () => {
		const { wrapper, onUpdate } = await mountComponent({ effect: 'fog', params: { speed: 2 } as never });

		await wrapper.find('[data-testid="u-select"]').setValue('caustics');

		expect(onUpdate).toHaveBeenCalledWith({ effect: 'caustics' });
	});

	it('renders the named effect’s params from its schema and writes the full bag back, pinning every current value', async () => {
		const { wrapper, onUpdate } = await mountComponent({ effect: 'fog' });

		const speedInput = wrapper.findAll('[data-testid="u-input-number"]').at(1)!;
		await speedInput.setValue('2');

		const selection = onUpdate.mock.calls.at(-1)?.[0] as { effect: string; params: Record<string, unknown> };
		expect(selection.effect).toBe('fog');
		expect(selection.params).toMatchObject({
			speed: 2,
			blurFactor: 0.55,
			highlightColor: '#f59e0b',
		});
	});

	it('clamps an out-of-range number to the schema bounds instead of writing it', async () => {
		const { wrapper, onUpdate } = await mountComponent({ effect: 'fog' });

		const speedInput = wrapper.findAll('[data-testid="u-input-number"]').at(1)!;
		await speedInput.setValue('99');

		const selection = onUpdate.mock.calls.at(-1)?.[0] as { params: Record<string, unknown> };
		expect(selection.params.speed).toBe(4);
	});

	it('renders a toggle param with its description and writes it into the bag', async () => {
		const { wrapper, onUpdate } = await mountComponent({ effect: 'dots' });

		const toggle = wrapper.findAll('[data-testid="settings-toggle"]').find(candidate => candidate.text() === 'Connecting lines');
		expect(toggle).toBeDefined();
		expect(toggle!.attributes('data-description')).toBe('Render connecting line segments between dots.');

		await toggle!.trigger('click');

		const selection = onUpdate.mock.calls.at(-1)?.[0] as { params: Record<string, unknown> };
		expect(selection.params.showLines).toBe(false);
	});
});
