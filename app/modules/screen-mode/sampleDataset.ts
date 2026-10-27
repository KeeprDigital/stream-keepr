import type { PhaseResponse, PlayerResponse, RoundResponse } from '~~/shared/api';
import type { BracketEntrant, BracketMatchInput } from '~~/shared/modules/top-cut-bracket';
import type { ScreenMode } from '~~/shared/types/enums';
import type { CardBreakdownEntry } from '~~/shared/types/metagame';
import type { ModeConfigsMap } from '~~/shared/types/screenConfig';
import type { ScreenOutputReadScope, useScreenOutputReadRepository } from '~/composables/repositories/useScreenOutputReadRepository';
import { deriveTopCutBracket } from '~~/shared/modules/top-cut-bracket';

/**
 * The Screen Mode Sample Dataset: one fixed canonical set of Event Data a Theme
 * preview renders every Screen Mode against. The Feature Match Sample Dataset
 * is its prior art.
 *
 * It is canonical, not plausible. Two operators judging one Theme see the same
 * preview, and a token edit changes nothing else, so the values are constants
 * here, not sampled from what the installation holds. They are awkward the way
 * real ones are: a long name beside a short one, a record with a draw in it, a
 * Player who climbed and one who fell.
 *
 * It reaches a rendering only through a Theme preview's Screen context
 * (`createScreenModeSampleContext`), which no Screen Output builds. Putting
 * sample values on air is the one failure it must never cause.
 */

/** The id the sample stands at, for its Event and its Screen alike. No stored row has it. */
export const SAMPLE_ID = -1;

const SAMPLE_TIMESTAMP = new Date('2026-01-01T00:00:00.000Z');

interface SamplePlayer {
	name: string;
	pronouns: string | null;
	wins: number;
	losses: number;
	draws: number;
	deckName: string;
	deckColors: string;
	archetypeId: number;
	/** Their position a Round earlier, which Standings' Position Change measures against. */
	previousPosition: number;
}

const ARCHETYPES = [
	{ id: 1, name: 'Boros Convoke', colors: 'RW' },
	{ id: 2, name: 'Dimir Midrange', colors: 'UB' },
	{ id: 3, name: 'Mono-Green Landfall', colors: 'G' },
	{ id: 4, name: 'Esper Control', colors: 'WUB' },
] as const;

/** In final position order. */
const PLAYERS: readonly SamplePlayer[] = [
	{
		name: 'Alexandra Whitfield-Moreau',
		pronouns: 'she/her',
		wins: 6,
		losses: 0,
		draws: 1,
		deckName: 'Boros Convoke',
		deckColors: 'RW',
		archetypeId: 1,
		previousPosition: 3,
	},
	{
		name: 'Kenji Sato',
		pronouns: 'he/him',
		wins: 6,
		losses: 1,
		draws: 0,
		deckName: 'Dimir Midrange',
		deckColors: 'UB',
		archetypeId: 2,
		previousPosition: 1,
	},
	{
		name: 'Priya Raghunathan',
		pronouns: 'she/her',
		wins: 5,
		losses: 1,
		draws: 1,
		deckName: 'Esper Control',
		deckColors: 'WUB',
		archetypeId: 4,
		previousPosition: 2,
	},
	{
		name: 'Tomás Ó Briain',
		pronouns: 'he/him',
		wins: 5,
		losses: 2,
		draws: 0,
		deckName: 'Mono-Green Landfall',
		deckColors: 'G',
		archetypeId: 3,
		previousPosition: 4,
	},
	{
		name: 'Jo Lee',
		pronouns: 'they/them',
		wins: 5,
		losses: 2,
		draws: 0,
		deckName: 'Boros Convoke',
		deckColors: 'RW',
		archetypeId: 1,
		previousPosition: 7,
	},
	{
		name: 'Maximilian Hohenberger',
		pronouns: null,
		wins: 4,
		losses: 2,
		draws: 1,
		deckName: 'Dimir Midrange',
		deckColors: 'UB',
		archetypeId: 2,
		previousPosition: 5,
	},
	{
		name: 'Ana Lúcia Ferreira',
		pronouns: 'she/her',
		wins: 4,
		losses: 3,
		draws: 0,
		deckName: 'Esper Control',
		deckColors: 'WUB',
		archetypeId: 4,
		previousPosition: 6,
	},
	{
		name: 'Dev Okafor',
		pronouns: 'he/him',
		wins: 4,
		losses: 3,
		draws: 0,
		deckName: 'Mono-Green Landfall',
		deckColors: 'G',
		archetypeId: 3,
		previousPosition: 8,
	},
];

/** Player ids are 1-based positions. */
const playerId = (index: number) => index + 1;

