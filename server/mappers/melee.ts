import type { DbArchetype, DbPlayer, DbPlayerDeck } from '~~/server/db/schema';
import type {
	MeleeDecklistRecordParsed,
	MeleeMatchCompetitorParsed,
	MeleeMatchParsed,
	MeleePlayerDecklistParsed,
	MeleePlayerParsed,
	MeleeStandingParsed,
} from '~~/server/schemas/external/melee';
import type { MatchUpsertInput } from '~~/server/services/match';
import type { DeckListCard } from '~~/shared/types/deckList';
import { applyMatchDeckSnapshot, selectMatchDeck } from '~~/server/utils/matchDeckSelection';

export { calculateDeckPips, calculateDeckStats } from '~~/shared/utils/deckStats';

export interface MatchMapperContext {
	/** Players keyed by both external source and external ID. */
	playerMap: Map<string, DbPlayer>;
	standingsMap: Map<number, MeleeStandingParsed>;
	playerDecksByPlayerId: Map<number, DbPlayerDeck[]>;
	archetypesById: Map<number, Pick<DbArchetype, 'id' | 'name' | 'colors'>>;
	roundFormatExternalId: string | null;
	warnings: string[];
}

/** Build an unambiguous external identity key for source-owned records. */
export function externalIdentityKey(externalSource: string, externalId: string | number): string {
	return `${externalSource}\u0000${externalId}`;
}

/**
 * The upstream payload was schema-valid but incomplete or internally
 * inconsistent, so it must not be treated as an authoritative replacement.
 */
export class InvalidMeleeRoundSnapshotError extends Error {
	readonly code = 'INVALID_MELEE_ROUND_SNAPSHOT';
	readonly statusCode = 422;
	readonly statusMessage = 'Invalid Melee round snapshot';

	constructor(message: string) {
		super(message);
		this.name = 'InvalidMeleeRoundSnapshotError';
	}
}

/**
 * Parsed deck list with stable Melee/format identity but without Scryfall IDs yet
 * Used as intermediate format during player sync
 */
export interface ParsedDeckList {
	externalId: string;
	formatId: string;
	name: string;
	colors: string;
	cards: DeckListCard[];
	companion: ParsedDeckCompanion | null;
}

export interface ParsedDeckCompanion {
	name: string;
	setCode: string | null;
	cardType: string;
	scryfallId: null;
}

export interface MappedMeleePlayer {
	externalId: string;
	externalSource: 'melee';
	externalStatus: number | null;
	name: string;
	pronouns: string | null;
	wins: number | null;
	losses: number | null;
	draws: number | null;
	position: number | null;
	points: number | null;
	deckLists: ParsedDeckList[] | undefined;
}

/**
 * Maps Melee COLOR_* attribute keys to MTG color codes
 */
const MELEE_COLOR_MAP: Record<string, string> = {
	COLOR_WHITE: 'W',
	COLOR_BLUE: 'U',
	COLOR_BLACK: 'B',
	COLOR_RED: 'R',
	COLOR_GREEN: 'G',
};

/**
 * Standard color order for MTG (WUBRG)
 */
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'];

function hasLetters(value: string): boolean {
	return /\p{L}/u.test(value);
}

function isAllUpperCase(value: string): boolean {
	return value === value.toLocaleUpperCase() && value !== value.toLocaleLowerCase();
}

function isAllLowerCase(value: string): boolean {
	return value === value.toLocaleLowerCase() && value !== value.toLocaleUpperCase();
}

