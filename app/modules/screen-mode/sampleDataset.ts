import type { PhaseResponse, PlayerResponse, RoundResponse } from '~~/shared/api';
import type { FoundationTokenName } from '~~/shared/modules/theme';
import type { BracketEntrant, BracketMatchInput } from '~~/shared/modules/top-cut-bracket';
import type { BroadcastGraphicsLiveSessionResponse } from '~~/shared/types/broadcastGraphicsLiveSession';
import type { MtgCard } from '~~/shared/types/card/mtg';
import type { ScreenMode } from '~~/shared/types/enums';
import type { BroadcastGraphicConfig, GraphicItemConfig, TextGraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicThemeSlot } from '~~/shared/types/graphicThemeBindings';
import type { CardBreakdownEntry } from '~~/shared/types/metagame';
import type { ModeConfigsMap } from '~~/shared/types/screenConfig';
import type { ScryfallCardFetchResult } from '~/composables/data/useScryfallBatch';
import type { ScreenOutputReadScope, useScreenOutputReadRepository } from '~/composables/repositories/useScreenOutputReadRepository';
import { DEFAULT_EVENT_CANVAS } from '~~/shared/eventCanvas';
import { bindGraphicThemeOwner, DEFAULT_GRAPHIC_THEME_TOKENS, getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { deriveTopCutBracket } from '~~/shared/modules/top-cut-bracket';
import { scryfallNameKey } from '~/composables/data/useScryfallBatch';

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
	/** Their deck is their Archetype's. */
	archetypeId: typeof ARCHETYPES[number]['id'];
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
		archetypeId: 1,
		previousPosition: 3,
	},
	{
		name: 'Kenji Sato',
		pronouns: 'he/him',
		wins: 6,
		losses: 1,
		draws: 0,
		archetypeId: 2,
		previousPosition: 1,
	},
	{
		name: 'Priya Raghunathan',
		pronouns: 'she/her',
		wins: 5,
		losses: 1,
		draws: 1,
		archetypeId: 4,
		previousPosition: 2,
	},
	{
		name: 'Tomás Ó Briain',
		pronouns: 'he/him',
		wins: 5,
		losses: 2,
		draws: 0,
		archetypeId: 3,
		previousPosition: 4,
	},
	{
		name: 'Jo Lee',
		pronouns: 'they/them',
		wins: 5,
		losses: 2,
		draws: 0,
		archetypeId: 1,
		previousPosition: 7,
	},
	{
		name: 'Maximilian Hohenberger',
		pronouns: null,
		wins: 4,
		losses: 2,
		draws: 1,
		archetypeId: 2,
		previousPosition: 5,
	},
	{
		name: 'Ana Lúcia Ferreira',
		pronouns: 'she/her',
		wins: 4,
		losses: 3,
		draws: 0,
		archetypeId: 4,
		previousPosition: 6,
	},
	{
		name: 'Dev Okafor',
		pronouns: 'he/him',
		wins: 4,
		losses: 3,
		draws: 0,
		archetypeId: 3,
		previousPosition: 8,
	},
];

/** A sample Player's deck, as a broadcast names it: their Archetype's name and colours. */
function deckOf(index: number) {
	const { name, colors } = ARCHETYPES.find(archetype => archetype.id === PLAYERS[index]!.archetypeId)!;
	return { name, colors };
}

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
	gameData: { type: 'mtg', deckName: deckOf(index).name, deckColors: deckOf(index).colors },
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
		deck: deckOf(index),
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

/** A frame colour per colour identity; gold for several, grey for none. */
const FRAME_COLORS: Readonly<Record<string, string>> = {
	W: '#e9e1c6',
	U: '#2c6cab',
	B: '#3d3638',
	R: '#c4472d',
	G: '#2f7a4b',
};

const COLORLESS_FRAME = '#9ca3af';

function frameColor(colors: string | null): string {
	if (!colors)
		return COLORLESS_FRAME;
	return colors.length > 1
		? '#c9a54a'
		: FRAME_COLORS[colors] ?? COLORLESS_FRAME;
}

