import type { EventKind } from './config/games';
import type { CommanderFeatureMatchSampleSeat, FeatureMatchSample, FeatureMatchSampleContext } from './featureMatchSampleDataset';
import type { OpLeader } from './types/game';
import type { GraphicInputValue } from './types/graphics';
import { getGameConfig } from './config/games';
import { commanderSampleContext, commanderSeatsTokenValues, featureMatchSampleDataset, sampleCommander } from './featureMatchSampleDataset';
import { formatOpColors, opPrintingImageUrl } from './utils/card/op';

/**
 * The Feature Match Stress Dataset: one fixed set of the longest
 * plausible Feature Match values per kind of Event, beside the Feature Match Sample
 * Dataset. Only the editor's stress toggle resolves a layout against it, over a
 * bound Feature Match Slot's live data too, and only in the preview; nothing
 * saves the toggle, and no Screen Output ever shows these values.
 *
 * The sample is typical so a preview looks like a show; this one is the widest
 * a show will plausibly hold, so overflow shows up while authoring rather than
 * on show day (ADR-0062). The values are the list approved on #743.
 */

/** An Untimed Label of words at the schema's maximum, so it wraps as a real one would. */
const STRESS_UNTIMED_LABEL = 'Untimed - Play continues until a winner is decided. Ask a judge at the Feature Match Table for help.';

/** `formatClockTime`'s widest form: hours, minutes and seconds. */
const STRESS_CLOCK = '1:23:45';

/** The Round, stage and table every kind of Event shares. */
const SHARED_MATCH_TOKEN_VALUES = {
	round: 'Round 15',
	stage: 'Top 8 Quarterfinals',
	table: 'Feature Match Table 128',
} satisfies Record<string, GraphicInputValue>;

/** The values every pair shares. */
const SHARED_TOKEN_VALUES = {
	player1Name: 'Maximiliano Alessandro Fitzgerald-Okonkwo',
	player1Pronouns: 'they/them/theirs',
	player1Lgs: 'The Wandering Wizard Games & Collectibles',
	player2Name: 'Siobhán Nakamura-Vandenberghe',
	player2Pronouns: 'she/they',
	player2Lgs: 'Dragon\'s Hoard Tabletop Café',
	...SHARED_MATCH_TOKEN_VALUES,
} satisfies Record<string, GraphicInputValue>;

/** A sideboard of fifteen singletons, art unset as the sample's is: a preview never fetches remotely. */
function singletons(names: readonly string[]) {
	return names.map(name => ({ name, quantity: 1, imageUrl: null }));
}

const MTG_TOKEN_VALUES: Readonly<Record<string, GraphicInputValue>> = {
	...SHARED_TOKEN_VALUES,
	player1Record: '12-2-1',
	player1Deck: 'Temur Rhinos Crashing Footfalls',
	player1DeckColors: 'WUBRG',
	player1LeaderImage: '',
	player2Record: '11-3-1',
	player2Deck: 'Rakdos Scam Evoke Midrange',
	player2DeckColors: 'URG',
	player2LeaderImage: '',
	format: 'Canadian Highlander',
	eventName: 'Magic: The Gathering Regional Championship Qualifier - Sample City',
};

/** Life at its widest either way, two wins each in a best-of-five, and two full revealed sideboards. */
function mtgContext(clockDisplayTime: string): FeatureMatchSampleContext {
	return {
		clockDisplayTime,
		player1: {
			lifeTotal: 999,
			gameWins: 2,
			sideboard: singletons([
				'Asmoranomardicadaistinaculdacar',
				'Circle of Protection: Artifacts',
				'Delver of Secrets // Insectile Aberration',
				'Kozilek, Butcher of Truth',
				'Sorin, Vengeful Bloodlord',
				'Elesh Norn, Grand Cenobite',
				'Ulamog, the Infinite Gyre',
				'Emrakul, the Promised End',
				'Jace, Vryn\'s Prodigy // Jace, Telepath Unbound',
				'Mishra, Claimed by Gix',
				'Unholy Heat',
				'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki',
				'Kozilek\'s Return',
				'Brazen Borrower // Petty Theft',
				'Thought-Knot Seer',
			]),
			sideboardRevealed: true,
		},
		player2: {
			lifeTotal: -999,
			gameWins: 2,
			sideboard: singletons([
				'Circle of Protection: Artifacts',
				'Sorin, Vengeful Bloodlord',
				'Grief',
				'Kolaghan\'s Command',
				'Terminate',
				'Thoughtseize',
				'Bloodtithe Harvester',
				'Archon of Cruelty',
				'Tormod\'s Crypt',
				'Blood Moon',
				'Dauthi Voidwalker',
				'Anger of the Gods',
				'Liliana of the Veil',
				'Kroxa, Titan of Death\'s Hunger',
				'Magus of the Moon',
			]),
			sideboardRevealed: true,
		},
		activeSeat: 'player1',
		bestOf: 5,
	};
}

/**
 * The bandai-keepr catalogue's longest Leader names, each in its two colours
 * (no Leader has more): the deck is named and coloured by its Leader (ADR-0057).
 */
const OP_STRESS_LEADERS: readonly [OpLeader, OpLeader] = [
	{
		number: 'OP04-019',
		name: 'Donquixote Doflamingo',
		colors: ['Green', 'Purple'],
		imageUrl: opPrintingImageUrl('OP04-019'),
	},
	{
		number: 'OP12-061',
		name: 'Donquixote Rosinante',
		colors: ['Purple', 'Yellow'],
		imageUrl: opPrintingImageUrl('OP12-061'),
	},
];

