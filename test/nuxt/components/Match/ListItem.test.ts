import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMockMatch, createMockPlayer } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import MatchListItem from '~/components/Match/ListItem.vue';

const mockDeckCache = {
	getActiveDeckForPlayer: vi.fn(() => null),
};

mockNuxtImport('usePlayerDeckCache', () => () => mockDeckCache);

const { openPlayerMatchHistory } = vi.hoisted(() => ({
	openPlayerMatchHistory: vi.fn(),
}));
mockNuxtImport('usePlayerMatchHistoryModal', () => () => ({ openPlayerMatchHistory }));

const MatchNotePopoverStub = defineComponent({
	props: [
		'note',
		'noteKey',
		'save',
		'remoteChanged',
	],
	template: '<div data-testid="match-note-popover" :data-note="note" :data-remote-changed="String(remoteChanged)"><slot /><button data-testid="match-note-save" @click="save(\'Edited from Matches\')">Save Note</button></div>',
});

async function mountComponent(
	matchOverrides?: Parameters<typeof createMockMatch>[0],
	itemOverrides: Record<string, unknown> = {},
) {
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
			...itemOverrides,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				MatchNotePopover: MatchNotePopoverStub,
				MtgManaColorDisplay: true,
				UIcon: true,
			},
		},
	});
}

describe('matchListItem', () => {
	beforeEach(() => {
		openPlayerMatchHistory.mockReset();
		mockDeckCache.getActiveDeckForPlayer.mockReset();
		mockDeckCache.getActiveDeckForPlayer.mockReturnValue(null);
	});

	it.each([
		[
			'player 1 wins',
			2,
			1,
			0,
			['win', 'loss'],
		],
		[
			'player 2 wins',
			0,
			2,
			0,
			['loss', 'win'],
		],
		[
			'the games are tied',
			1,
			1,
			1,
			['draw', 'draw'],
		],
	])('marks each side\'s outcome when %s', async (_, player1GameWins, player2GameWins, gameDraws, outcomes) => {
		const wrapper = await mountComponent({
			hasResult: true,
			player1GameWins,
			player2GameWins,
			gameDraws,
		});

		expect([
			wrapper.get('[data-testid="player1-name"]').attributes('data-outcome'),
			wrapper.get('[data-testid="player2-name"]').attributes('data-outcome'),
		]).toEqual(outcomes);
		expect(wrapper.get('[data-testid="player1-score"]').text()).toBe(String(player1GameWins));
		expect(wrapper.get('[data-testid="player2-score"]').text()).toBe(String(player2GameWins));
	});

	it('marks no outcome or score before Melee reports a result', async () => {
		const wrapper = await mountComponent({
			hasResult: false,
			player1GameWins: null,
			player2GameWins: null,
		});

		expect(wrapper.get('[data-testid="player1-name"]').attributes('data-outcome')).toBeUndefined();
		expect(wrapper.find('[data-testid="player1-score"]').exists()).toBe(false);
	});

	// A Match Result is Melee's alone (ADR-0047), so a manual Match has none to enter.
	it.each([
		[
			'an unreported manual Match',
			{ externalSource: 'manual', hasResult: false },
		],
		[
			'a reported Match',
			{
				hasResult: true,
				player1GameWins: 2,
				player2GameWins: 0,
				gameDraws: 0,
			},
		],
	] as const)('offers no way to enter or edit a result on %s', async (_, match) => {
		const wrapper = await mountComponent(match);

		expect(wrapper.text()).not.toMatch(/(Enter|Edit) Result/);
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

	it('previews the Assignment Note once, flagging a colleague\'s change', async () => {
		const wrapper = await mountComponent({}, {
			featureMatchLabel: 'Featured 1',
			featureMatchAssignment: {
				id: 9,
				eventId: 1,
				roundId: 3,
				slotId: 2,
				matchId: 1,
				note: 'Keep an eye on the sideboard plan',
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			assignmentNoteRemoteChanged: true,
			saveAssignmentNote: vi.fn().mockResolvedValue(undefined),
		});

		expect(wrapper.get('.match-note-preview').text()).toContain('Keep an eye on the sideboard plan');
		expect(wrapper.text().match(/Keep an eye on the sideboard plan/g)).toHaveLength(1);
		expect(wrapper.get('[data-testid="match-note-popover"]').attributes('data-remote-changed')).toBe('true');
	});

	it('offers to add a Note when the Assignment has none, saving through the page', async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		const wrapper = await mountComponent({}, {
			featureMatchLabel: 'Featured 1',
			featureMatchAssignment: {
				id: 9,
				eventId: 1,
				roundId: 3,
				slotId: 2,
				matchId: 1,
				note: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			saveAssignmentNote: save,
		});

		expect(wrapper.find('.match-note-preview').exists()).toBe(false);
		expect(wrapper.find('[aria-label="Add feature match note"]').exists()).toBe(true);
		await wrapper.get('[data-testid="match-note-save"]').trigger('click');
		expect(save).toHaveBeenCalledWith(9, 'Edited from Matches');
	});

	// The page passes no save when the Event has Feature Match Notes switched off.
	it('shows no Note preview or editor when no Note save is offered', async () => {
		const wrapper = await mountComponent({}, {
			featureMatchLabel: 'Featured 1',
			featureMatchAssignment: {
				id: 9,
				eventId: 1,
				roundId: 3,
				slotId: 2,
				matchId: 1,
				note: 'Keep an eye on the sideboard plan',
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});

		expect(wrapper.find('.match-note-preview').exists()).toBe(false);
		expect(wrapper.find('[data-testid="match-note-popover"]').exists()).toBe(false);
	});

	it.each([
		['player 1', {}, 'Alice', 1],
		['player 2', {}, 'Bob', 2],
		[
			'a bye',
			{ player2Id: null, player2Data: null },
			'Alice',
			1,
		],
	])('opens %s\'s match history from their name', async (_, matchOverrides, name, playerId) => {
		const wrapper = await mountComponent(matchOverrides as never);

		await wrapper.findAll('button').find(button => button.text() === name)!.trigger('click');

		expect(openPlayerMatchHistory).toHaveBeenCalledWith(expect.objectContaining({ id: playerId, name }));
	});

	it('shows a seat with no Player as plain text', async () => {
		const wrapper = await mountComponent({
			player2Id: null,
			player2Data: { name: 'TBD' } as never,
		});

		expect(wrapper.get('[data-testid="player2-name"]').element.tagName).toBe('SPAN');
		expect(wrapper.get('[data-testid="player1-name"]').element.tagName).toBe('BUTTON');
	});
});
