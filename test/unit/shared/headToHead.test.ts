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
		const NO_RECORD = {
			wins: null,
			losses: null,
			draws: null,
			points: null,
		};
		const OWN = {
			wins: 5,
			losses: 1,
			draws: null,
			points: 15,
		};
		const STANDING = {
			wins: 4,
			losses: 1,
			draws: 1,
			points: 13,
		};

		// Melee Sync keeps a Player's own record ahead of their latest
		// Round Standings, which stand in only while the Player holds none.
		it.each([
			{
				case: 'their own record over their latest Round Standings',
				own: OWN,
				latestStanding: STANDING,
				shows: OWN,
			},
			{
				case: 'their own record when no Round Standings hold them',
				own: OWN,
				latestStanding: null,
				shows: OWN,
			},
			{
				case: 'their own record when it holds wins or losses alone',
				own: { ...NO_RECORD, losses: 2 },
				latestStanding: STANDING,
				shows: { ...NO_RECORD, losses: 2 },
			},
			{
				case: 'their latest Round Standings when they hold only points',
				own: { ...NO_RECORD, points: 0 },
				latestStanding: STANDING,
				shows: STANDING,
			},
			{
				case: 'their latest Round Standings when they hold no record of their own',
				own: NO_RECORD,
				latestStanding: STANDING,
				shows: STANDING,
			},
			{
				case: 'no record when they hold neither',
				own: NO_RECORD,
				latestStanding: null,
				shows: NO_RECORD,
			},
		])('shows $case', ({ own, latestStanding, shows }) => {
			const alice = playerFacts(ALICE, 'Alice', {
				player: {
					id: ALICE,
					name: 'Alice',
					pronouns: 'she/her',
					gameData: null,
					...own,
				},
				latestStanding,
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
				...shows,
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
					gameScore: '1–2',
				},
			]);
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
