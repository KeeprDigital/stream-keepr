import type { AnimationEffectSelection } from '~~/shared/animationEffects';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { ANIMATION_EFFECT_VALUES } from '~~/shared/animationEffects';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import AnimationEffectFields from '~/components/Screen/AnimationEffectFields.vue';

const UIColorPickerStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
		placeholder: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="color-picker" @click="$emit(\'update:modelValue\', \'#123456\')">{{ modelValue }}</button>',
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
	const wrapper = mount(AnimationEffectFields, {
		props: {
			selection,
			'onUpdate:selection': onUpdate,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				ScreenAnimationEffectPresetLibrary: true,
				UIColorPicker: UIColorPickerStub,
				ScreenSettingsToggle: ScreenSettingsToggleStub,
			},
		},
	});
	return { wrapper, onUpdate };
}

describe('screenAnimationEffectFields', () => {
	it('offers every effect in the closed vocabulary, labelled from the catalogue', async () => {
		const { wrapper } = await mountComponent({ effect: 'fog' });
		const options = wrapper.findAll('select option');

		expect(options.map(option => option.attributes('value'))).toEqual([...ANIMATION_EFFECT_VALUES]);
		expect(options.map(option => option.text())).toContain('Fog');
	});

	it('switching effect starts over from that effect’s schema defaults — no params carry over', async () => {
		const { wrapper, onUpdate } = await mountComponent({
			effect: 'fog',
			params: { speed: 2 } as never,
		});

		await wrapper.find('select').setValue('caustics');

		expect(onUpdate).toHaveBeenCalledWith({ effect: 'caustics' });
	});

	it('renders the named effect’s params from its schema and writes the full bag back, pinning every current value', async () => {
		const { wrapper, onUpdate } = await mountComponent({ effect: 'fog' });

		const speedInput = wrapper.findAll('input[type="number"]').at(1)!;
		await speedInput.setValue('2');

		const selection = onUpdate.mock.calls.at(-1)?.[0] as { effect: string; params: Record<string, unknown> };
		expect(selection.effect).toBe('fog');
		expect(selection.params).toMatchObject({
			speed: 2,
			softness: 0.55,
			highlightColor: '#f59e0b',
		});
	});

	it('clamps an out-of-range number to the schema bounds instead of writing it', async () => {
		const { wrapper, onUpdate } = await mountComponent({ effect: 'fog' });

		const speedInput = wrapper.findAll('input[type="number"]').at(1)!;
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
