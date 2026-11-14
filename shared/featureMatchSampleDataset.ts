import type { EventKind } from './config/games';
import type { OpCardCategory } from './types/card/op';
import type { Seat } from './types/enums';
import type { FeatureMatchDeckListEntry } from './types/featureMatchDeckList';
import type { Commander, OpLeader } from './types/game';
import type { GraphicInputValue } from './types/graphics';
import { EVENT_KIND_VALUES, getGameConfig } from './config/games';
import { featureMatchTokenCatalogue } from './featureMatchTokenCatalogue';
import { SEAT_VALUES } from './types/enums';
import { formatOpColors, opPrintingImageUrl } from './utils/card/op';
import { commanderDeckIdentity } from './utils/commander';
import { scryfallCardImageUrl } from './utils/scryfallCardImage';

/**
 * The canonical Feature Match sample dataset.
 *
 * One dataset, in one place, standing in for a Feature Match that is not there.
 * A Feature Match Layout is authored long before the show it will run, and a
 * Feature Match Layout Template is authored for no show at all — so the layout an
 * author is looking at while they position a name plate usually has no Slot behind
 * it, and every Graphic Text Template in it renders empty. An empty preview is not
 * a preview: it hides exactly the thing an author is judging, which is whether real
 * values fit inside the bounds they drew.
 *
 * ## Why it is canonical rather than plausible
 *
 * "Canonical" is doing work here. Two authors comparing the same layout must see
 * the same preview, and the same layout previewed before and after an edit must
 * differ only by the edit — so the values are fixed constants rather than sampled
 * from whatever the installation happens to hold, and there is one dataset rather
 * than one per Event, per preset, or per author.
 *
 * The values themselves are chosen to be *awkward in the ways real ones are*: a
 * long player name beside a short one, a two-word deck name, a record with a draw
 * in it, a life total that has gone negative-adjacent and a game-wins state partway
 * through a best-of-three. A dataset of `Player 1` and `0-0` would make every
 * layout look like it fits.
 *
 * ## Where it is used, and where it must never be
 *
 * Previews only, and only when nothing real is bound. A live Screen Output whose
 * Feature Match Slot holds no Match renders empty, exactly as it did before this
 * existed — putting sample values on air is the one failure this file must not
 * cause, so the choice is made by the preview surface rather than here.
 *
 * ## One per kind of Event
 *
 * A Magic Match and a One Piece Card Game Match fill the same tokens with
 * different things — a deck name and mana colours, or a Leader and its colours
 * and card — and a Commander game seats four, each deck named by its Commanders
 * (ADR-0087). So each kind of Event has its own sample, and the preview picks
 * the one its Event is (`featureMatchSampleDataset`).
 */

/**
 * The Feature Match token binding catalogue's values, sampled for a Two-Player
 * Magic Match.
 *
 * Keyed by the catalogue's own keys, and complete over them: a token with no
 * sample value would preview as blank, which is the problem this dataset exists to
 * solve, so `featureMatchSampleDatasetIsComplete` proves the pair stay in step.
 */
export const FEATURE_MATCH_SAMPLE_TOKEN_VALUES: Readonly<Record<string, GraphicInputValue>> = {
	player1Name: 'Alexandra Whitfield-Moreau',
	player1Record: '5-1-1',
	player1Deck: 'Boros Convoke',
	player1DeckColors: 'RW',
	player1Pronouns: 'she/her',
	player1Lgs: 'Northgate Games',
	// Blank like the sideboards' art: a preview never fetches remotely, and the sample is a Magic Match.
	player1LeaderImage: '',
	player2Name: 'Kenji Sato',
	player2Record: '6-1',
	player2Deck: 'Dimir Midrange',
	player2DeckColors: 'UB',
	player2Pronouns: 'he/him',
	player2Lgs: 'The Battered Sleeve',
	player2LeaderImage: '',
	round: 'Round 8',
	stage: 'Quarterfinals',
	table: 'Table 1',
	format: 'Standard',
	eventName: 'Sample Regional Championship',
};

/** One sampled sideboard card. Art stays unset: a preview never fetches remotely. */
interface FeatureMatchSampleDeckListCard {
	name: string;
	quantity: number;
	imageUrl: string | null;
}

