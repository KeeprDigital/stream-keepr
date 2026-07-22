import type { DeckCompanion } from '../types/deckCompanion';
import type { DeckListCompartment, PointsSystem } from '../types/enums';
import type { HighlanderDeckSummary, HighlanderDuplicateCard, HighlanderPointedCard, HighlanderUnknownCard } from '../types/highlander';
import { SEVEN_POINT_HIGHLANDER } from '../highlander/7-point-highlander';
import { RESERVE_LIST_ORACLE_ID_SET } from '../mtg/reserve-list';

interface HighlanderDeckCardInput {
	name: string;
	oracleId: string | null;
	cardType: string | null;
	quantity: number;
	compartment: DeckListCompartment;
}

interface PointEntry {
	name: string;
	points: number;
	pointedAs?: 'companion';
}

export interface PointEntryInfo {
	points: number;
	pointedAs?: 'companion';
}

interface OracleGroup {
	name: string;
	quantity: number;
	isBasicLand: boolean;
	compartments: Set<DeckListCompartment>;
}

const BASIC_LAND_NAME_FALLBACKS = new Set([
	'plains',
	'island',
	'swamp',
	'mountain',
	'forest',
	'wastes',
	'snow-covered plains',
	'snow-covered island',
	'snow-covered swamp',
	'snow-covered mountain',
	'snow-covered forest',
]);

function getPointEntries(system: PointsSystem): Map<string, PointEntry> {
	switch (system) {
		case '7ph':
			return new Map(
				SEVEN_POINT_HIGHLANDER.entries.map(entry => [entry.oracleId, {
					name: entry.name,
					points: entry.points,
					pointedAs: entry.pointedAs,
				}]),
			);
	}
}

function isBasicLand(cardType: string | null, name: string): boolean {
	if (!cardType) {
		return BASIC_LAND_NAME_FALLBACKS.has(name.toLowerCase());
	}

	if (cardType.includes('Basic') && cardType.includes('Land')) {
		return true;
	}

	// Keep stale pre-fix card rows from falsely tripping singleton violations.
	return BASIC_LAND_NAME_FALLBACKS.has(name.toLowerCase());
}

function getUniqueCompartments(compartments: Set<DeckListCompartment>): DeckListCompartment[] {
	return (['mainboard', 'sideboard'] as const).filter(compartment => compartments.has(compartment));
}

function sortPointedCards(cards: HighlanderPointedCard[]): HighlanderPointedCard[] {
	return [...cards].sort((left, right) => right.points - left.points || left.name.localeCompare(right.name));
}

function sortDuplicateCards(cards: HighlanderDuplicateCard[]): HighlanderDuplicateCard[] {
	return [...cards].sort((left, right) => right.quantity - left.quantity || left.name.localeCompare(right.name));
}

function sortUnknownCards(cards: HighlanderUnknownCard[]): HighlanderUnknownCard[] {
	return [...cards].sort((left, right) => left.name.localeCompare(right.name));
}

export function getPointsSystemLabel(system: PointsSystem): string {
	switch (system) {
		case '7ph':
			return SEVEN_POINT_HIGHLANDER.label;
	}
}

export function getPointsByOracleId(system: PointsSystem): Map<string, number> {
	const entries = getPointEntries(system);
	const pointsByOracleId = new Map<string, number>();
	for (const [oracleId, entry] of entries) {
		if (entry.pointedAs === 'companion') {
			continue;
		}
		pointsByOracleId.set(oracleId, entry.points);
	}
	return pointsByOracleId;
}

export function getPointEntryByOracleId(system: PointsSystem, oracleId: string): PointEntryInfo | null {
	const entry = getPointEntries(system).get(oracleId);
	if (!entry) {
		return null;
	}

	return {
		points: entry.points,
		pointedAs: entry.pointedAs,
	};
}