const SAMPLE_PLAYERS: PlayerResponse[] = PLAYERS.map((player, index) => ({
	id: playerId(index),
	eventId: SAMPLE_ID,
	name: player.name,
	pronouns: player.pronouns,
	externalId: null,
	externalSource: null,
	wins: player.wins,
	losses: player.losses,
	draws: player.draws,
	position: index + 1,
	points: player.wins * 3 + player.draws,
	archetypeId: player.archetypeId,
	lgs: null,
	gameData: { type: 'mtg', deckName: player.deckName, deckColors: player.deckColors },
	createdAt: SAMPLE_TIMESTAMP,
	updatedAt: SAMPLE_TIMESTAMP,
}));

const player = (index: number) => SAMPLE_PLAYERS[index]!;

const SWISS: PhaseResponse = {
	id: 1,
	eventId: SAMPLE_ID,
	name: 'Swiss',
	sortOrder: 0,
	externalId: null,
	externalSource: null,
	formatExternalId: null,
	createdAt: SAMPLE_TIMESTAMP,
	updatedAt: SAMPLE_TIMESTAMP,
};

const TOP_CUT: PhaseResponse = {
	...SWISS,
	id: 2,
	name: 'Top 8',
	sortOrder: 1,
};

function round(id: number, phaseId: number, name: string, roundNumber: number): RoundResponse {
	return {
		id,
		eventId: SAMPLE_ID,
		phaseId,
		externalId: null,
		externalSource: null,
		name,
		roundNumber,
		controlMode: 'default',
		lastSyncedAt: null,
		createdAt: SAMPLE_TIMESTAMP,
		updatedAt: SAMPLE_TIMESTAMP,
	};
}

const ROUND_7 = round(7, SWISS.id, 'Round 7', 7);
const ROUND_8 = round(8, SWISS.id, 'Round 8', 8);
const QUARTERFINALS = round(9, TOP_CUT.id, 'Quarterfinals', 1);
const SEMIFINALS = round(10, TOP_CUT.id, 'Semifinals', 2);

function entrant(index: number): BracketEntrant {
	const { id, name } = player(index);
	return {
		playerId: id,
		name,
		seed: index + 1,
		deck: { name: PLAYERS[index]!.deckName, colors: PLAYERS[index]!.deckColors },
	};
}

function bracketMatch(matchId: number, table: number, sides: [number, number], gameWins: [number, number] | null): BracketMatchInput {
	return {
		matchId,
		tableNumber: table,
		player1: entrant(sides[0]),
		player2: entrant(sides[1]),
		isBye: false,
		hasResult: gameWins !== null,
		player1GameWins: gameWins?.[0] ?? null,
		player2GameWins: gameWins?.[1] ?? null,
		gameDraws: gameWins ? 0 : null,
	};
}

/** Quarterfinals played, one Semifinal reported and one still out. */
const SAMPLE_BRACKET = deriveTopCutBracket([
	{
		roundId: QUARTERFINALS.id,
		name: QUARTERFINALS.name,
		matches: [
			bracketMatch(91, 1, [0, 7], [2, 1]),
			bracketMatch(92, 2, [3, 4], [0, 2]),
			bracketMatch(93, 3, [1, 6], [2, 0]),
			bracketMatch(94, 4, [2, 5], [1, 2]),
		],
	},
	{
		roundId: SEMIFINALS.id,
		name: SEMIFINALS.name,
		matches: [
			bracketMatch(101, 1, [0, 4], [2, 0]),
			bracketMatch(102, 2, [1, 5], null),
		],
	},
]);

function card(id: number, name: string, cardType: string, colors: string | null, manaCost: string | null, deckCount: number, avgCopies: number): CardBreakdownEntry {
	const totalCopies = Math.round(deckCount * avgCopies);
	return {
		id,
		name,
		cardType,
		// No Scryfall id, so it draws no art: the sample is about type and colour.
		scryfallId: null,
		colors,
		cmc: manaCost
			? manaCost.split('}').length - 1
			: 0,
		manaCost,
		inclusionRate: Math.round((deckCount / PLAYERS.length) * 1000) / 10,
		avgCopies,
		totalCopies,
		mainboardCount: totalCopies,
		sideboardCount: 0,
		mainboardDeckCount: deckCount,
		sideboardDeckCount: 0,
		deckCount,
	};
}

const SAMPLE_TOP_CARDS: CardBreakdownEntry[] = [
	card(1, 'Lightning Helix', 'Instant', 'RW', '{R}{W}', 4, 3.5),
	card(2, 'Thoughtseize', 'Sorcery', 'B', '{B}', 4, 2.25),
	card(3, 'Fatal Push', 'Instant', 'B', '{B}', 4, 3),
	card(4, 'Llanowar Elves', 'Creature', 'G', '{G}', 2, 4),
	card(5, 'Supreme Verdict', 'Sorcery', 'WU', '{1}{W}{W}{U}', 2, 2),
	card(6, 'Plains', 'Basic Land', null, null, 4, 6.5),
];