/** One sampled player's live session state. */
interface FeatureMatchSamplePlayerState {
	lifeTotal: number | null;
	gameWins: number;
	sideboard: FeatureMatchSampleDeckListCard[] | null;
	sideboardRevealed: boolean;
	/** A Commander set's Seat alone: whether it is Eliminated, and its Commander Damage per opposing Commander in Seat order. */
	eliminated?: boolean;
	commanderDamage?: { damage: number; imageUrl: string | null }[];
}

/**
 * The live session state the context-gated Clock, Player Life, Game Wins, and
 * Deck List Graphic Item Definitions read.
 *
 * Structurally the same shape the render model takes, and deliberately not typed
 * as it: that type belongs to the client render model and this file is shared, so
 * the compiler checks the match where the two meet rather than by an import that
 * would point the wrong way.
 */
export interface FeatureMatchSampleContext {
	clockDisplayTime: string;
	player1: FeatureMatchSamplePlayerState;
	player2: FeatureMatchSamplePlayerState;
	/** Seats 3 and 4, which only a Commander set holds (ADR-0087). */
	player3?: FeatureMatchSamplePlayerState;
	player4?: FeatureMatchSamplePlayerState;
	/** A Commander set's Seats nobody sits in: none, as every set seats all four. */
	emptySeats?: readonly Seat[];
	/** The Seat whose turn it is, where the set tracks one. */
	activeSeat?: Seat | null;
	bestOf: number;
}

export const FEATURE_MATCH_SAMPLE_CONTEXT: FeatureMatchSampleContext = {
	clockDisplayTime: '12:34',
	// The sideboards are awkward the way real ones are: a full fifteen cards with
	// a long name, a split card, and uneven quantities, so an author judging a
	// Deck List Graphic Item's bounds sees the worst case rather than a tidy one.
	// Art stays `null` — the canonical dataset never depends on a remote image —
	// so the preview shows the 63:88 text-placeholder cards.
	player1: {
		lifeTotal: 17,
		gameWins: 1,
		sideboard: [
			{ name: 'Rest in Peace', quantity: 2, imageUrl: null },
			{ name: 'Wear // Tear', quantity: 2, imageUrl: null },
			{ name: 'Pithing Needle', quantity: 1, imageUrl: null },
			{ name: 'Elspeth, Knight-Errant', quantity: 1, imageUrl: null },
			{ name: 'Celestial Purge', quantity: 3, imageUrl: null },
			{ name: 'Burrenton Forge-Tender', quantity: 4, imageUrl: null },
			{ name: 'Path to Exile', quantity: 2, imageUrl: null },
		],
		// Revealed, so an author judging a Deck List Graphic Item's bounds sees it.
		sideboardRevealed: true,
	},
	player2: {
		lifeTotal: 4,
		gameWins: 1,
		sideboard: [
			{ name: 'Duress', quantity: 3, imageUrl: null },
			{ name: 'Negate', quantity: 2, imageUrl: null },
			{ name: 'Sheoldred, the Apocalypse', quantity: 2, imageUrl: null },
			{ name: 'Gix\'s Command', quantity: 2, imageUrl: null },
			{ name: 'Cut Down', quantity: 3, imageUrl: null },
			{ name: 'Disdainful Stroke', quantity: 3, imageUrl: null },
		],
		sideboardRevealed: true,
	},
	// The first Seat's turn, so a Seat Indicator previews on one Seat and not the other.
	activeSeat: 'player1',
	bestOf: 3,
};

/** A One Piece sample Mainboard card, as a pasted Deck List snapshots it from bandai-keepr. */
function opEntry(number: string, quantity: number, name: string, category: OpCardCategory, cost: number, power: number | null, counter: number | null): FeatureMatchDeckListEntry {
	return {
		number,
		quantity,
		card: {
			name,
			category,
			colors: ['Purple'],
			cost,
			power,
			counter,
			imageUrl: opPrintingImageUrl(number),
		},
	};
}

const PURPLE_LUFFY: OpLeader = {
	number: 'OP05-060',
	name: 'Monkey.D.Luffy',
	colors: ['Purple'],
	imageUrl: opPrintingImageUrl('OP05-060'),
};

const ENEL: OpLeader = {
	number: 'OP05-098',
	name: 'Enel',
	colors: ['Yellow'],
	imageUrl: opPrintingImageUrl('OP05-098'),
};