function opLeaderTokens(leader: OpLeader, prefix: 'player1' | 'player2'): Record<string, GraphicInputValue> {
	return {
		// An OP Event keeps no results, so a side has no record.
		[`${prefix}Record`]: '',
		[`${prefix}Deck`]: leader.name,
		[`${prefix}DeckColors`]: formatOpColors(leader.colors),
		[`${prefix}LeaderImage`]: leader.imageUrl,
	};
}

const OP_TOKEN_VALUES: Readonly<Record<string, GraphicInputValue>> = {
	...SHARED_TOKEN_VALUES,
	...opLeaderTokens(OP_STRESS_LEADERS[0], 'player1'),
	...opLeaderTokens(OP_STRESS_LEADERS[1], 'player2'),
	// An OP Event names no format beyond its Card Game, as the sample does.
	format: getGameConfig('op').label,
	eventName: 'One Piece Card Game Regional Championship - Sample City',
};

/** No life or sideboard is tracked for a One Piece Match (ADR-0057): only the clock is stressed. */
function opContext(clockDisplayTime: string): FeatureMatchSampleContext {
	return {
		...featureMatchSampleDataset('op').context,
		clockDisplayTime,
	};
}

/**
 * Four Seats, each a pair of long-named Commanders, the first's in four
 * colours, at life three digits wide either way: the pair's names and stores
 * and two more as long.
 */
const COMMANDER_STRESS_SEATS: readonly CommanderFeatureMatchSampleSeat[] = [
	{
		name: SHARED_TOKEN_VALUES.player1Name,
		pronouns: SHARED_TOKEN_VALUES.player1Pronouns,
		lgs: SHARED_TOKEN_VALUES.player1Lgs,
		commanders: [
			sampleCommander('4e3fe912-1374-47c7-b73f-89ef55c479c1', 'Silas Renn, Seeker Adept', 'UB', 'c16', '43'),
			sampleCommander('125b552b-45ea-4e0b-94a9-8131c97a04c0', 'Bruse Tarl, Boorish Herder', 'WR', 'c16', '30'),
		],
		lifeTotal: 999,
	},
	{
		name: SHARED_TOKEN_VALUES.player2Name,
		pronouns: SHARED_TOKEN_VALUES.player2Pronouns,
		lgs: SHARED_TOKEN_VALUES.player2Lgs,
		commanders: [
			sampleCommander('2e89ce6a-6bc9-427f-a8b2-c07a9fc3218f', 'Ishai, Ojutai Dragonspeaker', 'WU', 'cm2', '12'),
			sampleCommander('8afad106-a49b-4910-959e-228c109ea983', 'Reyhan, Last of the Abzan', 'BG', 'cm2', '13'),
		],
		lifeTotal: -999,
	},
	{
		name: 'Bartholomew Oyelaran-Christodoulou',
		pronouns: 'he/they/xe',
		lgs: 'The Gilded Gryphon Games, Comics & Coffee',
		commanders: [
			sampleCommander('a4fab67f-00c2-4125-9262-d21a29411797', 'Rograkh, Son of Rohgahh', 'R', 'cmr', '197'),
			sampleCommander('728b802c-969b-4865-b7a0-871c585d097a', 'Ardenn, Intrepid Archaeologist', 'W', 'cmr', '10'),
		],
		lifeTotal: 999,
	},
	{
		name: 'Wilhelmina van der Westhuizen-Achterberg',
		pronouns: 'she/her/hers',
		lgs: 'Planeswalker\'s Rest Hobby Emporium',
		commanders: [
			sampleCommander('8f244716-78ab-46f5-b6e9-fc1e6db28052', 'Tevesh Szat, Doom of Fools', 'B', 'cmr', '153'),
			sampleCommander('f606ebf1-483d-4331-b16a-9fb6f591a39f', 'Kediss, Emberclaw Familiar', 'R', 'cmr', '188'),
		],
		lifeTotal: -999,
	},
];

const COMMANDER_TOKEN_VALUES: Readonly<Record<string, GraphicInputValue>> = {
	...commanderSeatsTokenValues(COMMANDER_STRESS_SEATS),
	...SHARED_MATCH_TOKEN_VALUES,
	format: 'Commander: Pre-Constructed Decks Only',
	eventName: 'Magic: The Gathering Commander Invitational Showcase - Sample City',
};

export interface FeatureMatchStressOptions {
	/** Whether the Match previewed is an Untimed Match, whose clock shows the Untimed Label. */
	untimed: boolean;
}

const DATASETS: Readonly<Record<EventKind, (clockDisplayTime: string) => FeatureMatchSample>> = {
	'mtg-two-player': clockDisplayTime => ({
		kind: 'mtg-two-player',
		tokenValues: MTG_TOKEN_VALUES,
		context: mtgContext(clockDisplayTime),
	}),
	'mtg-commander': clockDisplayTime => ({
		kind: 'mtg-commander',
		tokenValues: COMMANDER_TOKEN_VALUES,
		context: commanderSampleContext(COMMANDER_STRESS_SEATS, clockDisplayTime),
	}),
	'op': clockDisplayTime => ({
		kind: 'op',
		tokenValues: OP_TOKEN_VALUES,
		context: opContext(clockDisplayTime),
	}),
};

/** The Feature Match Stress Dataset of an Event of this kind. */
export function featureMatchStressDataset(kind: EventKind, { untimed }: FeatureMatchStressOptions): FeatureMatchSample {
	return DATASETS[kind](untimed
		? STRESS_UNTIMED_LABEL
		: STRESS_CLOCK);
}
