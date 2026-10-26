import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockEvent, createMockFeatureMatchState, createMockPlayer } from '~~/test/helpers/fixtures';

const p1Data = {
	name: 'Alice',
	pronouns: 'she/her',
	wins: 3,
	losses: 1,
	draws: 0,
	lgs: 'Card Kingdom',
	position: 1,
	gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
};

const p2Data = {
	name: 'Bob',
	pronouns: 'he/him',
	wins: 2,
	losses: 2,
	draws: 1,
	lgs: null,
	position: null,
	gameData: { type: 'mtg', deckName: 'Golgari Midrange', deckColors: 'BG' },
};

function slot(overrides: Record<string, unknown> = {}) {
	return { id: 1, bestOf: 3, player1Data: p1Data, player2Data: p2Data, playerDisplayMode: 'score', activeSession: null, ...overrides };
}

const mockMatches = ref<Record<string, unknown>[]>([]);
const mockEvent = ref(createMockEvent());
const mockRoster = ref<ReturnType<typeof createMockPlayer>[]>([]);

mockNuxtImport('useFeatureMatchStore', () => () => ({ featureMatches: mockMatches.value }));
mockNuxtImport('useFeatureMatchStateStore', () => () => ({
	featureMatchStates: new Map([[1, createMockFeatureMatchState()]]),
}));
mockNuxtImport('useEventStore', () => () => ({ event: mockEvent.value, displayEvent: mockEvent.value }));
mockNuxtImport('usePlayerStore', () => () => ({ players: mockRoster.value }));

describe('usePlayerFeatureMatchData', () => {
	beforeEach(() => {
		mockMatches.value = [slot()];
		mockEvent.value = createMockEvent();
		mockRoster.value = [];
	});

	it.each([
		['player1', { playerName: 'Alice', playerPronouns: 'she/her', playerLgs: 'Card Kingdom', deckName: 'Azorius Control' }],
		['player2', { playerName: 'Bob', playerPronouns: 'he/him', playerLgs: undefined, deckName: 'Golgari Midrange' }],
	] as const)('reads %s from the Slot', (side, expected) => {
		const data = usePlayerFeatureMatchData(1, side);

		expect({
			playerName: data.playerName.value,
			playerPronouns: data.playerPronouns.value,
			playerLgs: data.playerLgs.value,
			deckName: data.deckName.value,
		}).toEqual(expected);
		expect(data.bestOf.value).toBe(3);
		expect(data.player.value).not.toBeNull();
	});

	it('reads the active Session\'s source snapshot over the Slot', () => {
		mockMatches.value = [slot({
			activeSession: {
				sourceSnapshot: {
					bestOf: 5,
					playerDisplayMode: 'position',
					player1: { playerId: 9, data: { ...p1Data, name: 'Snapshot Alice', position: 2 } },
					player2: null,
				},
			},
		})];
		mockEvent.value = createMockEvent({ displayPositionFormat: 'ordinal' });

		const data = usePlayerFeatureMatchData(1, 'player1');

		expect(data.playerName.value).toBe('Snapshot Alice');
		expect(data.bestOf.value).toBe(5);
		expect(data.playerRecord.value).toBe('2nd');
		expect(usePlayerFeatureMatchData(1, 'player2').playerName.value).toBe('Bob');
	});

	it('falls back to a seat name and best of three for a Slot it does not hold', () => {
		const data = usePlayerFeatureMatchData(999, 'player2');

		expect(data.match.value).toBeNull();
		expect(data.matchState.value).toBeNull();
		expect(data.player.value).toBeNull();
		expect(data.playerName.value).toBe('Player 2');
		expect(data.bestOf.value).toBe(3);
		expect(data.playerRecord.value).toBeUndefined();
	});

	it('reads the deck name from the roster Player the Slot seats', () => {
		mockMatches.value = [slot({ player1Id: 21 })];
		mockRoster.value = [createMockPlayer({ id: 21, name: 'Alice', gameData: { type: 'mtg', deckName: 'Reviewed Deck' } })];

		expect(usePlayerFeatureMatchData(1, 'player1').deckName.value).toBe('Reviewed Deck');
	});

	it.each([
		['horizontal', 'player1', undefined],
		['vertical', 'player1', 'Top'],
		['vertical', 'player2', 'Bottom'],
	] as const)('labels the seat in a %s layout for %s', (orientation, side, expected) => {
		mockEvent.value = createMockEvent({ featureMatchOrientation: orientation });

		expect(usePlayerFeatureMatchData(1, side).seatLabel.value).toBe(expected);
	});

	it('shows a score record with the Event\'s record settings', () => {
		mockEvent.value = createMockEvent({ displayRecordSeparator: '/', displayHideZeroDraws: false });

		expect(usePlayerFeatureMatchData(1, 'player1').playerRecord.value).toBe('3/1/0');
	});

	it.each([
		['ordinal', 1, '1st'],
		['numeric', 1, '1'],
		['ordinal', 'N/A', 'N/A'],
		['ordinal', null, undefined],
	])('shows a position record in %s format: %j → %j', (format, position, expected) => {
		mockMatches.value = [slot({ playerDisplayMode: 'position', player1Data: { ...p1Data, position } })];
		mockEvent.value = createMockEvent({ displayPositionFormat: format as any });

		expect(usePlayerFeatureMatchData(1, 'player1').playerRecord.value).toBe(expected);
	});
});