/**
 * Player 1's Feature Match Deck List: a real Purple Luffy list, its Leader
 * first, then fifty Mainboard cards of the Leader's colour, none past four
 * copies, so a preview shows every group (Character, Event, Stage) and no deck
 * rule warning. Card values are bandai-keepr's.
 */
const PURPLE_LUFFY_DECK_LIST: FeatureMatchDeckListEntry[] = [
	{
		number: PURPLE_LUFFY.number,
		quantity: 1,
		card: {
			name: PURPLE_LUFFY.name,
			category: 'leader',
			colors: ['Purple'],
			cost: null,
			power: 5000,
			counter: null,
			imageUrl: PURPLE_LUFFY.imageUrl,
		},
	},
	opEntry('OP05-062', 4, 'O-Nami', 'character', 1, 1000, 1000),
	opEntry('OP05-068', 4, 'Chopa-Emon', 'character', 2, 3000, 1000),
	opEntry('OP05-061', 4, 'Uso-Hachi', 'character', 3, 4000, 2000),
	opEntry('OP05-067', 4, 'Zoro-Juurou', 'character', 3, 4000, 1000),
	opEntry('OP05-063', 4, 'O-Robi', 'character', 4, 5000, 1000),
	opEntry('OP05-072', 4, 'Hone-Kichi', 'character', 4, 6000, null),
	opEntry('OP05-066', 4, 'Jinbe', 'character', 5, 6000, 1000),
	opEntry('OP05-070', 3, 'Fra-Nosuke', 'character', 5, 4000, 2000),
	opEntry('OP05-065', 4, 'San-Gorou', 'character', 6, 8000, 1000),
	opEntry('OP03-070', 2, 'Monkey.D.Luffy', 'character', 6, 7000, null),
	opEntry('OP05-119', 4, 'Monkey.D.Luffy', 'character', 10, 12000, null),
	opEntry('OP05-076', 3, 'When You\'re at Sea You Fight against Pirates!!', 'event', 1, null, null),
	opEntry('OP05-077', 4, 'Gamma Knife', 'event', 2, null, null),
	opEntry('OP09-080', 2, 'Thousand Sunny', 'stage', 1, null, null),
];

/** The Round the One Piece sample's Slot is featured in, as the operator typed it. */
export const OP_FEATURE_MATCH_SAMPLE_ROUND = 'Round 6';

/** A One Piece sample side's slot data: who sits there, their Leader, and their Deck List if they hold one. */
export interface OpFeatureMatchSampleSide {
	name: string;
	pronouns: string;
	lgs: string;
	leader: OpLeader;
	deckList: FeatureMatchDeckListEntry[];
}

/**
 * The One Piece sample's two sides, in Slot order. A long name beside a short
 * one, a mono-colour Leader on each, and a long-named card in the Deck List.
 * Shared with the Screen Mode Sample Dataset, whose Slot and Deck List Screen
 * show them.
 */
export const OP_FEATURE_MATCH_SAMPLE_SIDES: readonly [OpFeatureMatchSampleSide, OpFeatureMatchSampleSide] = [
	{
		name: 'Sebastián Castellanos-Ruiz',
		pronouns: 'he/him',
		lgs: 'Grand Line Games',
		leader: PURPLE_LUFFY,
		deckList: PURPLE_LUFFY_DECK_LIST,
	},
	{
		name: 'Mei Tanaka',
		pronouns: 'she/her',
		lgs: 'Thousand Sunny Cards',
		leader: ENEL,
		deckList: [],
	},
];

/** A One Piece side's player tokens: a deck is named and coloured by its Leader, which a Leader Image shows. */
function opPlayerTokens(side: OpFeatureMatchSampleSide, prefix: 'player1' | 'player2'): Record<string, GraphicInputValue> {
	return {
		[`${prefix}Name`]: side.name,
		// An OP Event keeps no results, so a side has no record.
		[`${prefix}Record`]: '',
		[`${prefix}Deck`]: side.leader.name,
		[`${prefix}DeckColors`]: formatOpColors(side.leader.colors),
		[`${prefix}Pronouns`]: side.pronouns,
		[`${prefix}Lgs`]: side.lgs,
		[`${prefix}LeaderImage`]: side.leader.imageUrl,
	};
}

