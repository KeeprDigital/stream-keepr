import type { DeckTokenRequirement } from '../utils/deckTokens';
import type { DeckCompanion } from './deckCompanion';
import type { BoardSelection, ExternalSource, MetagameScope } from './enums';
import type { HighlanderDeckSummary } from './highlander';

// ─── Query params (shared between client + server) ──────────────

export interface MetagameQueryParams {
	scope: MetagameScope;
	topN?: number;
	playerListId?: number;
}

export interface MetagameCardTableQueryParams extends MetagameQueryParams {
	board?: BoardSelection;
}

// ─── Card response ───────────────────────────────────────────────

export interface CardResponse {
	id: number;
	name: string;
	game: string;
	scryfallId: string | null;
	oracleId?: string | null;
	cardType: string | null;
	colors: string | null;
	cmc: number | null;
	manaCost: string | null;
}

export interface MetagameSimpleFact {
	kind: 'simple';
	key: 'mostPlayedArchetype' | 'bestMajorWinRate';
	title: string;
	value: string;
	detail: string;
	tone?: 'neutral' | 'warning';
}

export interface MetagameCardSplitFactEntry {
	label: 'Mainboard' | 'Sideboard';
	value: string;
	detail: string;
}

export interface MetagameCardSplitFact {
	kind: 'cardSplit';
	key: 'mostPlayedCards' | 'highestAvgCopiesCards';
	title: string;
	mainboard: MetagameCardSplitFactEntry | null;
	sideboard: MetagameCardSplitFactEntry | null;
	tone?: 'neutral' | 'warning';
}

export type MetagameFact = MetagameSimpleFact | MetagameCardSplitFact;

// ─── Archetype breakdown (list view) ────────────────────────────

/** Single row in the archetype breakdown table */
export interface ArchetypeBreakdownEntry {
	/** Archetype DB id */
	id: number;
	name: string;
	colors: string | null;
	count: number;
	metaShare: number;
	winRate: number | null;
	avgPosition: number | null;
	/** Curated key cards for display */
	keyCards: CardResponse[];
}

export interface ArchetypeBreakdownResponse {
	entries: ArchetypeBreakdownEntry[];
	totalPlayers: number;
	/** Players with archetypeId != null */
	classifiedPlayers: number;
	scope: MetagameScope;
}

// ─── Card breakdown (list view) ─────────────────────────────────

/** Single row in the card popularity table */
export interface CardBreakdownEntry {
	id: number;
	name: string;
	cardType: string | null;
	scryfallId: string | null;
	colors: string | null;
	cmc: number | null;
	manaCost: string | null;
	inclusionRate: number;
	avgCopies: number;
	totalCopies: number;
	mainboardCount: number;
	sideboardCount: number;
	mainboardDeckCount: number;
	sideboardDeckCount: number;
	/** Number of decks containing this card */
	deckCount: number;
}

export interface CardBreakdownResponse {
	entries: CardBreakdownEntry[];
	totalDecks: number;
	scope: MetagameScope;
}

// ─── Token requirements (list view) ─────────────────────────────

export interface TokenSourceCardEntry {
	id: number;
	name: string;
	scryfallId: string | null;
	cardType: string | null;
}

export interface TokenRequirementEntry extends DeckTokenRequirement {
	deckCount: number;
	sourceCardCount: number;
	sourceCards: TokenSourceCardEntry[];
}

export interface TokenRequirementsResponse {
	entries: TokenRequirementEntry[];
	totalDecks: number;
	scope: MetagameScope;
}

// ─── Summary dashboard ──────────────────────────────────────────

export interface MetagameSummaryResponse {
	totalPlayers: number;
	classifiedPlayers: number;
	totalDecks: number;
	totalArchetypes: number;
	scopedArchetypeCount: number;
	scope: MetagameScope;
	facts: MetagameFact[];
	topArchetypes: ArchetypeBreakdownEntry[];
	topCards: CardBreakdownEntry[];
}

// ─── Archetype detail ───────────────────────────────────────────

