import type { DbMatch } from '~~/server/db/schema';
import type { MatchUpsertInput } from '~~/server/services/match';
import type { RoundStandingInput } from '~~/server/services/playerRoundStandings';

/** Match fields that make up a Match Result. */
export const MATCH_RESULT_FIELDS = [
	'hasResult',
	'player1GameWins',
	'player2GameWins',
	'gameDraws',
	'isBye',
] as const;

/** Match fields that make up a pairing; `*Data` compare structurally. */
export const MATCH_PAIRING_FIELDS = [
	'roundId',
	'tableNumber',
	'player1Id',
	'player2Id',
	'player1Data',
	'player2Data',
	'sortOrder',
] as const;

type ComparedField = typeof MATCH_RESULT_FIELDS[number] | typeof MATCH_PAIRING_FIELDS[number];

/** An incoming field as the stored row would hold it once written. */
function incomingValue(match: MatchUpsertInput, field: ComparedField): unknown {
	switch (field) {
		case 'hasResult':
		case 'isBye':
			return match[field] ?? false;
		case 'sortOrder':
			return match.sortOrder ?? 0;
		default:
			return match[field] ?? null;
	}
}

/** JSON with object keys sorted and `undefined` dropped, as stored JSON reads back. */
function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, nested: unknown) => {
		if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) {
			return nested;
		}
		return Object.fromEntries(Object.entries(nested).toSorted(([a], [b]) => a < b
			? -1
			: a > b
				? 1
				: 0));
	});
}

function fieldsDiffer(stored: DbMatch, incoming: MatchUpsertInput, fields: readonly ComparedField[]) {
	return fields.some(field => canonicalJson(stored[field]) !== canonicalJson(incomingValue(incoming, field)));
}

export interface RoundMatchesDiff {
	/** New Matches and Matches whose stored row differs. */
	toWrite: MatchUpsertInput[];
	/** Stored Matches whose Match Result changed (reported, corrected or un-reported). */
	resultChangedExternalIds: string[];
	/** A Match was added, removed, or had a pairing field change. */
	pairingsChanged: boolean;
}

/**
 * Diff a Round's incoming Melee Matches against the stored Melee Matches they
 * replace. Every stored row absent from `incoming` counts as removed.
 */
export function diffRoundMatches(stored: DbMatch[], incoming: MatchUpsertInput[]): RoundMatchesDiff {
	const storedByExternalId = new Map(stored.flatMap(row => row.externalId == null
		? []
		: [
				[row.externalId, row] as const,
			]));
	const incomingExternalIds = new Set(incoming.map(match => match.externalId));
	const toWrite: MatchUpsertInput[] = [];
	const resultChangedExternalIds: string[] = [];
	let pairingsChanged = [
		...storedByExternalId.keys(),
	].some(externalId => !incomingExternalIds.has(externalId));

	for (const match of incoming) {
		const row = match.externalId == null
			? undefined
			: storedByExternalId.get(match.externalId);
		if (!row) {
			toWrite.push(match);
			pairingsChanged = true;
			continue;
		}
		const resultChanged = fieldsDiffer(row, match, MATCH_RESULT_FIELDS);
		const pairingChanged = fieldsDiffer(row, match, MATCH_PAIRING_FIELDS);
		if (resultChanged) {
			resultChangedExternalIds.push(match.externalId!);
		}
		if (pairingChanged) {
			pairingsChanged = true;
		}
		if (resultChanged || pairingChanged) {
			toWrite.push(match);
		}
	}

	return { toWrite, resultChangedExternalIds, pairingsChanged };
}

const STANDING_FIELDS = [
	'wins',
	'losses',
	'draws',
	'position',
	'points',
] as const;

/** Whether two Round Standings sets differ, row for row by Player. */
export function standingsDiffer(stored: RoundStandingInput[], incoming: RoundStandingInput[]): boolean {
	if (stored.length !== incoming.length) {
		return true;
	}
	const storedByPlayerId = new Map(stored.map(row => [row.playerId, row]));
	return incoming.some((row) => {
		const storedRow = storedByPlayerId.get(row.playerId);
		return !storedRow || STANDING_FIELDS.some(field => storedRow[field] !== row[field]);
	});
}
