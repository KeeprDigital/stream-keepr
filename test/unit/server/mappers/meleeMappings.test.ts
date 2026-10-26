import type { MeleeMatchParsed } from '~~/server/schemas/external/melee';
import { describe, expect, it } from 'vitest';
import {
	mapMeleeMatchesToDbRows,
	mapMeleePlayersToDb,
	mapMeleePlayerToDb,
	parseAllDecklists,
	UnsupportedMeleeTeamPayloadError,
} from '~~/server/mappers/melee';
import {
	localDeck,
	localMeleePlayer,
	matchContext,
	meleeCompetitor,
	meleeMatch,
	meleePlayer,
	meleeStanding,
} from '~~/test/helpers/meleeFixtures';

describe('mapMeleePlayersToDb', () => {
	it('maps a Melee player and their standing', () => {
		const [result] = mapMeleePlayersToDb(
			[
				meleePlayer(100, { Status: 7, PlayerName: 'Reid Duke', PronounsDescription: 'he/him' }),
			],
			[
				meleeStanding(100, {
					MatchWins: 5,
					MatchLosses: 2,
					Points: 15,
					Rank: 1,
				}),
			],
		);

		expect(result).toMatchObject({
			externalId: '100',
			externalSource: 'melee',
			externalStatus: 7,
			name: 'Reid Duke',
			pronouns: 'he/him',
			wins: 5,
			losses: 2,
			draws: 0,
			position: 1,
			points: 15,
			deckLists: undefined,
		});
	});

	it('preserves a missing upstream status and standing as null', () => {
		const [result] = mapMeleePlayersToDb([
			meleePlayer(1),
		], []);

		expect(result).toMatchObject({
			externalStatus: null,
			wins: null,
			losses: null,
			draws: null,
			position: null,
			points: null,
		});
	});

	it('rejects team payloads that would collapse multiple players into one TeamId', () => {
		const team = [
			meleePlayer(10, { PlayerName: 'Team Member One' }),
			meleePlayer(10, { PlayerName: 'Team Member Two' }),
		];

		expect(() => mapMeleePlayersToDb(team, [])).toThrowError(UnsupportedMeleeTeamPayloadError);
		expect(() => mapMeleePlayersToDb(team, [])).toThrow(expect.objectContaining({
			statusCode: 422,
			statusMessage: 'Unsupported Melee team tournament',
		}));
	});

	it('rejects duplicate TeamIds in the current standings snapshot', () => {
		expect(() => mapMeleePlayersToDb(
			[
				meleePlayer(10),
			],
			[
				meleeStanding(10, { Rank: 1 }),
				meleeStanding(10, { Rank: 2 }),
			],
		)).toThrow('Duplicate current Melee standing TeamId: 10');
	});

	it('orders players by rank, unranked players last', () => {
		const result = mapMeleePlayersToDb(
			[
				meleePlayer(1, { PlayerName: 'Third' }),
				meleePlayer(4, { PlayerName: 'Unranked' }),
				meleePlayer(2, { PlayerName: 'First' }),
				meleePlayer(3, { PlayerName: 'Second' }),
			],
			[
				meleeStanding(1, { Rank: 3 }),
				meleeStanding(2, { Rank: 1 }),
				meleeStanding(3, { Rank: 2 }),
			],
		);

		expect(result.map(player => [player.name, player.position])).toEqual([
			['First', 1],
			['Second', 2],
			['Third', 3],
			['Unranked', null],
		]);
	});
});

describe('mapMeleePlayerToDb', () => {
	it('normalizes imported player name casing', () => {
		expect(mapMeleePlayerToDb(meleePlayer(42, { PlayerName: 'test player' })).name).toBe('Test Player');
	});
});

