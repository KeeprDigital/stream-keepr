import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent, createMockFeatureMatchState } from '~~/test/helpers/fixtures';

// ── Shared mock data ──

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

const mockMatchState = createMockFeatureMatchState();
const matchStatesMap = new Map([[1, mockMatchState]]);

const mockMatches = ref([
	{ id: 1, bestOf: 3, player1Data: p1Data, player2Data: p2Data, playerDisplayMode: 'score' },
]);

const mockEvent = ref(createMockEvent());

mockNuxtImport('useFeatureMatchStore', () => () => ({
	featureMatches: mockMatches.value,
}));
mockNuxtImport('useFeatureMatchStateStore', () => () => ({
	featureMatchStates: matchStatesMap,
}));
mockNuxtImport('useEventStore', () => () => ({
	event: mockEvent.value,
	$reset: vi.fn(),
}));

describe('usePlayerFeatureMatchData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset to defaults
		mockMatches.value = [
			{ id: 1, bestOf: 3, player1Data: p1Data, player2Data: p2Data, playerDisplayMode: 'score' },
		];
		mockEvent.value = createMockEvent();
	});

	// ── match / matchState ──

	it('returns null match for unknown matchId', () => {
		const { match } = usePlayerFeatureMatchData(999, 'player1');
		expect(match.value).toBeNull();
	});

	it('returns null matchState for unknown matchId', () => {
		const { matchState } = usePlayerFeatureMatchData(999, 'player1');
		expect(matchState.value).toBeNull();
	});

	// ── player ──

	it('returns null player when matchState missing', () => {
		const { player } = usePlayerFeatureMatchData(999, 'player1');
		expect(player.value).toBeNull();
	});

	// ── playerName ──

	it('resolves playerName for player1', () => {
		const { playerName } = usePlayerFeatureMatchData(1, 'player1');
		expect(playerName.value).toBe('Alice');
	});

	it('resolves playerName for player2', () => {
		const { playerName } = usePlayerFeatureMatchData(1, 'player2');
		expect(playerName.value).toBe('Bob');
	});

	// ── playerPronouns ──

	it('resolves playerPronouns', () => {
		const { playerPronouns } = usePlayerFeatureMatchData(1, 'player1');
		expect(playerPronouns.value).toBe('she/her');
	});

	it('returns undefined pronouns when playerData is null', () => {
		mockMatches.value = [
			{ id: 1, bestOf: 3, player1Data: null as any, player2Data: p2Data, playerDisplayMode: 'score' },
		];
		const { playerPronouns } = usePlayerFeatureMatchData(1, 'player1');
		expect(playerPronouns.value).toBeUndefined();
	});

	// ── deckName ──

	it('resolves deckName from mtg gameData', () => {
		const { deckName } = usePlayerFeatureMatchData(1, 'player1');
		expect(deckName.value).toBe('Azorius Control');
	});

	it('returns undefined deckName when no gameData', () => {
		mockMatches.value = [
			{ id: 1, bestOf: 3, player1Data: { ...p1Data, gameData: null as any }, player2Data: p2Data, playerDisplayMode: 'score' },
		];
		const { deckName } = usePlayerFeatureMatchData(1, 'player1');
		expect(deckName.value).toBeUndefined();
	});

	// ── bestOf ──

	it('resolves bestOf from match', () => {
		const { bestOf } = usePlayerFeatureMatchData(1, 'player1');
		expect(bestOf.value).toBe(3);
	});

	it('defaults to 3 when match is null', () => {
		const { bestOf } = usePlayerFeatureMatchData(999, 'player1');
		expect(bestOf.value).toBe(3);
	});

	// ── seatLabel ──

	it('returns undefined seatLabel for horizontal orientation', () => {
		mockEvent.value = createMockEvent({ featureMatchOrientation: 'horizontal' });
		const { seatLabel } = usePlayerFeatureMatchData(1, 'player1');
		expect(seatLabel.value).toBeUndefined();
	});

	it('returns "Top" for player1 in vertical orientation', () => {
		mockEvent.value = createMockEvent({ featureMatchOrientation: 'vertical' });
		const { seatLabel } = usePlayerFeatureMatchData(1, 'player1');
		expect(seatLabel.value).toBe('Top');
	});

	it('returns "Bottom" for player2 in vertical orientation', () => {
		mockEvent.value = createMockEvent({ featureMatchOrientation: 'vertical' });
		const { seatLabel } = usePlayerFeatureMatchData(1, 'player2');
		expect(seatLabel.value).toBe('Bottom');
	});

	// ── playerLgs ──

	it('resolves playerLgs', () => {
		const { playerLgs } = usePlayerFeatureMatchData(1, 'player1');
		expect(playerLgs.value).toBe('Card Kingdom');
	});

	// ── playerRecord (score mode) ──

	describe('playerRecord — score mode', () => {
		it('formats W-L (hides zero draws by default)', () => {
			const { playerRecord } = usePlayerFeatureMatchData(1, 'player1');
			expect(playerRecord.value).toBe('3-1');
		});

		it('includes draws when non-zero', () => {
			const { playerRecord } = usePlayerFeatureMatchData(1, 'player2');
			// p2Data: wins=2, losses=2, draws=1
			expect(playerRecord.value).toBe('2-2-1');
		});

		it('uses custom separator from event', () => {
			mockEvent.value = createMockEvent({ displayRecordSeparator: '/' });
			const { playerRecord } = usePlayerFeatureMatchData(1, 'player1');
			expect(playerRecord.value).toBe('3/1');
		});

		it('shows draws when hideZeroDraws is false', () => {
			mockEvent.value = createMockEvent({ displayHideZeroDraws: false });
			const { playerRecord } = usePlayerFeatureMatchData(1, 'player1');
			expect(playerRecord.value).toBe('3-1-0');
		});
	});

	// ── playerRecord (position mode) ──

	describe('playerRecord — position mode', () => {
		it('formats position as ordinal by default', () => {
			mockMatches.value = [
				{ id: 1, bestOf: 3, player1Data: p1Data, player2Data: p2Data, playerDisplayMode: 'position' },
			];
			const { playerRecord } = usePlayerFeatureMatchData(1, 'player1');
			// p1Data.position = 1, displayPositionFormat = 'ordinal' by default
			expect(playerRecord.value).toBe('1st');
		});

		it('formats position as plain number when format is not ordinal', () => {
			mockMatches.value = [
				{ id: 1, bestOf: 3, player1Data: p1Data, player2Data: p2Data, playerDisplayMode: 'position' },
			];
			mockEvent.value = createMockEvent({ displayPositionFormat: 'numeric' as any });
			const { playerRecord } = usePlayerFeatureMatchData(1, 'player1');
			expect(playerRecord.value).toBe('1');
		});

		it('handles string position that is not a number', () => {
			mockMatches.value = [
				{ id: 1, bestOf: 3, player1Data: { ...p1Data, position: 'N/A' as any }, player2Data: p2Data, playerDisplayMode: 'position' },
			];
			const { playerRecord } = usePlayerFeatureMatchData(1, 'player1');
			expect(playerRecord.value).toBe('N/A');
		});
	});
});