export function evaluateHighlanderDeck(
	system: PointsSystem,
	deckCards: HighlanderDeckCardInput[],
	companion: Pick<DeckCompanion, 'name' | 'oracleId'> | null = null,
): HighlanderDeckSummary {
	const pointEntries = getPointEntries(system);
	const unknownByName = new Map<string, Set<'oracleId'>>();
	const oracleGroups = new Map<string, OracleGroup>();
	const pointedCards = new Map<string, HighlanderPointedCard>();
	const pointedOracleIds = new Set<string>();
	let points = 0;

	for (const card of deckCards) {
		if (!card.oracleId) {
			unknownByName.set(card.name, new Set([...(unknownByName.get(card.name) ?? []), 'oracleId']));
		}

		if (card.oracleId) {
			const group = oracleGroups.get(card.oracleId) ?? {
				name: card.name,
				quantity: 0,
				isBasicLand: false,
				compartments: new Set<DeckListCompartment>(),
			};
			group.quantity += card.quantity;
			group.isBasicLand = group.isBasicLand || isBasicLand(card.cardType, card.name);
			group.compartments.add(card.compartment);
			oracleGroups.set(card.oracleId, group);

			const pointEntry = pointEntries.get(card.oracleId);
			if (pointEntry && pointEntry.pointedAs !== 'companion') {
				if (!pointedOracleIds.has(card.oracleId)) {
					points += pointEntry.points;
					pointedOracleIds.add(card.oracleId);
				}

				const pointedCard = pointedCards.get(card.oracleId) ?? {
					name: card.name,
					points: pointEntry.points,
					compartments: [],
					totalQuantity: 0,
				};
				pointedCard.totalQuantity += card.quantity;
				const nextCompartments = new Set<DeckListCompartment>(pointedCard.compartments);
				nextCompartments.add(card.compartment);
				pointedCard.compartments = getUniqueCompartments(nextCompartments);
				pointedCards.set(card.oracleId, pointedCard);
			}
		}
	}

	if (companion?.oracleId) {
		const pointEntry = pointEntries.get(companion.oracleId);
		if (pointEntry?.pointedAs === 'companion') {
			points += pointEntry.points;
			pointedCards.set(`companion:${companion.oracleId}`, {
				name: companion.name,
				points: pointEntry.points,
				compartments: [],
				totalQuantity: 1,
				pointedAs: 'companion',
			});
		}
	}
	else if (companion && !companion.oracleId) {
		unknownByName.set(companion.name, new Set([...(unknownByName.get(companion.name) ?? []), 'oracleId']));
	}

	const unknownCards = sortUnknownCards(
		[...unknownByName.entries()].map(([name, missing]) => ({
			name,
			missing: [...missing].sort(),
		})),
	);

	const hasReserveListCards = unknownCards.length > 0
		? null
		: deckCards.some(card => card.oracleId != null && RESERVE_LIST_ORACLE_ID_SET.has(card.oracleId))
			|| (companion?.oracleId != null && RESERVE_LIST_ORACLE_ID_SET.has(companion.oracleId));
	const maxPoints = hasReserveListCards == null
		? null
		: hasReserveListCards
			? 7
			: 8;
	const duplicateCards = sortDuplicateCards(
		[...oracleGroups.values()]
			.filter(group => !group.isBasicLand && group.quantity > 1)
			.map(group => ({ name: group.name, quantity: group.quantity })),
	);

	const status = unknownCards.length > 0
		? 'unknown'
		: duplicateCards.length > 0 || (maxPoints != null && points > maxPoints)
			? 'illegal'
			: 'legal';

	return {
		system,
		status,
		points,
		maxPoints,
		hasReserveListCards,
		pointedCards: sortPointedCards([...pointedCards.values()]),
		duplicateCards,
		unknownCards,
	};
}

export function formatHighlanderPointsLabel(highlander: HighlanderDeckSummary): string {
	if (highlander.maxPoints != null && highlander.points !== highlander.maxPoints) {
		return `${highlander.points}/${highlander.maxPoints} Points`;
	}
	return `${highlander.points} Points`;
}

export function formatHighlanderIssueSummary(highlander: HighlanderDeckSummary): string {
	const parts: string[] = [];
	if (highlander.duplicateCards.length > 0) {
		parts.push(`${highlander.duplicateCards.length} duplicate${highlander.duplicateCards.length === 1 ? '' : 's'}`);
	}
	if (highlander.maxPoints != null && highlander.points > highlander.maxPoints) {
		parts.push(`${highlander.points}/${highlander.maxPoints} Points`);
	}
	if (highlander.unknownCards.length > 0) {
		parts.push(`${highlander.unknownCards.length} unresolved`);
	}
	return parts.join(', ');
}

export function formatHighlanderCompartmentNote(compartments: DeckListCompartment[]): string | null {
	if (compartments.length === 1 && compartments[0] === 'sideboard') {
		return 'Sideboard';
	}
	return null;
}

export function formatHighlanderPointedCardNote(card: Pick<HighlanderPointedCard, 'pointedAs' | 'compartments'>): string | null {
	if (card.pointedAs === 'companion') {
		return 'Companion';
	}

	return formatHighlanderCompartmentNote(card.compartments);
}
