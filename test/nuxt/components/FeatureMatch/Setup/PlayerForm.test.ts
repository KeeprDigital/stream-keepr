import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import { DEFAULT_PLAYER_DATA } from '~/types';

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: `
		<input
			data-testid="number-input"
			:value="modelValue ?? ''"
			@input="$emit('update:modelValue', $event.target.value === '' ? null : Number($event.target.value))"
		>
	`,
});

async function mountComponent() {
	const componentPath = '../../../../../app/components/FeatureMatch/Setup/' + 'PlayerForm.vue';
	const { default: PlayerForm } = await import(componentPath);
	const player = reactive({ ...DEFAULT_PLAYER_DATA });

	const wrapper = mount(PlayerForm, {
		props: {
			'modelValue': player,
			'displayMode': 'position',
			'game': 'mtg',
			'standingsEnabled': true,
			'formId': 'feature-match-test-player-form',
			'onUpdate:modelValue': (value: typeof player) => Object.assign(player, value),
		},
		global: {
			stubs: {
				UForm: { emits: ['submit'], template: '<form @submit.prevent="$emit(\'submit\', $event)"><slot /></form>' },
				UFormField: { template: '<label><slot /></label>' },
				UInput: { template: '<input>' },
				UInputNumber: UInputNumberStub,
				USeparator: true,
				FeatureMatchSetupMtgPlayerFields: { template: '<div />' },
				FeatureMatchSetupOpPlayerFields: { template: '<div />' },
			},
		},
	});

	return { wrapper, player };
}

describe('featureMatchSetupPlayerForm', () => {
	it('renders the provided form id on the UForm', async () => {
		const { wrapper } = await mountComponent();

		expect(wrapper.get('form').attributes('id')).toBe('feature-match-test-player-form');
	});

	it('emits numeric/null values for position edits', async () => {
		const { wrapper, player } = await mountComponent();
		const input = wrapper.get('[data-testid="number-input"]');

		await input.setValue('4');
		expect(player.position).toBe(4);

		await input.setValue('');
		expect(player.position).toBeNull();
	});

	it('emits submit when the player form submits', async () => {
		const submit = vi.fn();
		const { wrapper } = await mountComponent();

		await wrapper.setProps({ onSubmit: submit });
		await wrapper.get('form').trigger('submit');

		expect(submit).toHaveBeenCalledOnce();
	});
});
