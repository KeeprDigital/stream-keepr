import type { FeatureMatchResponse } from '~~/shared/api';
import type { FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { describe, expect, it } from 'vitest';
import { featureMatchPublicRow } from '~~/server/utils/featureMatchPublicRow';
import { featureMatchTokenValues } from '~~/shared/featureMatchOverlayValues';
import { createInitialFeatureMatchSessionStateFromSnapshot } from '~~/shared/modules/feature-match-session';
import { commanderSnapshot, twoPlayerSnapshot } from '~~/test/helpers/featureMatchSnapshots';

// What the public Feature Match read adds to a Slot's tokens: the clock at the
// time of the read and each Seat's live state, by the Event's kind (ADR-0056).

const NOW = Date.UTC(2026, 10, 14, 12);
const WHITE = '#FFFFFFFF';
const TRANSPARENT = '#00000000';

/** How an Event shows a record, which every Event holds. */
const DISPLAY = {
	displayRecordSeparator: '-',
	displayHideZeroDraws: true,
	displayPositionFormat: 'ordinal',
} as const;
const TWO_PLAYER_EVENT = {
	...DISPLAY,
	name: 'Open',
	game: 'mtg',
	variant: 'two-player',
} as const;
const COMMANDER_EVENT = {
	...DISPLAY,
	name: 'Commander Night',
	game: 'mtg',
	variant: 'commander',
} as const;
const ONE_PIECE_EVENT = {
	...DISPLAY,
	name: 'Regional',
	game: 'op',
	variant: null,
} as const;

type RowEvent = Parameters<typeof featureMatchPublicRow>[0]['event'];

const PAIR_LIVE_FIELDS = [
	'clock',
	'player1Life',
	'player1GameWins',
	'player2Life',
	'player2GameWins',
	'player1Game1Win',
	'player1Game2Win',
	'player2Game1Win',
	'player2Game2Win',
];

/** A Slot seating its snapshot's players, with that Session active when `state` is given. */
function slot(snapshot: FeatureMatchSourceSnapshot, state?: FeatureMatchState | null): FeatureMatchResponse {
	return {
		player1Id: null,
		player2Id: null,
		player1Data: snapshot.player1?.data ?? null,
		player2Data: snapshot.player2?.data ?? null,
		player3Data: snapshot.player3?.data ?? null,
		player4Data: snapshot.player4?.data ?? null,
		activeSession: state
			? { sourceSnapshot: snapshot, currentState: state }
			: null,
	} as FeatureMatchResponse;
}

function rowOf(event: RowEvent, featureMatch: FeatureMatchResponse) {
	return featureMatchPublicRow({
		event,
		featureMatch,
		sourceMatch: null,
		round: null,
		phase: null,
	}, NOW);
}

/** A Slot with its Session as it opens, changed by `change`. */
function inSession(snapshot: FeatureMatchSourceSnapshot, change: (state: FeatureMatchState) => void = () => {}) {
	const state = createInitialFeatureMatchSessionStateFromSnapshot(snapshot);
	change(state);
	return slot(snapshot, state);
}

describe('the public Feature Match row', () => {
	// A vMix title binds by field name, so each kind of Event has a fixed list (ADR-0056, ADR-0087).
	it.each([
		{
			name: 'a Two-Player Event the pair\'s life and game wins',
			event: TWO_PLAYER_EVENT,
			featureMatch: inSession(twoPlayerSnapshot()),
			live: PAIR_LIVE_FIELDS,
		},
		{
			name: 'a One Piece Card Game Event the same',
			event: ONE_PIECE_EVENT,
			featureMatch: inSession(twoPlayerSnapshot({ game: 'op' })),
			live: PAIR_LIVE_FIELDS,
		},
		{
			name: 'a Commander Event each Seat\'s life and Eliminated state, and no game win',
			event: COMMANDER_EVENT,
			featureMatch: inSession(commanderSnapshot()),
			live: [
				'clock',
				'player1Life',
				'player1Eliminated',
				'player2Life',
				'player2Eliminated',
				'player3Life',
				'player3Eliminated',
				'player4Life',
				'player4Eliminated',
			],
		},
	])('adds to the tokens of $name', ({ event, featureMatch, live }) => {
		const tokens = featureMatchTokenValues({
			event,
			featureMatch,
			sourceMatch: null,
			round: null,
			phase: null,
		});

		expect(Object.entries(rowOf(event, featureMatch))).toEqual([
			...Object.entries(tokens),
			...live.map(field => [
				field,
				expect.any(String),
			]),
		]);
	});

	describe('of a Two-Player Slot', () => {
		it('reads the pair\'s life, game wins and the clock as of now from its Session', () => {
			expect(rowOf(TWO_PLAYER_EVENT, inSession(twoPlayerSnapshot(), (state) => {
				state.player1.lifeTotal = 12;
				state.player2.gameWins = 1;
				state.clock = {
					...state.clock,
					durationMs: 600_000,
					isRunning: true,
					lastStartedAt: NOW - 90_000,
				};
			}))).toMatchObject({
				clock: '8:30',
				player1Life: '12',
				player1GameWins: '0',
				player2Life: '20',
				player2GameWins: '1',
			});
		});

		it('reads no Session as the Overlay does: no life, no game won, a clock at zero', () => {
			expect(rowOf(TWO_PLAYER_EVENT, slot(twoPlayerSnapshot()))).toMatchObject({
				clock: '0:00',
				player1Life: '',
				player1GameWins: '0',
				player2Life: '',
				player2GameWins: '0',
				player1Game1Win: TRANSPARENT,
				player1Game2Win: TRANSPARENT,
				player2Game1Win: TRANSPARENT,
				player2Game2Win: TRANSPARENT,
			});
		});

		it.each([
			{ gameWins: 0, game1: TRANSPARENT, game2: TRANSPARENT },
			{ gameWins: 1, game1: WHITE, game2: TRANSPARENT },
			{ gameWins: 2, game1: WHITE, game2: WHITE },
		])('colours each game white once won, transparent before ($gameWins won)', ({ gameWins, game1, game2 }) => {
			expect(rowOf(TWO_PLAYER_EVENT, inSession(twoPlayerSnapshot(), (state) => {
				state.player2.gameWins = gameWins;
			}))).toMatchObject({
				player1Game1Win: TRANSPARENT,
				player2Game1Win: game1,
				player2Game2Win: game2,
			});
		});
	});

	describe('of a Commander Slot', () => {
		it('reads each Seat\'s life, and colours a Seat white while it is Eliminated', () => {
			expect(rowOf(COMMANDER_EVENT, inSession(commanderSnapshot(), (state) => {
				state.player2.lifeTotal = 31;
				state.player3!.eliminated = true;
				state.player4!.lifeTotal = -2;
			}))).toMatchObject({
				player1Life: '40',
				player1Eliminated: TRANSPARENT,
				player2Life: '31',
				player2Eliminated: TRANSPARENT,
				player3Life: '40',
				player3Eliminated: WHITE,
				player4Life: '-2',
				player4Eliminated: TRANSPARENT,
			});
		});

		// An empty Seat is not in the game, though the Session holds a state for it (ADR-0087).
		it('reads an empty Seat as no life and not Eliminated', () => {
			expect(rowOf(COMMANDER_EVENT, inSession(commanderSnapshot({ player4: null }), (state) => {
				state.player4!.eliminated = true;
			}))).toMatchObject({
				player3Life: '40',
				player4Life: '',
				player4Eliminated: TRANSPARENT,
			});
		});

		it('reads no Session as no life and nobody Eliminated', () => {
			expect(rowOf(COMMANDER_EVENT, slot(commanderSnapshot()))).toMatchObject({
				player1Life: '',
				player1Eliminated: TRANSPARENT,
				player4Life: '',
				player4Eliminated: TRANSPARENT,
			});
		});

		// A vMix title's field list must not change as Seats fill.
		it('names the same fields with two Seats filled as with four', () => {
			const two = rowOf(COMMANDER_EVENT, inSession(commanderSnapshot({ player2: null, player4: null })));
			const four = rowOf(COMMANDER_EVENT, inSession(commanderSnapshot()));

			expect(Object.keys(two)).toEqual(Object.keys(four));
			expect(two).toMatchObject({
				player1Name: 'Ana',
				player2Name: '',
				player3Name: 'Cleo',
				player4Name: '',
			});
		});

		it('reads an untimed game\'s clock as the Event\'s Untimed Label', () => {
			const event = { ...COMMANDER_EVENT, featureMatchDefaultUntimedLabel: 'Casual' };

			expect(rowOf(event, inSession(commanderSnapshot())).clock).toBe('Casual');
		});
	});
});