describe('parseAllDecklists', () => {
	it.each([undefined, []])('has no Deck Lists for %j', (decklists) => {
		expect(parseAllDecklists(decklists)).toBeUndefined();
	});

	it('parses a decklist with its colors and cards', () => {
		const [result] = parseAllDecklists([
			{
				Guid: 'deck-42',
				FormatId: '42',
				DecklistName: 'Azorius Control',
				Records: [
					{
						l: 'teferi',
						n: 'Teferi',
						s: 'WAR',
						q: 4,
						c: 0,
						t: 'Planeswalker',
					},
				],
				Attributes: [
					{ k: 'COLOR_WHITE', v: 'True', p: null },
					{ k: 'COLOR_BLUE', v: 'True', p: null },
				],
			},
		] as never)!;

		expect(result).toMatchObject({
			externalId: 'deck-42',
			formatId: '42',
			name: 'Azorius Control',
			colors: 'WU',
			companion: null,
		});
		expect(result!.cards).toHaveLength(1);
	});

	it('moves a companion record out of the cards into companion metadata', () => {
		const [result] = parseAllDecklists([
			{
				Guid: 'deck-companion',
				FormatId: '42',
				DecklistName: 'Izzet Control (Lutri)',
				Records: [
					{
						l: 'bolt',
						n: 'Lightning Bolt',
						s: null,
						q: 1,
						c: 0,
						t: 'Instant',
					},
					{
						l: 'lutri',
						n: 'Lutri, the Spellchaser',
						s: null,
						q: 1,
						c: 4,
						t: 'Creature',
					},
				],
				Attributes: [],
			},
		] as never)!;

		expect(result!.cards).toHaveLength(1);
		expect(result!.companion?.name).toBe('Lutri, the Spellchaser');
	});

	it('maps a deck with no colour attributes to C', () => {
		const [result] = parseAllDecklists([
			{
				Guid: 'deck-colourless',
				FormatId: '1',
				DecklistName: 'Colorless Eldrazi',
				Records: [],
				Attributes: [],
			},
		] as never)!;

		expect(result!.colors).toBe('C');
	});
});