function titleCaseName(value: string): string {
	return value
		.toLocaleLowerCase()
		.replace(/(^|[\s'-])(\p{L})/gu, (_match, separator: string, letter: string) => {
			return `${separator}${letter.toLocaleUpperCase()}`;
		});
}

/**
 * Normalizes inconsistent Melee player name casing while preserving intentional mixed case.
 */
export function normalizeMeleePlayerName(name: string): string {
	const trimmed = name.trim().replace(/\s+/g, ' ');

	if (!hasLetters(trimmed)) {
		return trimmed;
	}

	if (isAllUpperCase(trimmed) || isAllLowerCase(trimmed)) {
		return titleCaseName(trimmed);
	}

	return trimmed;
}

/**
 * Maps Melee compartment codes to deck list compartment names
 * 0 = mainboard, 99 = sideboard, 4 = companion
 */
function mapCompartment(compartmentCode: number): DeckListCompartment {
	return compartmentCode === 99 ? 'sideboard' : 'mainboard';
}

function isCompanionRecord(compartmentCode: number): boolean {
	return compartmentCode === 4;
}

/**
 * Type sort order for deck list cards - lower numbers come first
 */
const CARD_TYPE_ORDER: Record<string, number> = {
	Creature: 1,
	Planeswalker: 2,
	Battle: 3,
	Instant: 4,
	Sorcery: 5,
	Artifact: 6,
	Enchantment: 7,
	Land: 8,
};

/**
 * Basic lands in WUBRG order - these should always sort last
 */
const BASIC_LANDS_WUBRG: Record<string, number> = {
	Plains: 1,
	Island: 2,
	Swamp: 3,
	Mountain: 4,
	Forest: 5,
};

/**
 * Gets the sort order for a card type
 */
function getCardTypeOrder(cardType: string): number {
	for (const [type, order] of Object.entries(CARD_TYPE_ORDER)) {
		if (cardType.includes(type)) {
			return order;
		}
	}
	return 99; // Unknown types go last
}

/**
 * Gets the basic land sort order if card is a basic land, otherwise returns null
 */
function getBasicLandOrder(cardName: string): number | null {
	return BASIC_LANDS_WUBRG[cardName] ?? null;
}

/**
 * Parses Melee deck list records into DeckListCard format
 * Cards are sorted by type then alphabetically by name
 * Basic lands are always last, sorted in WUBRG order (Plains, Island, Swamp, Mountain, Forest)
 * Cards are returned without Scryfall IDs - those are added during sync
 */
export function parseDeckListRecords(records: MeleeDecklistRecordParsed[] | undefined): DeckListCard[] {
	if (!records || records.length === 0) {
		return [];
	}

	return records
		.filter(record => !isCompanionRecord(record.c))
		.map(record => ({
			name: record.n,
			setCode: record.s ?? null,
			quantity: record.q,
			compartment: mapCompartment(record.c),
			cardType: record.t,
			scryfallId: null, // Will be populated during sync
		}))
		.sort((a, b) => {
			const basicLandOrderA = getBasicLandOrder(a.name);
			const basicLandOrderB = getBasicLandOrder(b.name);

			// Basic lands always go last
			if (basicLandOrderA !== null && basicLandOrderB !== null) {
				// Both are basic lands - sort by WUBRG order
				return basicLandOrderA - basicLandOrderB;
			}
			if (basicLandOrderA !== null) {
				// Only A is a basic land - it goes after B
				return 1;
			}
			if (basicLandOrderB !== null) {
				// Only B is a basic land - it goes after A
				return -1;
			}

			// Neither is a basic land - sort by type then name
			const typeA = getCardTypeOrder(a.cardType);
			const typeB = getCardTypeOrder(b.cardType);
			if (typeA !== typeB) {
				return typeA - typeB;
			}
			return a.name.localeCompare(b.name);
		});
}

export function parseDeckListCompanion(records: MeleeDecklistRecordParsed[] | undefined): ParsedDeckCompanion | null {
	if (!records || records.length === 0) {
		return null;
	}

	const companionRecord = records.find(record => isCompanionRecord(record.c));
	if (!companionRecord) {
		return null;
	}

	return {
		name: companionRecord.n,
		setCode: companionRecord.s ?? null,
		cardType: companionRecord.t,
		scryfallId: null,
	};
}

/**
 * Parses a single Melee Decklist into ParsedDeckList format
 */
function parseMeleeDecklist(decklist: MeleePlayerDecklistParsed): ParsedDeckList {
	return {
		externalId: decklist.Guid,
		formatId: decklist.FormatId,
		name: decklist.DecklistName,
		colors: extractDeckColors(decklist) ?? 'C',
		cards: parseDeckListRecords(decklist.Records),
		companion: parseDeckListCompanion(decklist.Records),
	};
}

/**
 * Parses all Melee Decklists for a player into ParsedDeckList array
 */
export function parseAllDecklists(decklists: MeleePlayerDecklistParsed[] | undefined): ParsedDeckList[] | undefined {
	if (!decklists || decklists.length === 0) {
		return undefined;
	}

	return decklists.map(parseMeleeDecklist);
}

/**
 * Extracts deck colors from a Melee decklist's attributes
 * Looks for COLOR_* attributes with value "True" and combines them (e.g., "WUB")
 * Returns "C" for colourless if no colors are found
 */
function extractDeckColors(decklist: { Attributes?: Array<{ k: string; v: string }> } | undefined): string | undefined {
	if (!decklist?.Attributes) {
		return undefined;
	}

	const colors = decklist.Attributes
		.filter(attr => attr.k in MELEE_COLOR_MAP && attr.v === 'True')
		.map(attr => MELEE_COLOR_MAP[attr.k]!)
		.sort((a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b));

	// Return "C" for colourless if no colors found
	if (colors.length === 0) {
		return 'C';
	}

	return colors.join('');
}

/**
 * Maps a MeleePlayer with optional standing to the format for database upsert
 */
export function mapMeleePlayerToDb(
	player: MeleePlayerParsed,
	standing?: MeleeStandingParsed,
): MappedMeleePlayer {
	const allDecklists = parseAllDecklists(player.Decklists);

	return {
		externalId: player.TeamId.toString(),
		externalSource: 'melee',
		externalStatus: player.Status ?? null,
		name: normalizeMeleePlayerName(player.PlayerName),
		pronouns: player.PronounsDescription ?? null,
		wins: standing?.MatchWins ?? null,
		losses: standing?.MatchLosses ?? null,
		draws: standing?.MatchDraws ?? null,
		position: standing?.Rank ?? null,
		points: standing?.Points ?? null,
		deckLists: allDecklists,
	};
}

/**
 * Maps an array of MeleePlayer with standings to the format for database upsert, sorted by position
 */
export function mapMeleePlayersToDb(
	players: MeleePlayerParsed[],
	standings: MeleeStandingParsed[],
): MappedMeleePlayer[] {
	const seenTeamIds = new Set<number>();
	for (const player of players) {
		if (seenTeamIds.has(player.TeamId)) {
			throw new UnsupportedMeleeTeamPayloadError();
		}
		seenTeamIds.add(player.TeamId);
	}

	const standingTeamIds = new Set<number>();
	for (const standing of standings) {
		if (standingTeamIds.has(standing.TeamId)) {
			throw new Error(`Duplicate current Melee standing TeamId: ${standing.TeamId}`);
		}
		standingTeamIds.add(standing.TeamId);
	}

	const standingsMap = new Map(
		standings.map(standing => [standing.TeamId, standing]),
	);

	return players
		.map(player => mapMeleePlayerToDb(player, standingsMap.get(player.TeamId)))
		.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
}

/**
 * Team events return multiple people under one TeamId, which cannot be safely
 * represented by the current one-row-per-player external identity model.
 */
export class UnsupportedMeleeTeamPayloadError extends Error {
	readonly code = 'UNSUPPORTED_MELEE_TEAM_PAYLOAD';
	readonly statusCode = 422;
	readonly statusMessage = 'Unsupported Melee team tournament';

	constructor() {
		super('Unsupported Melee team tournament: multiple players share a TeamId. Stream Keepr currently supports individual-player tournaments only.');
		this.name = 'UnsupportedMeleeTeamPayloadError';
	}
}

/* ──────────────────────────────────────────────────────────
 * Match mappers — write to rounds/matches DB tables
 * ────────────────────────────────────────────────────────── */

/**
 * Maps a Melee competitor + DB context into CreateMatchInput-compatible player data snapshot.
 */
function mapCompetitorToPlayerData(
	competitor: MeleeMatchCompetitorParsed | undefined,
	context: MatchMapperContext,
	matchExternalId: string,
	matchFormatExternalId: string | null,
): { playerId: number | null; playerData: MatchUpsertInput['player1Data'] } {
	if (!competitor) {
		return { playerId: null, playerData: null };
	}

	const player = context.playerMap.get(externalIdentityKey('melee', competitor.TeamId));
	const standing = context.standingsMap.get(competitor.TeamId);

	if (!player) {
		throw new InvalidMeleeRoundSnapshotError(
			`Match ${matchExternalId} references unknown Melee participant ${competitor.TeamId}`,
		);
	}

	// A format or primary fallback must never attach a deck owned by another
	// source merely because it belongs to the same canonical Player.
	const playerDecks = (context.playerDecksByPlayerId.get(player.id) ?? [])
		.filter(deck => deck.externalSource === 'melee');
	const referencedDeckIds = competitor.Decklists.map(deck => deck.DecklistId);
	const resolvedDeck = selectMatchDeck(playerDecks, {
		externalIds: referencedDeckIds,
		formatExternalIds: [
			...competitor.Decklists.map(deck => deck.FormatId),
			matchFormatExternalId,
			context.roundFormatExternalId,
		],
	});
	const basePlayerData = {
		name: player.name,
		pronouns: player.pronouns ?? null,
		externalId: player.externalId ?? null,
		externalSource: player.externalSource ?? null,
		wins: standing?.MatchWins ?? null,
		losses: standing?.MatchLosses ?? null,
		draws: standing?.MatchDraws ?? null,
		position: standing?.Rank ?? null,
		points: standing?.Points ?? null,
		archetypeId: player.archetypeId,
		lgs: player.lgs,
		gameData: player.gameData,
	} satisfies NonNullable<MatchUpsertInput['player1Data']>;

	if (referencedDeckIds.length > 0 && resolvedDeck.strategy !== 'external-id') {
		context.warnings.push(
			`Match ${matchExternalId}: Melee deck reference for ${player.name} was not available locally; used ${resolvedDeck.strategy} fallback`,
		);
	}
	if (resolvedDeck.ambiguous) {
		context.warnings.push(
			`Match ${matchExternalId}: multiple ${resolvedDeck.strategy} decks matched ${player.name}; selected deterministically by sort order`,
		);
	}
	if (!resolvedDeck.deck && (referencedDeckIds.length > 0 || playerDecks.length > 0 || player.gameData?.type === 'mtg')) {
		context.warnings.push(`Match ${matchExternalId}: no submitted deck could be selected for ${player.name}`);
	}

	const playerData = applyMatchDeckSnapshot(
		basePlayerData,
		resolvedDeck.deck,
		resolvedDeck.deck?.archetypeId == null ? null : context.archetypesById.get(resolvedDeck.deck.archetypeId),
		{ expectsMtgDeck: referencedDeckIds.length > 0 || playerDecks.length > 0 },
	);

	return {
		playerId: player.id,
		playerData,
	};
}

function validateMeleeMatchSnapshot(
	meleeMatches: MeleeMatchParsed[],
	context: MatchMapperContext,
): void {
	const matchExternalIds = new Set<string>();

	for (const match of meleeMatches) {
		if (matchExternalIds.has(match.Guid)) {
			throw new InvalidMeleeRoundSnapshotError(
				`Duplicate Melee Match external identity: ${match.Guid}`,
			);
		}
		matchExternalIds.add(match.Guid);

		const competitorCount = match.Competitors.length;
		if (competitorCount > 2) {
			throw new InvalidMeleeRoundSnapshotError(
				`Match ${match.Guid} has ${competitorCount} competitors; at most two are supported`,
			);
		}

		// Melee can emit an explicit empty/one-sided completed Match or bye. An
		// otherwise unpaired Match is only a partial future snapshot and cannot be
		// authoritative yet.
		if (competitorCount < 2 && !match.HasResult && match.ByeReason == null) {
			throw new InvalidMeleeRoundSnapshotError(
				`Match ${match.Guid} is not paired or explicitly completed`,
			);
		}

		const competitorTeamIds = new Set<number>();
		const competitorSortOrders = new Set<number>();
		for (const competitor of match.Competitors) {
			if (competitorTeamIds.has(competitor.TeamId)) {
				throw new InvalidMeleeRoundSnapshotError(
					`Match ${match.Guid} contains duplicate competitor ${competitor.TeamId}`,
				);
			}
			competitorTeamIds.add(competitor.TeamId);

			if (competitorSortOrders.has(competitor.SortOrder)) {
				throw new InvalidMeleeRoundSnapshotError(
					`Match ${match.Guid} contains duplicate competitor sort order ${competitor.SortOrder}`,
				);
			}
			competitorSortOrders.add(competitor.SortOrder);

			if (!context.playerMap.has(externalIdentityKey('melee', competitor.TeamId))) {
				throw new InvalidMeleeRoundSnapshotError(
					`Match ${match.Guid} references unknown Melee participant ${competitor.TeamId}`,
				);
			}
		}
	}
}

/**
 * Maps a single MeleeMatch into data for DB upsert (without eventId — caller adds it).
 */
function mapMeleeMatchToDbRow(
	meleeMatch: MeleeMatchParsed,
	roundId: number,
	sortOrder: number,
	context: MatchMapperContext,
): Omit<MatchUpsertInput, 'eventId'> & { externalId: string; externalSource: 'melee' } {
	const competitors = meleeMatch.Competitors.slice().sort((a, b) => a.SortOrder - b.SortOrder);
	const matchFormatExternalId = meleeMatch.FormatId ?? null;
	const p1 = mapCompetitorToPlayerData(competitors[0], context, meleeMatch.Guid, matchFormatExternalId);
	const p2 = mapCompetitorToPlayerData(competitors[1], context, meleeMatch.Guid, matchFormatExternalId);

	const isBye = competitors.length < 2 || meleeMatch.ByeReason != null;

	return {
		roundId,
		externalId: meleeMatch.Guid,
		externalSource: 'melee',
		tableNumber: meleeMatch.TableNumber || null,
		player1Id: p1.playerId,
		player2Id: p2.playerId,
		player1Data: p1.playerData,
		player2Data: p2.playerData,
		hasResult: meleeMatch.HasResult ?? false,
		player1GameWins: competitors[0]?.GameWins ?? null,
		player2GameWins: competitors[1]?.GameWins ?? null,
		gameDraws: meleeMatch.GameDraws ?? null,
		isBye,
		resultString: meleeMatch.ResultString || null,
		sortOrder,
	};
}

/**
 * Maps an array of MeleeMatch into DB row data, sorted by table number.
 * Byes (table 0 / null) sort to the bottom.
 */
export function mapMeleeMatchesToDbRows(
	meleeMatches: MeleeMatchParsed[],
	roundId: number,
	eventId: number,
	context: MatchMapperContext,
): MatchUpsertInput[] {
	validateMeleeMatchSnapshot(meleeMatches, context);

	return meleeMatches
		.slice()
		.sort((a, b) => (a.TableNumber || Infinity) - (b.TableNumber || Infinity))
		.map((match, index) => ({
			...mapMeleeMatchToDbRow(match, roundId, index, context),
			eventId,
		}));
}