const SPOTLIT = ARCHETYPES[0];
const spotlitPilots = SAMPLE_PLAYERS.filter(pilot => pilot.archetypeId === SPOTLIT.id);

const SAMPLE_DECK_CARDS = [
	[
		'Lightning Helix',
		'Instant',
		'RW',
		'{R}{W}',
		4,
		'mainboard',
	],
	[
		'Gleeful Demolition',
		'Sorcery',
		'R',
		'{R}',
		4,
		'mainboard',
	],
	[
		'Voldaren Epicure',
		'Creature',
		'R',
		'{R}',
		4,
		'mainboard',
	],
	[
		'Venerated Loxodon',
		'Creature',
		'W',
		'{4}{W}',
		4,
		'mainboard',
	],
	[
		'Sacred Foundry',
		'Land',
		null,
		null,
		4,
		'mainboard',
	],
	[
		'Plains',
		'Basic Land',
		null,
		null,
		8,
		'mainboard',
	],
	[
		'Rest in Peace',
		'Enchantment',
		'W',
		'{1}{W}',
		2,
		'sideboard',
	],
] as const;

type SampleReadRepository = ReturnType<typeof useScreenOutputReadRepository>;

/** What the dataset answers for each read, whatever Screen the preview names. */
const ANSWERS = {
	standings: {
		players: SAMPLE_PLAYERS,
		round: null,
		roundStandings: null,
		watchlist: null,
		previousRoundPositions: {
			roundId: ROUND_7.id,
			positions: PLAYERS.map((entry, index) => ({
				playerId: playerId(index),
				position: entry.previousPosition,
			})),
		},
	},
	pairings: {
		round: ROUND_8,
		matches: [0, 2, 4, 6].map((first, table) => {
			const reported = table < 2;
			return {
				matchId: 80 + table,
				tableNumber: table + 1,
				player1: { id: player(first).id, name: player(first).name },
				player2: { id: player(first + 1).id, name: player(first + 1).name },
				isBye: false,
				hasResult: reported,
				player1GameWins: reported ? 2 : null,
				player2GameWins: reported ? 1 : null,
				gameDraws: reported ? 0 : null,
			};
		}),
	},
	playerHistory: {
		player: player(0),
		history: [1, 3, 5, 7].map((opponent, index) => ({
			id: 70 + index,
			roundId: index + 1,
			roundName: `Round ${index + 1}`,
			roundNumber: index + 1,
			phaseName: SWISS.name,
			tableNumber: index + 3,
			opponentId: player(opponent).id,
			opponentName: player(opponent).name,
			opponentDeckName: PLAYERS[opponent]!.deckName,
			opponentDeckColors: PLAYERS[opponent]!.deckColors,
			outcome: index === 2
				? 'draw'
				: 'win',
			playerGameWins: index === 2
				? 1
				: 2,
			opponentGameWins: 1,
			gameDraws: index === 2
				? 1
				: 0,
			hasResult: true,
		} as const)),
	},
	headToHead: {
		player1: {
			...player(0),
			deckName: PLAYERS[0]!.deckName,
			deckColors: PLAYERS[0]!.deckColors,
		},
		player2: {
			...player(1),
			deckName: PLAYERS[1]!.deckName,
			deckColors: PLAYERS[1]!.deckColors,
		},
		earlierMatches: [
			{
				matchId: 61,
				roundId: 3,
				roundName: 'Round 3',
				roundNumber: 3,
				phaseName: SWISS.name,
				outcome: 'player1' as const,
				gameScore: '2-1',
			},
		],
	},
	metagame: {
		viewMode: 'archetype' as const,
		breakdown: {
			entries: ARCHETYPES.map((archetype, index) => {
				const pilots = SAMPLE_PLAYERS.filter(pilot => pilot.archetypeId === archetype.id);
				return {
					...archetype,
					count: pilots.length,
					metaShare: (pilots.length / PLAYERS.length) * 100,
					winRate: 70 - index * 6.5,
					avgPosition: pilots.reduce((sum, pilot) => sum + pilot.position!, 0) / pilots.length,
					conversionRate: null,
					keyCards: [],
				};
			}),
			totalPlayers: PLAYERS.length,
			classifiedPlayers: PLAYERS.length,
			scope: 'all' as const,
		},
	},
	topCards: { entries: SAMPLE_TOP_CARDS, totalDecks: PLAYERS.length, scope: 'all' as const },
	topCut: { phase: TOP_CUT, bracket: SAMPLE_BRACKET },
	archetypeSpotlight: {
		archetype: SPOTLIT,
		playerCount: spotlitPilots.length,
		metaShare: (spotlitPilots.length / PLAYERS.length) * 100,
		convertedCount: spotlitPilots.length,
		conversionRate: 100,
		pilots: spotlitPilots.map(({ id, name, position, points, wins, losses, draws }) => ({
			id,
			name,
			position,
			points,
			wins,
			losses,
			draws,
		})),
		topCards: SAMPLE_TOP_CARDS.slice(0, 3),
	},
	playerDecks: {
		player: player(0),
		decks: {
			selectedDeckId: 1,
			decks: [
				{
					id: 1,
					playerId: player(0).id,
					externalId: 'sample-deck',
					formatExternalId: 'sample-format',
					phaseIds: [SWISS.id],
					phaseName: SWISS.name,
					name: PLAYERS[0]!.deckName,
					colors: PLAYERS[0]!.deckColors,
					submittedName: PLAYERS[0]!.deckName,
					submittedColors: PLAYERS[0]!.deckColors,
					sortOrder: 0,
					isPrimary: true,
					archetypeId: SPOTLIT.id,
					reviewedAt: null,
					cards: SAMPLE_DECK_CARDS.map(([name, cardType, colors, manaCost, quantity, compartment], index) => ({
						cardId: index + 1,
						name,
						scryfallId: null,
						cardType,
						colors,
						cmc: null,
						manaCost,
						deckCounterTypes: [],
						deckTokens: [],
						quantity,
						compartment,
						sortOrder: index,
					})),
				},
			],
		},
	},
} satisfies { [K in keyof SampleReadRepository]?: Awaited<ReturnType<SampleReadRepository[K]>> };