/**
 * A drawn card face, as a data URI. The sample draws its cards rather than
 * fetching their art, so a preview makes no request. Names are plain ASCII.
 */
function cardFace(name: string, cardType: string, colors: string | null): string {
	const svg = [
		'<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680" viewBox="0 0 488 680">',
		'<rect width="488" height="680" rx="24" fill="#111111"/>',
		`<rect x="20" y="20" width="448" height="640" rx="12" fill="${frameColor(colors)}"/>`,
		'<rect x="36" y="36" width="416" height="44" rx="6" fill="#f5f1e6"/>',
		`<text x="50" y="66" font-family="sans-serif" font-size="22" font-weight="700" fill="#111111">${name}</text>`,
		'<rect x="36" y="92" width="416" height="300" fill="#111111" fill-opacity="0.3"/>',
		'<rect x="36" y="404" width="416" height="36" rx="6" fill="#f5f1e6"/>',
		`<text x="50" y="429" font-family="sans-serif" font-size="18" fill="#111111">${cardType}</text>`,
		'<rect x="36" y="452" width="416" height="188" fill="#f5f1e6"/>',
		'</svg>',
	].join('');
	return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** A sample card as a Scryfall read gives one, with its face drawn rather than fetched. */
function sampleCard(name: string, cardType: string, colors: string | null): MtgCard {
	const face = cardFace(name, cardType, colors);
	return {
		id: `sample-${name.toLowerCase().replace(/\W+/g, '-')}`,
		name,
		set: 'sample',
		layout: 'normal',
		imageData: {
			front: {
				small: face,
				normal: face,
				large: face,
				png: face,
				art_crop: face,
				border_crop: face,
			},
			back: null,
		},
		orientationData: {
			flipable: false,
			turnable: false,
			rotateable: false,
			counterRotateable: false,
		},
		displayData: {
			flipped: false,
			rotated: false,
			counterRotated: false,
			turnedOver: false,
		},
	};
}

/** Card Spotlight's Screen Card. Untimed, so it stays up as long as the preview does. */
const SAMPLE_SCREEN_CARD = sampleCard('Lightning Helix', 'Instant', 'RW');

/** Each sample deck card's data, keyed by name as a Scryfall name lookup keys it. */
const SAMPLE_DECK_CARD_DATA = new Map<string, MtgCard>(SAMPLE_DECK_CARDS.map(([name, cardType, colors]) =>
	[
		scryfallNameKey(name),
		sampleCard(name, cardType, colors),
	] as const));

/**
 * The card data a Theme preview draws its deck cards with, in place of
 * Scryfall's. It is fixed, so the preview fetches nothing.
 */
export async function sampleDeckCardData(cards: ReadonlyArray<{ name: string }>): Promise<ScryfallCardFetchResult> {
	const found = new Map<string, MtgCard>();
	for (const { name } of cards) {
		const key = scryfallNameKey(name);
		const card = SAMPLE_DECK_CARD_DATA.get(key);
		if (card)
			found.set(key, structuredClone(card));
	}
	return { cards: found, degraded: false };
}

/** The sample graphic is authored in the default Event Canvas (ADR-0051). */
const SAMPLE_CANVAS = { canvasWidth: DEFAULT_EVENT_CANVAS.width, canvasHeight: DEFAULT_EVENT_CANVAS.height };

interface SampleRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** `owner` with each slot bound to its Foundation Token, painted from the Default Theme. */
function withThemeBindings<T extends GraphicItemConfig | BroadcastGraphicConfig>(owner: T, bindings: Partial<Record<GraphicThemeSlot, FoundationTokenName>>): T {
	return (Object.entries(bindings) as [GraphicThemeSlot, FoundationTokenName][]).reduce(
		(next, [slot, token]) => bindGraphicThemeOwner(next, slot, token, DEFAULT_GRAPHIC_THEME_TOKENS),
		owner,
	);
}

function sampleShape(id: string, rect: SampleRect): GraphicItemConfig {
	return {
		...getGraphicItemDefinition('shape').createDefault({ id, label: id, ...SAMPLE_CANVAS }),
		...rect,
	};
}

function sampleText(id: string, text: string, fontSize: number, rect: SampleRect): TextGraphicItemConfig {
	const item = getGraphicItemDefinition('text').createDefault({ id, label: id, ...SAMPLE_CANVAS }) as TextGraphicItemConfig;
	return {
		...item,
		...rect,
		text,
		typography: { ...item.typography, fontSize },
	};
}

const LEADER = PLAYERS[0]!;

/**
 * Broadcast Graphics' sample: a lower third naming the sample's leader, every
 * part of it bound to a Foundation Token, so it shows the Theme as a placed
 * graphic would. It is no Broadcast Graphic Template and sits in no library:
 * only a Theme preview's Screen holds it.
 */
const SAMPLE_LOWER_THIRD: BroadcastGraphicConfig = withThemeBindings({
	id: 'sample-lower-third',
	name: 'Sample lower third',
	items: [
		withThemeBindings(sampleShape('sample-panel', {
			x: 96,
			y: 828,
			width: 960,
			height: 156,
		}), { surfaceStyle: 'panel', geometry: 'panel-shape' }),
		withThemeBindings(sampleShape('sample-accent', {
			x: 96,
			y: 828,
			width: 14,
			height: 156,
		}), { 'surfaceStyle.fill': 'accent-fill' }),
		withThemeBindings(sampleText('sample-name', LEADER.name, 56, {
			x: 140,
			y: 846,
			width: 880,
			height: 72,
		}), { 'typography': 'heading', 'typography.color': 'text-primary' }),
		withThemeBindings(
			sampleText('sample-deck', `${deckOf(0).name} · ${LEADER.wins}-${LEADER.losses}-${LEADER.draws}`, 34, {
				x: 140,
				y: 920,
				width: 880,
				height: 48,
			}),
			{ 'typography': 'body', 'typography.color': 'text-secondary' },
		),
	],
}, { 'animation.enter': 'motion-enter', 'animation.update': 'motion-update', 'animation.exit': 'motion-exit' });

/** The sample Live Session: the lower third on air, long since settled at rest. */
const SAMPLE_LIVE_SESSION: BroadcastGraphicsLiveSessionResponse = {
	id: SAMPLE_ID,
	eventId: SAMPLE_ID,
	screenId: SAMPLE_ID,
	status: 'active',
	currentState: {
		playout: {
			[SAMPLE_LOWER_THIRD.id]: {
				onAir: true,
				effectiveStartedAt: SAMPLE_TIMESTAMP.getTime(),
				cut: true,
			},
		},
		inputs: {},
		sources: {},
	},
	recoveryFault: null,
	sequence: 1,
	endedAt: null,
	createdAt: SAMPLE_TIMESTAMP,
	updatedAt: SAMPLE_TIMESTAMP,
};

type SampleReadRepository = ReturnType<typeof useScreenOutputReadRepository>;

/** What the dataset answers for each read, whatever Screen the preview names. */
const ANSWERS = {
	card: { card: SAMPLE_SCREEN_CARD, revision: 1 },
	liveSession: SAMPLE_LIVE_SESSION,
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
			opponentDeckName: deckOf(opponent).name,
			opponentDeckColors: deckOf(opponent).colors,
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
			deckName: deckOf(0).name,
			deckColors: deckOf(0).colors,
		},
		player2: {
			...player(1),
			deckName: deckOf(1).name,
			deckColors: deckOf(1).colors,
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
					name: deckOf(0).name,
					colors: deckOf(0).colors,
					submittedName: deckOf(0).name,
					submittedColors: deckOf(0).colors,
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
 * Each mode's configuration under the sample: what it selects from the
 * dataset, where its defaults select nothing, and Broadcast Graphics' stack.
 */
const SCREEN_MODE_SAMPLE_CONFIGS: ModeConfigsMap = {
	'broadcast-graphics': {
		graphics: [SAMPLE_LOWER_THIRD],
	},
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

/** A read the dataset does not hold: the Feature Match Overlay previews from the Feature Match Sample Dataset. */
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
		card: answer(ANSWERS.card),
		liveSession: answer(ANSWERS.liveSession),
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