export interface ArchetypePlayerEntry {
	id: number;
	name: string;
	/** Deck name from MTG game data */
	deckName: string | null;
	position: number | null;
	points: number | null;
	wins: number | null;
	losses: number | null;
	draws: number | null;
	colors: string | null;
}

export interface ArchetypeDetailResponse {
	id: number;
	name: string;
	colors: string | null;
	keyCards: CardResponse[];
	playerCount: number;
	metaShare: number;
	winRate: number | null;
	avgPosition: number | null;
	cardBreakdown: CardBreakdownEntry[];
	players: ArchetypePlayerEntry[];
}

// ─── Card detail ────────────────────────────────────────────────

export interface CardArchetypeEntry {
	id: number;
	name: string;
	colors: string | null;
	isKeyCard: boolean;
	inclusionRate: number;
	deckCount: number;
}

export interface CardCoOccurrenceEntry {
	id: number;
	name: string;
	cardType: string | null;
	scryfallId: string | null;
	manaCost: string | null;
	cmc: number | null;
	colors: string | null;
	coOccurrenceRate: number;
	deckCount: number;
}

export interface CardPlayerEntry {
	id: number;
	name: string;
	position: number | null;
	points: number | null;
	wins: number | null;
	losses: number | null;
	draws: number | null;
	quantity: number;
	compartment: 'mainboard' | 'sideboard';
}

export interface CardDetailResponse {
	card: CardResponse;
	totalDecks: number;
	inclusionRate: number;
	avgCopies: number;
	mainboardCount: number;
	sideboardCount: number;
	archetypes: CardArchetypeEntry[];
	players: CardPlayerEntry[];
	coOccurrence: CardCoOccurrenceEntry[];
}

// ─── Player deck (overlay endpoint) ─────────────────────────────

export interface PlayerDeckCardEntry {
	cardId: number;
	name: string;
	scryfallId: string | null;
	cardType: string | null;
	colors: string | null;
	cmc: number | null;
	manaCost: string | null;
	deckCounterTypes: string[];
	deckTokens: DeckTokenRequirement[];
	quantity: number;
	compartment: 'mainboard' | 'sideboard';
	sortOrder: number;
	highlanderPoints?: number | null;
}

export interface PlayerDeckResponse {
	id: number;
	playerId: number;
	externalId: string;
	formatExternalId: string;
	phaseIds: number[];
	phaseName: string | null;
	/** Effective display name. Reviewed decks use the assigned archetype name. */
	name: string;
	/** Effective display colours. Reviewed decks use the assigned archetype colours. */
	colors: string;
	/** Source-owned name submitted by Melee. Never use this for normal display. */
	submittedName: string;
	/** Source-owned colours submitted by Melee. Never use this for normal display. */
	submittedColors: string;
	sortOrder: number;
	isPrimary: boolean;
	archetypeId: number | null;
	reviewedAt: Date | null;
	cards: PlayerDeckCardEntry[];
	companion?: DeckCompanion | null;
	highlander?: HighlanderDeckSummary;
}

export interface PlayerDeckSummaryResponse {
	id: number;
	eventId: number;
	playerId: number;
	externalId: string;
	externalSource: ExternalSource;
	formatExternalId: string;
	/** Effective display name. Reviewed decks use the assigned archetype name. */
	name: string;
	/** Effective display colours. Reviewed decks use the assigned archetype colours. */
	colors: string;
	/** Source-owned name submitted by Melee. Never use this for normal display. */
	submittedName: string;
	/** Source-owned colours submitted by Melee. Never use this for normal display. */
	submittedColors: string;
	sortOrder: number;
	isPrimary: boolean;
	archetypeId: number | null;
	reviewedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface PlayerDeckReviewResponse {
	deck: PlayerDeckSummaryResponse;
	player: import('~~/shared/api').PlayerResponse | null;
}

export interface PlayerDeckCollectionResponse {
	decks: PlayerDeckResponse[];
	selectedDeckId: number | null;
}