/**
 * Each plain mode's configuration under the sample: what it selects from the
 * dataset, where its defaults select nothing.
 */
export const SCREEN_MODE_SAMPLE_CONFIGS: ModeConfigsMap = {
	'deck': {
		deckSource: { type: 'player', playerId: player(0).id },
	},
	'pairings': { roundId: ROUND_8.id },
	'top-cut': { phaseId: TOP_CUT.id, showSeeds: true, showArchetypes: true },
	'player-history': { playerId: player(0).id },
	'archetype-spotlight': { archetypeId: SPOTLIT.id },
	'head-to-head': { playerSource: 'players', player1Id: player(0).id, player2Id: player(1).id },
	'standings': {
		columns: [
			{ key: 'position', visible: true },
			{ key: 'name', visible: true },
			{ key: 'record', visible: true },
			{ key: 'points', visible: true },
			{ key: 'deck', visible: true },
			{ key: 'positionChange', visible: true },
		],
	},
};

/** The sample configuration of `mode`, or its defaults where it needs none. */
export function screenModeSampleConfigs(mode: ScreenMode): ModeConfigsMap {
	const config = SCREEN_MODE_SAMPLE_CONFIGS[mode];
	return config
		? { [mode]: config }
		: {};
}

/** A read the dataset does not hold: the graphics hosts preview from the Feature Match Sample Dataset. */
function notInSample(resource: string): never {
	throw new Error(`The Screen Mode Sample Dataset holds no ${resource}`);
}

/**
 * The Screen Output read repository a Theme preview reads from: every read
 * answers the dataset, a fresh copy each time, and nothing leaves the browser.
 */
export function useSampleScreenOutputReadRepository(): SampleReadRepository {
	const answer = <T>(value: T) => async (_scope: ScreenOutputReadScope): Promise<T> => structuredClone(value);
	return {
		event: async () => notInSample('Event context'),
		// A Screen Card is set live by an operator, so the sample holds none.
		card: async () => ({ card: null, revision: 0 }),
		liveSession: async () => notInSample('Broadcast Graphics session'),
		featureMatchSlot: async () => notInSample('Feature Match Slot'),
		playerHistory: answer(ANSWERS.playerHistory),
		standings: answer(ANSWERS.standings),
		pairings: answer(ANSWERS.pairings),
		archetypeSpotlight: answer(ANSWERS.archetypeSpotlight),
		headToHead: answer(ANSWERS.headToHead),
		metagame: answer(ANSWERS.metagame),
		topCards: answer(ANSWERS.topCards),
		topCut: answer(ANSWERS.topCut),
		playerDecks: answer(ANSWERS.playerDecks),
	};
}

/** Every sample Player's name, as a test proving where the sample may not appear reads them. */
export const SAMPLE_PLAYER_NAMES: readonly string[] = PLAYERS.map(entry => entry.name);