const OP_SAMPLE_TOKEN_VALUES: Readonly<Record<string, GraphicInputValue>> = {
	...opPlayerTokens(OP_FEATURE_MATCH_SAMPLE_SIDES[0], 'player1'),
	...opPlayerTokens(OP_FEATURE_MATCH_SAMPLE_SIDES[1], 'player2'),
	// An OP Event has no Phases, so its stage is the Round the operator typed.
	round: OP_FEATURE_MATCH_SAMPLE_ROUND,
	stage: OP_FEATURE_MATCH_SAMPLE_ROUND,
	table: 'Table 1',
	format: getGameConfig('op').label,
	eventName: 'Sample Treasure Cup',
};

/** No life or sideboard is tracked for a One Piece Match (ADR-0057); it is best-of-one, undecided. */
const OP_SAMPLE_CONTEXT: FeatureMatchSampleContext = {
	clockDisplayTime: '12:34',
	player1: {
		lifeTotal: null,
		gameWins: 0,
		sideboard: null,
		sideboardRevealed: false,
	},
	player2: {
		lifeTotal: null,
		gameWins: 0,
		sideboard: null,
		sideboardRevealed: false,
	},
	bestOf: 1,
};

/** One sampled Commander Seat: who sits there, their Commanders, and their life. */
export interface CommanderFeatureMatchSampleSeat {
	name: string;
	pronouns: string;
	lgs: string;
	commanders: readonly Commander[];
	lifeTotal: number;
	/** The Commander Damage taken from each other Seat's first Commander. */
	damageFrom?: Partial<Record<Seat, number>>;
	eliminated?: boolean;
}

/** A Commander as a Seat holds one: a real printing, so a preview shows its card. */
export function sampleCommander(scryfallId: string, name: string, colorIdentity: string, setCode: string, collectorNumber: string): Commander {
	return {
		scryfallId,
		name,
		colorIdentity,
		setCode,
		collectorNumber,
	};
}

/**
 * The Commander sample's four Seats, in Seat order: a long name beside a short
 * one, a pair of Commanders beside single ones, a colourless deck, and every
 * Seat at a different life in a game well under way: the second Seat's turn,
 * Commander Damage taken, and the fourth Seat Eliminated.
 */
const COMMANDER_SAMPLE_SEATS: readonly CommanderFeatureMatchSampleSeat[] = [
	{
		name: 'Oluwaseun Adebayo-Lindqvist',
		pronouns: 'she/her',
		lgs: 'Northgate Games',
		commanders: [
			sampleCommander('bc7cbe9b-324e-42b8-94e2-36e91cb32163', 'Tymna the Weaver', 'WB', 'c16', '48'),
			sampleCommander('557fcd17-6cb3-414a-b2b1-ea9ae32e5aec', 'Kraum, Ludevic\'s Opus', 'UR', 'c16', '34'),
		],
		lifeTotal: 31,
		damageFrom: { player2: 9 },
	},
	{
		name: 'Bo Li',
		pronouns: 'he/him',
		lgs: 'The Battered Sleeve',
		commanders: [
			sampleCommander('d0d33d52-3d28-4635-b985-51e126289259', 'Atraxa, Praetors\' Voice', 'WUBG', '2xm', '190'),
		],
		lifeTotal: 40,
	},
	{
		name: 'Marguerite Okafor',
		pronouns: 'they/them',
		lgs: 'Dice & Daggers',
		commanders: [
			sampleCommander('824b2d73-2151-4e5e-9f05-8f63e2bdcaa9', 'Krenko, Mob Boss', 'R', 'fdn', '204'),
		],
		lifeTotal: 17,
	},
	{
		name: 'Tomás Reyes',
		pronouns: 'he/him',
		lgs: 'Mana Vault Café',
		commanders: [
			sampleCommander('c41554e7-2a07-4cc7-b01b-44deed08e588', 'Kozilek, the Great Distortion', '', 'cmm', '2'),
		],
		lifeTotal: 6,
		damageFrom: { player1: 14, player3: 20 },
		eliminated: true,
	},
];

/** A Commander Seat's tokens: its deck is its Commanders' names and colour identity, and each Commander a card (ADR-0087). */
function commanderSeatTokens(seat: CommanderFeatureMatchSampleSeat, prefix: Seat): Record<string, GraphicInputValue> {
	const deck = commanderDeckIdentity(seat.commanders);
	return {
		[`${prefix}Name`]: seat.name,
		[`${prefix}Deck`]: deck.deckName ?? '',
		[`${prefix}DeckColors`]: deck.deckColors ?? '',
		[`${prefix}Pronouns`]: seat.pronouns,
		[`${prefix}Lgs`]: seat.lgs,
		[`${prefix}Commander1Image`]: scryfallCardImageUrl(seat.commanders[0]?.scryfallId) ?? '',
		[`${prefix}Commander2Image`]: scryfallCardImageUrl(seat.commanders[1]?.scryfallId) ?? '',
	};
}

