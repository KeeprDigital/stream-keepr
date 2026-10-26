import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import PlayerForm from '~/components/FeatureMatch/Setup/PlayerForm.vue';
import { DEFAULT_PLAYER_DATA } from '~/types';

async function mountComponent() {
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
				...nuxtUiStubs,
				FeatureMatchSetupMtgPlayerFields: true,
				FeatureMatchSetupOpPlayerFields: true,
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
		const input = wrapper.get('input[type="number"]');

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
