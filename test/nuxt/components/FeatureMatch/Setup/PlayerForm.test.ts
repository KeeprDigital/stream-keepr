import type { PlayerData } from '~/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { createMockPlayer } from '~~/test/helpers/fixtures';
import { LUFFY } from '~~/test/helpers/opCards';
import { nuxtUiStubs, UInputMenuStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
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

describe('linking a One Piece Card Game Player into a side', () => {
	const linlin = createMockPlayer({
		id: 7,
		name: '',
		nickname: 'linlin_88',
		externalId: '0012345678',
		externalSource: 'tcgplus',
	});
	const ava = createMockPlayer({ id: 8, name: 'Ava Reed', nickname: 'avareed' });

	function mountOpSide() {
		const player = reactive<PlayerData>({
			...DEFAULT_PLAYER_DATA,
			gameData: { type: 'op', leader: LUFFY },
		});
		const wrapper = mount(PlayerForm, {
			props: {
				'modelValue': player,
				'displayMode': 'position',
				'game': 'op',
				'players': [linlin, ava] as never,
				'formId': 'op-side-form',
				'onUpdate:modelValue': (value: typeof player) => Object.assign(player, value),
			},
			global: {
				stubs: {
					...nuxtUiStubs,
					UInputMenu: UInputMenuStub,
					FeatureMatchSetupMtgPlayerFields: true,
					FeatureMatchSetupOpPlayerFields: true,
				},
			},
		});
		return { wrapper, player };
	}

	const options = (wrapper: ReturnType<typeof mountOpSide>['wrapper']) =>
		wrapper.findAll('[role="option"]').map(option => option.text());

	// Pickers show and find Players by the shared name-or-Nickname rule (ADR-0074).
	it.each([
		[
			'',
			['linlin_88', 'Ava Reed'],
		],
		[
			'LINLIN',
			['linlin_88'],
		],
		[
			'avareed',
			['Ava Reed'],
		],
		[
			'0012345',
			['linlin_88'],
		],
	])('searching %j offers %j', async (query, offered) => {
		const { wrapper } = mountOpSide();

		await wrapper.get('[role="combobox"]').setValue(query);

		expect(options(wrapper)).toEqual(offered);
	});

	// The side's Leader stays its own until the Player's Deck List reaches it (#1006).
	it('seats the Player with their Nickname and keeps the side\'s own Leader', async () => {
		const { wrapper, player } = mountOpSide();

		await wrapper.findAll('[role="option"]')[0]!.trigger('click');

		expect(wrapper.emitted('update:playerId')).toEqual([
			[7],
		]);
		expect(player).toMatchObject({
			name: '',
			nickname: 'linlin_88',
			gameData: { type: 'op', leader: LUFFY },
		});
	});
});

describe('featureMatchSetupPlayerForm submit', () => {
	it('emits submit when the player form submits', async () => {
		const submit = vi.fn();
		const { wrapper } = await mountComponent();

		await wrapper.setProps({ onSubmit: submit });
		await wrapper.get('form').trigger('submit');

		expect(submit).toHaveBeenCalledOnce();
	});
});