/** Four Commander Seats' token values, in Seat order. */
export function commanderSeatsTokenValues(seats: readonly CommanderFeatureMatchSampleSeat[]): Record<string, GraphicInputValue> {
	return Object.assign({}, ...SEAT_VALUES.map((seat, index) => commanderSeatTokens(seats[index]!, seat)));
}

/** A Commander Seat's live state: its life, whether it is Eliminated and the Commander Damage it has taken, with no game wins or Sideboard (ADR-0087). */
function commanderSeatState(seats: readonly CommanderFeatureMatchSampleSeat[], index: number): FeatureMatchSamplePlayerState {
	const seat = seats[index]!;
	return {
		lifeTotal: seat.lifeTotal,
		gameWins: 0,
		sideboard: null,
		sideboardRevealed: false,
		eliminated: seat.eliminated ?? false,
		commanderDamage: SEAT_VALUES.flatMap((opposing, opposingIndex) => opposingIndex === index
			? []
			: seats[opposingIndex]!.commanders.map((commander, commanderIndex) => ({
					damage: commanderIndex === 0
						? seat.damageFrom?.[opposing] ?? 0
						: 0,
					imageUrl: scryfallCardImageUrl(commander.scryfallId),
				}))),
	};
}

/** A Commander game's live state: one game across four Seats, each in it. */
export function commanderSampleContext(seats: readonly CommanderFeatureMatchSampleSeat[], clockDisplayTime: string): FeatureMatchSampleContext {
	return {
		clockDisplayTime,
		player1: commanderSeatState(seats, 0),
		player2: commanderSeatState(seats, 1),
		player3: commanderSeatState(seats, 2),
		player4: commanderSeatState(seats, 3),
		emptySeats: [],
		activeSeat: 'player2',
		bestOf: 1,
	};
}

const COMMANDER_SAMPLE_TOKEN_VALUES: Readonly<Record<string, GraphicInputValue>> = {
	...commanderSeatsTokenValues(COMMANDER_SAMPLE_SEATS),
	// A Commander Event has no Rounds or Phases: its Slot's round is what the operator typed.
	round: 'Game 2',
	stage: 'Game 2',
	table: 'Table 1',
	format: 'Commander',
	eventName: 'Sample Commander Night',
};

/** One kind of Event's Feature Match sample: its token values and its live session state. */
export interface FeatureMatchSample {
	kind: EventKind;
	tokenValues: Readonly<Record<string, GraphicInputValue>>;
	context: FeatureMatchSampleContext;
}

const SAMPLES: Readonly<Record<EventKind, FeatureMatchSample>> = {
	'mtg-two-player': { kind: 'mtg-two-player', tokenValues: FEATURE_MATCH_SAMPLE_TOKEN_VALUES, context: FEATURE_MATCH_SAMPLE_CONTEXT },
	'mtg-commander': {
		kind: 'mtg-commander',
		tokenValues: COMMANDER_SAMPLE_TOKEN_VALUES,
		context: commanderSampleContext(COMMANDER_SAMPLE_SEATS, '12:34'),
	},
	'op': { kind: 'op', tokenValues: OP_SAMPLE_TOKEN_VALUES, context: OP_SAMPLE_CONTEXT },
};

/** The Feature Match sample of an Event of this kind. */
export function featureMatchSampleDataset(kind: EventKind): FeatureMatchSample {
	return SAMPLES[kind];
}

/**
 * Whether every kind of Event's sample dataset still covers the tokens it is
 * offered.
 *
 * Exported as a function rather than asserted at module load: a preview rendering
 * one blank placeholder is a cosmetic gap, and refusing to load the application
 * over it would be a far worse failure than the one it prevents. The unit test is
 * where it is enforced.
 */
export function featureMatchSampleDatasetIsComplete(): boolean {
	return EVENT_KIND_VALUES.every(kind =>
		featureMatchTokenCatalogue(kind).every(token => token.key in SAMPLES[kind].tokenValues));
}