describe('mapMeleeMatchesToDbRows', () => {
	it('orders Matches by table, byes last, with sequential sort order', () => {
		const result = mapMeleeMatchesToDbRows([
			meleeMatch('bye', { TableNumber: 0, HasResult: false, ByeReason: 1 }),
			meleeMatch('match-2', { TableNumber: 2 }),
			meleeMatch('match-1', { TableNumber: 1 }),
		], 10, 1, matchContext());

		expect(result.map(match => [match.externalId, match.sortOrder])).toEqual([
			['match-1', 0],
			['match-2', 1],
			['bye', 2],
		]);
		expect(result[2]!.isBye).toBe(true);
		expect(result[0]).toMatchObject({ eventId: 1, roundId: 10 });
	});

	describe('a Match result', () => {
		const context = () => matchContext({
			players: [
				localMeleePlayer(10, 1),
				localMeleePlayer(20, 2),
			],
		});
		function mapOne(overrides: Partial<MeleeMatchParsed>, gameWins: Array<number | null>) {
			const [row] = mapMeleeMatchesToDbRows([
				meleeMatch('result', {
					TableNumber: 1,
					ResultString: 'Player 1 won 2-0-0',
					Competitors: gameWins.map((GameWins, index) => meleeCompetitor(index + 1, { SortOrder: index, GameWins })),
					...overrides,
				}),
			], 10, 1, context());
			return row!;
		}

		it.each([
			[
				'counts the game wins and draws Melee leaves null on a reported Match as none',
				{ GameDraws: null },
				[2, null],
				{
					hasResult: true,
					isBye: false,
					player1GameWins: 2,
					player2GameWins: 0,
					gameDraws: 0,
				},
			],
			[
				'keeps a reported draw',
				{ GameDraws: 1 },
				[1, 1],
				{
					hasResult: true,
					player1GameWins: 1,
					player2GameWins: 1,
					gameDraws: 1,
				},
			],
			[
				'holds no Game Score for an unreported Match, whatever Melee sends',
				{ HasResult: false, GameDraws: 1 },
				[1, null],
				{
					hasResult: false,
					player1GameWins: null,
					player2GameWins: null,
					gameDraws: null,
				},
			],
			[
				'holds no Game Score for a bye',
				{ ByeReason: 1 },
				[2],
				{
					hasResult: true,
					isBye: true,
					player1GameWins: null,
					player2GameWins: null,
					gameDraws: null,
				},
			],
		] as const)('%s', (_, overrides, gameWins, expected) => {
			expect(mapOne(overrides, [...gameWins])).toMatchObject(expected);
		});

		it('does not keep Melee\'s result text', () => {
			expect(mapOne({}, [2, 0])).not.toHaveProperty('resultString');
		});
	});

	it('rejects unpaired partial Matches while preserving explicit completed and bye records', () => {
		const context = matchContext({
			players: [
				localMeleePlayer(11, 1),
			],
		});
		const pending = { HasResult: false, GameDraws: null };

		expect(() => mapMeleeMatchesToDbRows([
			meleeMatch('empty-pending', pending),
		], 10, 1, context))
			.toThrow('not paired or explicitly completed');
		expect(() => mapMeleeMatchesToDbRows([
			meleeMatch('one-sided-pending', {
				...pending,
				Competitors: [
					meleeCompetitor(1),
				],
			}),
		], 10, 1, context))
			.toThrow('not paired or explicitly completed');
		expect(mapMeleeMatchesToDbRows([
			meleeMatch('empty-completed', { ResultString: 'Completed administratively', GameDraws: null }),
		], 10, 1, context))
			.toHaveLength(1);
		expect(mapMeleeMatchesToDbRows([
			meleeMatch('explicit-bye', {
				...pending,
				ByeReason: 1,
				Competitors: [
					meleeCompetitor(1),
				],
			}),
		], 10, 1, context))
			.toHaveLength(1);
	});

	it('rejects unsupported or ambiguous competitor cardinality', () => {
		const context = matchContext({
			players: [1, 2, 3].map(teamId => localMeleePlayer(teamId, teamId)),
		});
		const malformed = (competitors: ReturnType<typeof meleeCompetitor>[]) =>
			() => mapMeleeMatchesToDbRows([
				meleeMatch('malformed', { TableNumber: 1, HasResult: false, Competitors: competitors }),
			], 10, 1, context);

		expect(malformed([1, 2, 3].map((teamId, index) => meleeCompetitor(teamId, { SortOrder: index })))).toThrow('at most two are supported');
		expect(malformed([
			meleeCompetitor(1, { SortOrder: 0 }),
			meleeCompetitor(1, { SortOrder: 1 }),
		])).toThrow('duplicate competitor 1');
	});

	it('rejects duplicate Match identities and unknown required participants', () => {
		const completed = meleeMatch('duplicate-match', { GameDraws: null });

		expect(() => mapMeleeMatchesToDbRows([completed, completed], 10, 1, matchContext()))
			.toThrow('Duplicate Melee Match external identity');
		expect(() => mapMeleeMatchesToDbRows([
			meleeMatch('unknown-player', {
				ByeReason: 1,
				Competitors: [
					meleeCompetitor(999),
				],
			}),
		], 10, 1, matchContext()))
			.toThrow('unknown Melee participant 999');
	});

	it('uses competitor SortOrder for player and score assignment', () => {
		const context = matchContext({
			players: [
				localMeleePlayer(11, 1),
				localMeleePlayer(22, 2),
			],
		});

		const [result] = mapMeleeMatchesToDbRows([
			meleeMatch('ordered-match', {
				TableNumber: 1,
				ResultString: '2-1',
				Competitors: [
					meleeCompetitor(2, { SortOrder: 2, GameWins: 1 }),
					meleeCompetitor(1, { SortOrder: 1, GameWins: 2 }),
				],
			}),
		], 10, 1, context);

		expect(result).toMatchObject({
			player1Id: 11,
			player2Id: 22,
			player1GameWins: 2,
			player2GameWins: 1,
			isBye: false,
		});
	});

	describe('deck selection for a competitor', () => {
		/** A bye for Melee player 1 (local Player 11) that submitted `decklist`. */
		function selectDeck(
			decks: ReturnType<typeof localDeck>[],
			{ decklist, matchFormat, player = localMeleePlayer(11, 1), ...context }: {
				decklist?: { id: string; formatId: string };
				matchFormat?: string;
				player?: ReturnType<typeof localMeleePlayer>;
			} & Partial<Parameters<typeof matchContext>[0]> = {},
		) {
			const mapperContext = matchContext({
				players: [player],
				decks,
				roundFormatExternalId: 'standard',
				...context,
			});
			const [result] = mapMeleeMatchesToDbRows([
				meleeMatch('match', {
					TableNumber: 1,
					HasResult: false,
					ByeReason: 1,
					...(matchFormat
						? { FormatId: matchFormat }
						: {}),
					Competitors: [
						meleeCompetitor(1, { SortOrder: 1, decklist }),
					],
				}),
			], 10, 1, mapperContext);

			return { data: result!.player1Data, warnings: mapperContext.warnings };
		}

		it('uses the exact Melee competitor deck GUID before same-format alternatives', () => {
			const exact = localDeck(101, {
				externalId: 'deck-exact',
				name: 'Submitted Control',
				colors: 'U',
				sortOrder: 9,
				archetypeId: 7,
				reviewedAt: new Date('2026-07-15T00:00:00.000Z'),
			});
			const other = localDeck(102, { externalId: 'deck-other', name: 'Other Standard Deck' });

			const { data, warnings } = selectDeck([other, exact], {
				decklist: { id: 'deck-exact', formatId: 'standard' },
				player: localMeleePlayer(11, 1, {
					archetypeId: 99,
					gameData: { type: 'mtg', deckName: 'Primary Deck', deckColors: 'R' },
				}),
				archetypesById: new Map([
					[
						7,
						{ id: 7, name: 'Reviewed Control', colors: 'WU' },
					],
				]),
			});

			expect(data).toMatchObject({
				deckId: 101,
				archetypeId: 7,
				gameData: { type: 'mtg', deckName: 'Reviewed Control', deckColors: 'WU' },
			});
			expect(warnings).toEqual([]);
		});

		it('uses a format fallback deterministically and warns when an exact reference is unavailable', () => {
			const later = localDeck(202, {
				formatExternalId: 'modern',
				name: 'Later',
				colors: 'R',
				sortOrder: 5,
			});
			const first = localDeck(201, {
				formatExternalId: 'modern',
				name: 'First',
				colors: 'U',
				sortOrder: 1,
			});

			const { data, warnings } = selectDeck([later, first], {
				decklist: { id: 'missing-deck', formatId: 'modern' },
				matchFormat: 'pioneer',
			});

			expect(data).toMatchObject({
				deckId: 201,
				archetypeId: null,
				gameData: { deckName: 'First', deckColors: 'U' },
			});
			expect(warnings).toEqual(expect.arrayContaining([
				expect.stringContaining('used format fallback'),
				expect.stringContaining('selected deterministically'),
			]));
		});

		it('uses the Match format before a different phase format when the competitor format has no deck', () => {
			const matchFormat = localDeck(301, {
				formatExternalId: 'modern',
				name: 'Modern Deck',
				colors: 'R',
				sortOrder: 2,
			});
			const phaseFormat = localDeck(302, { formatExternalId: 'standard', name: 'Standard Deck', colors: 'U' });

			const { data, warnings } = selectDeck([phaseFormat, matchFormat], {
				decklist: { id: 'missing-deck', formatId: 'legacy' },
				matchFormat: 'modern',
			});

			expect(data).toMatchObject({
				deckId: 301,
				gameData: { type: 'mtg', deckName: 'Modern Deck', deckColors: 'R' },
			});
			expect(warnings).toEqual([
				expect.stringContaining('used format fallback'),
			]);
		});

		it('uses the primary deck as the final fallback and emits a warning', () => {
			const primary = localDeck(401, {
				formatExternalId: 'modern',
				name: 'Primary Modern',
				colors: 'G',
				isPrimary: true,
			});

			const { data, warnings } = selectDeck([primary], {
				decklist: { id: 'missing-deck', formatId: 'standard' },
			});

			expect(data).toMatchObject({
				deckId: 401,
				gameData: { type: 'mtg', deckName: 'Primary Modern', deckColors: 'G' },
			});
			expect(warnings).toEqual([
				expect.stringContaining('used primary fallback'),
			]);
		});

		it('clears primary deck metadata when no exact, format, or primary deck can be selected', () => {
			const offFormat = localDeck(301, {
				formatExternalId: 'legacy',
				archetypeId: 9,
				reviewedAt: new Date(),
			});

			const { data, warnings } = selectDeck([offFormat], {
				player: localMeleePlayer(11, 1, {
					archetypeId: 9,
					gameData: { type: 'mtg', deckName: 'Primary Leak', deckColors: 'R' },
				}),
			});

			expect(data).toMatchObject({
				deckId: null,
				archetypeId: null,
				gameData: { type: 'mtg', deckName: null, deckColors: null },
			});
			expect(warnings[0]).toContain('no submitted deck');
		});

		it('never selects another source\'s deck as a Melee fallback', () => {
			const manual = localDeck(701, { externalId: 'manual-deck', externalSource: 'manual', isPrimary: true });

			const { data, warnings } = selectDeck([manual], {
				decklist: { id: 'manual-deck', formatId: 'standard' },
			});

			expect(data).toMatchObject({
				deckId: null,
				gameData: { type: 'mtg', deckName: null, deckColors: null },
			});
			expect(warnings).toEqual(expect.arrayContaining([
				expect.stringContaining('was not available locally'),
			]));
		});
	});
});
