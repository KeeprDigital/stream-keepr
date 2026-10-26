import type { HeadToHeadMatchFacts, HeadToHeadPlayerFacts } from '../../../shared/utils/headToHead';
import { describe, expect, it } from 'vitest';
import { projectHeadToHead } from '../../../shared/utils/headToHead';

const ALICE = 1;
const BOB = 2;
const CAROL = 3;

function playerFacts(id: number, name: string, overrides: Partial<HeadToHeadPlayerFacts> = {}): HeadToHeadPlayerFacts {
	return {
		player: {
			id,
			name,
			pronouns: null,
			wins: null,
			losses: null,
			draws: null,
			points: null,
			gameData: null,
		},
		archetype: null,
		latestStanding: null,
		...overrides,
	};
}

let nextMatchId = 100;
function match(overrides: Partial<HeadToHeadMatchFacts> = {}): HeadToHeadMatchFacts {
	return {
		id: nextMatchId++,
		roundId: 10,
		roundName: 'Round 1',
		roundNumber: 1,
		phaseName: 'Swiss',
		phaseSortOrder: 0,
		sortOrder: 0,
		player1Id: ALICE,
		player2Id: BOB,
		player1GameWins: 2,
		player2GameWins: 1,
		gameDraws: 0,
		isBye: false,
		hasResult: true,
		...overrides,
	};
}

