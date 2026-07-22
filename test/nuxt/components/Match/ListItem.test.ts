import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMockMatch, createMockPlayer } from '~~/test/helpers/fixtures';

const mockDeckCache = {
	getActiveDeckForPlayer: vi.fn(() => null),
};

mockNuxtImport('usePlayerDeckCache', () => () => mockDeckCache);

const UBadgeStub = defineComponent({
	props: {
		color: { type: String, required: false },
	},
	template: '<span data-testid="badge" :data-color="color"><slot /></span>',
});

const UButtonStub = defineComponent({
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

const UDropdownMenuStub = defineComponent({
	template: '<div><slot /><slot name="item-label" :item="{}" /></div>',
});

async function mountComponent(matchOverrides?: Parameters<typeof createMockMatch>[0]) {
	const { default: MatchListItem } = await import('~/components/Match/ListItem.vue');

	return mount(MatchListItem, {
		props: {
			match: createMockMatch({
				player1Id: 1,
				player2Id: 2,
				player1Data: { name: 'Alice' } as never,
				player2Data: { name: 'Bob' } as never,
				...matchOverrides,
			}),
			players: [
				createMockPlayer({ id: 1, name: 'Alice' }),
				createMockPlayer({ id: 2, name: 'Bob' }),
			],
			featureMatchLabel: null,
			featureMatchMenuItems: [],
			promoting: false,
			resultsEditable: true,
		},
		global: {
			stubs: {
				UBadge: UBadgeStub,
				UButton: UButtonStub,
				UDropdownMenu: UDropdownMenuStub,
				MtgManaColorDisplay: true,
				UIcon: true,
			},
		},
	});
}

describe('matchListItem', () => {
	beforeEach(() => {
		mockDeckCache.getActiveDeckForPlayer.mockReset();
		mockDeckCache.getActiveDeckForPlayer.mockReturnValue(null);
	});

	it('emphasizes player 1 and mutes player 2 when player 1 wins', async () => {
		const wrapper = await mountComponent({
			hasResult: true,
			player1GameWins: 2,
			player2GameWins: 1,
			resultString: '2-1',
		});

		expect(wrapper.get('[data-testid="player1-name"]').classes()).toContain('text-primary');
		expect(wrapper.get('[data-testid="player2-name"]').classes()).toContain('text-muted');
		expect(wrapper.text()).toContain('2');
		expect(wrapper.text()).toContain('1');
		expect(wrapper.find('[data-testid="match-state"]').exists()).toBe(false);
	});

	it('emphasizes player 2 and mutes player 1 when player 2 wins', async () => {
		const wrapper = await mountComponent({
			hasResult: true,
			player1GameWins: 0,
			player2GameWins: 2,
			resultString: '0-2',
		});

		expect(wrapper.get('[data-testid="player1-name"]').classes()).toContain('text-muted');
		expect(wrapper.get('[data-testid="player2-name"]').classes()).toContain('text-primary');
		expect(wrapper.find('[data-testid="match-state"]').exists()).toBe(false);
	});

	it('dims both names and uses draw-colored scores when the result is tied', async () => {
		const wrapper = await mountComponent({
			hasResult: true,
			player1GameWins: 1,
			player2GameWins: 1,
			gameDraws: 1,
			resultString: '1-1-1',
		});

		expect(wrapper.get('[data-testid="player1-name"]').classes()).toContain('text-muted');
		expect(wrapper.get('[data-testid="player2-name"]').classes()).toContain('text-muted');
		expect(wrapper.get('[data-testid="player1-score"]').attributes('data-color')).toBe('info');
		expect(wrapper.get('[data-testid="player2-score"]').attributes('data-color')).toBe('info');
		expect(wrapper.find('[data-testid="match-state"]').exists()).toBe(false);
	});

	it('does not show a result-state badge when no result has been entered', async () => {
		const wrapper = await mountComponent({
			hasResult: false,
			player1GameWins: null,
			player2GameWins: null,
			resultString: null,
		});

		expect(wrapper.find('[data-testid="match-state"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="player1-name"]').classes()).toContain('font-medium');
		expect(wrapper.get('[data-testid="player2-name"]').classes()).toContain('font-medium');
	});

	it('keeps the bye layout and copy', async () => {
		const wrapper = await mountComponent({
			isBye: true,
			player2Id: null,
			player2Data: null,
		});

		expect(wrapper.text()).toContain('Bye');
		expect(wrapper.text()).toContain('Alice');
	});
});
