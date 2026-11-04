import type { PlayerData } from '~/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { createMockPlayer } from '~~/test/helpers/fixtures';
import { LUFFY, ZORO } from '~~/test/helpers/opCards';
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
	const linlinDeckList = { id: 31, mainboardCount: 50, leaderNumber: ZORO.number };
	const linlin = createMockPlayer({
		id: 7,
		name: '',
		nickname: 'linlin_88',
		externalId: '0012345678',
		externalSource: 'tcgplus',
		gameData: { type: 'op', deckList: linlinDeckList },
	});
	const ava = createMockPlayer({ id: 8, name: 'Ava Reed', nickname: 'avareed' });

	function mountOpSide(options: { playerId?: number | null; gameData?: PlayerData['gameData'] } = {}) {
		const player = reactive<PlayerData>({
			...DEFAULT_PLAYER_DATA,
			gameData: options.gameData ?? {
				type: 'op',
				leader: LUFFY,
				featureMatchDeckList: { id: 4, mainboardCount: 50 },
			},
		});
		const wrapper = mount(PlayerForm, {
			props: {
				'modelValue': player,
				'displayMode': 'position',
				'game': 'op',
				'players': [linlin, ava] as never,
				'playerId': options.playerId ?? null,
				'formId': 'op-side-form',
				'slotId': 3,
				'side': 'player1',
				'onUpdate:modelValue': (value: typeof player) => Object.assign(player, value),
			},
			global: {
				stubs: {
					...nuxtUiStubs,
					UInputMenu: UInputMenuStub,
					FeatureMatchSetupMtgPlayerFields: true,
					FeatureMatchSetupOpPlayerFields: { template: '<div data-leader-picker />' },
					FeatureMatchSetupDeckListField: { template: '<div data-deck-list-paste />' },
					PlayerOpDeckListModal: {
						props: ['player'],
						emits: ['close'],
						template: '<div data-player-deck-list-editor :data-player-id="player.id" @click="$emit(\'close\')" />',
					},
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

	// A linked side shows the Player's Deck List, so it drops the side's own (ADR-0074).
	it('seats the Player with their Nickname and their Deck List in place of the side\'s own', async () => {
		const { wrapper, player } = mountOpSide();

		await wrapper.findAll('[role="option"]')[0]!.trigger('click');

		expect(wrapper.emitted('update:playerId')).toEqual([
			[7],
		]);
		expect(player).toMatchObject({
			name: '',
			nickname: 'linlin_88',
			gameData: { type: 'op', leader: null, deckList: linlinDeckList },
		});
	});

	it.each([
		{ side: 'an unlinked side', playerId: null, own: true },
		{ side: 'a linked side', playerId: 7, own: false },
	])('offers $side its own Leader picker and paste: $own', ({ playerId, own }) => {
		const { wrapper } = mountOpSide({ playerId });

		expect(wrapper.find('[data-leader-picker]').exists()).toBe(own);
		expect(wrapper.find('[data-deck-list-paste]').exists()).toBe(own);
		expect(wrapper.find('[data-linked-deck-list]').exists()).toBe(!own);
	});

	it('shows a linked side\'s Leader and Deck List as the Player\'s, and edits them as the Player\'s', async () => {
		const { wrapper } = mountOpSide({
			playerId: 7,
			gameData: { type: 'op', leader: ZORO, deckList: linlinDeckList },
		});

		expect(wrapper.get('[data-linked-deck-list] [data-leader]').text()).toContain(ZORO.name);
		expect(wrapper.get('[data-linked-deck-list]').attributes('data-mainboard-count')).toBe('50');
		expect(wrapper.find('[data-player-deck-list-editor]').exists()).toBe(false);

		await wrapper.get('[aria-label="Edit the Player\'s Deck List"]').trigger('click');
		expect(wrapper.get('[data-player-deck-list-editor]').attributes('data-player-id')).toBe('7');

		await wrapper.get('[data-player-deck-list-editor]').trigger('click');
		expect(wrapper.find('[data-player-deck-list-editor]').exists()).toBe(false);
	});

	it('names a linked side\'s Leader by its card number until the side is saved', () => {
		const { wrapper } = mountOpSide({
			playerId: 7,
			gameData: { type: 'op', leader: null, deckList: linlinDeckList },
		});

		expect(wrapper.get('[data-linked-deck-list] [data-leader]').text()).toContain(ZORO.number);
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