describe('projectHeadToHead', () => {
	describe('each Player', () => {
		it('shows their record and points from their latest Round Standings', () => {
			const alice = playerFacts(ALICE, 'Alice', {
				player: {
					id: ALICE,
					name: 'Alice',
					pronouns: 'she/her',
					wins: 1,
					losses: 1,
					draws: 0,
					points: 3,
					gameData: null,
				},
				latestStanding: {
					wins: 4,
					losses: 1,
					draws: 1,
					points: 13,
				},
			});

			const { player1 } = projectHeadToHead({
				player1: alice,
				player2: null,
				matches: [],
				currentMatchId: null,
			});

			expect(player1).toMatchObject({
				id: ALICE,
				name: 'Alice',
				pronouns: 'she/her',
				wins: 4,
				losses: 1,
				draws: 1,
				points: 13,
			});
		});

		it('falls back to the Player\'s own record when no Round Standings hold them', () => {
			const bob = playerFacts(BOB, 'Bob', {
				player: {
					id: BOB,
					name: 'Bob',
					pronouns: null,
					wins: 3,
					losses: 2,
					draws: null,
					points: 9,
					gameData: null,
				},
			});

			const { player2 } = projectHeadToHead({
				player1: null,
				player2: bob,
				matches: [],
				currentMatchId: null,
			});

			expect(player2).toMatchObject({
				wins: 3,
				losses: 2,
				draws: null,
				points: 9,
			});
		});

		it('shows their assigned Archetype', () => {
			const alice = playerFacts(ALICE, 'Alice', {
				archetype: { name: 'Boros Energy', colors: 'RW' },
			});

			const { player1 } = projectHeadToHead({
				player1: alice,
				player2: null,
				matches: [],
				currentMatchId: null,
			});

			expect(player1).toMatchObject({ deckName: 'Boros Energy', deckColors: 'RW' });
		});

		it('shows the deck name their Deck List projects when they have no Archetype', () => {
			const bob = playerFacts(BOB, 'Bob', {
				player: {
					id: BOB,
					name: 'Bob',
					pronouns: null,
					wins: null,
					losses: null,
					draws: null,
					points: null,
					gameData: { type: 'mtg', deckName: 'Dimir Murktide', deckColors: 'UB' },
				},
			});

			const { player2 } = projectHeadToHead({
				player1: null,
				player2: bob,
				matches: [],
				currentMatchId: null,
			});

			expect(player2).toMatchObject({ deckName: 'Dimir Murktide', deckColors: 'UB' });
		});

		it('leaves a side no Player fills empty', () => {
			expect(projectHeadToHead({
				player1: null,
				player2: null,
				matches: [],
				currentMatchId: null,
			}))
				.toEqual({ player1: null, player2: null, earlierMatches: [] });
		});
	});

	describe('earlier Matches', () => {
		const alice = playerFacts(ALICE, 'Alice');
		const bob = playerFacts(BOB, 'Bob');

		it('lists a reported Match between the two, with its Round, game score and winner', () => {
			const played = match({
				roundId: 11,
				roundName: 'Round 3',
				roundNumber: 3,
				player1Id: BOB,
				player2Id: ALICE,
				player1GameWins: 2,
				player2GameWins: 1,
			});

			const { earlierMatches } = projectHeadToHead({
				player1: alice,
				player2: bob,
				matches: [played],
				currentMatchId: null,
			});

			expect(earlierMatches).toEqual([
				{
					matchId: played.id,
					roundId: 11,
					roundName: 'Round 3',
					roundNumber: 3,
					phaseName: 'Swiss',
					outcome: 'player2',
					gameScore: '1-2',
				},
			]);
		});

		it('reads the game score from the first Player\'s side, game draws last', () => {
			const played = match({
				player1Id: ALICE,
				player2Id: BOB,
				player1GameWins: 2,
				player2GameWins: 0,
				gameDraws: 1,
			});

			const [earlierMatch] = projectHeadToHead({
				player1: alice,
				player2: bob,
				matches: [played],
				currentMatchId: null,
			}).earlierMatches;

			expect(earlierMatch).toMatchObject({ outcome: 'player1', gameScore: '2-0-1' });
		});

		it('calls a Match with equal game wins drawn', () => {
			const drawn = match({ player1GameWins: 1, player2GameWins: 1, gameDraws: 1 });

			const [earlierMatch] = projectHeadToHead({
				player1: alice,
				player2: bob,
				matches: [drawn],
				currentMatchId: null,
			}).earlierMatches;

			expect(earlierMatch).toMatchObject({ outcome: 'draw', gameScore: '1-1-1' });
		});

		it('leaves out the Match the two are about to play, and any not yet reported', () => {
			const current = match({ hasResult: false, player1GameWins: null, player2GameWins: null });
			const unreported = match({ hasResult: false, player1GameWins: null, player2GameWins: null });

			const { earlierMatches } = projectHeadToHead({
				player1: alice,
				player2: bob,
				matches: [current, unreported],
				currentMatchId: current.id,
			});

			expect(earlierMatches).toEqual([]);
		});

		it('leaves out the current Match even once it is reported', () => {
			const current = match();

			expect(projectHeadToHead({
				player1: alice,
				player2: bob,
				matches: [current],
				currentMatchId: current.id,
			}).earlierMatches).toEqual([]);
		});

		it('leaves out Matches against anyone else', () => {
			const others = [
				match({ player1Id: ALICE, player2Id: CAROL }),
				match({ player1Id: CAROL, player2Id: BOB }),
				match({ player1Id: ALICE, player2Id: null, isBye: true }),
			];

			expect(projectHeadToHead({
				player1: alice,
				player2: bob,
				matches: others,
				currentMatchId: null,
			}).earlierMatches).toEqual([]);
		});

		it('lists earlier Matches oldest first: by Phase, then Round, then table order', () => {
			const topCut = match({
				roundName: 'Quarterfinal',
				roundNumber: 1,
				phaseName: 'Top 8',
				phaseSortOrder: 1,
			});
			const roundFive = match({ roundName: 'Round 5', roundNumber: 5 });
			const roundTwo = match({ roundName: 'Round 2', roundNumber: 2 });

			const { earlierMatches } = projectHeadToHead({
				player1: alice,
				player2: bob,
				matches: [topCut, roundFive, roundTwo],
				currentMatchId: null,
			});

			expect(earlierMatches.map(earlierMatch => earlierMatch.roundName)).toEqual(['Round 2', 'Round 5', 'Quarterfinal']);
		});

		it('lists none until both sides hold a Player', () => {
			expect(projectHeadToHead({
				player1: alice,
				player2: null,
				matches: [
					match(),
				],
				currentMatchId: null,
			}).earlierMatches).toEqual([]);
		});
	});
});
