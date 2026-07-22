/**
 * Provenance: the Melee-owned identity and lifecycle columns on synced
 * entities. This module is the single chokepoint stating which columns a
 * manual (operator) write may touch — services pass every manual create and
 * update payload through pickManualWritable before it reaches the database.
 *
 * Every column of every synced entity is classified exactly once:
 * - manualWritable: operators may write it
 * - meleeOwned: only Melee Sync may write it (identity + sync lifecycle)
 * - serverManaged: only the server itself writes it (keys, timestamps,
 *   workflow pointers)
 *
 * The classification is pinned against the live Drizzle schema by
 * test/unit/server/utils/provenance.test.ts — adding a column fails that test
 * until the column is classified here. New columns are therefore
 * not-writable by default.
 */

interface ProvenanceClassification {
	manualWritable: readonly string[];
	meleeOwned: readonly string[];
	serverManaged: readonly string[];
}

export const PROVENANCE_ENTITIES = {
	players: {
		manualWritable: ['name', 'pronouns', 'wins', 'losses', 'draws', 'position', 'points', 'archetypeId', 'lgs', 'gameData'],
		meleeOwned: ['externalId', 'externalSource', 'externalStatus', 'isActive', 'lastSeenAt'],
		serverManaged: ['id', 'eventId', 'createdAt', 'updatedAt'],
	},
	phases: {
		manualWritable: ['name', 'sortOrder'],
		meleeOwned: ['externalId', 'externalSource', 'formatExternalId'],
		serverManaged: ['id', 'eventId', 'createdAt', 'updatedAt'],
	},
	rounds: {
		manualWritable: ['phaseId', 'name', 'roundNumber', 'controlMode'],
		meleeOwned: ['externalId', 'externalSource', 'lastSyncedAt'],
		serverManaged: ['id', 'eventId', 'createdAt', 'updatedAt'],
	},
	matches: {
		manualWritable: ['roundId', 'tableNumber', 'player1Id', 'player2Id', 'player1Data', 'player2Data', 'hasResult', 'player1GameWins', 'player2GameWins', 'gameDraws', 'isBye', 'resultString', 'sortOrder'],
		meleeOwned: ['externalId', 'externalSource'],
		serverManaged: ['id', 'eventId', 'createdAt', 'updatedAt'],
	},
	featureMatchSlots: {
		manualWritable: ['matchId', 'tableNumber', 'roundName', 'formatName', 'player1Id', 'player2Id', 'player1Data', 'player2Data', 'bestOf', 'sortOrder', 'playerDisplayMode'],
		meleeOwned: ['externalId', 'externalSource'],
		serverManaged: ['id', 'eventId', 'createdAt', 'updatedAt', 'activeSessionId'],
	},
} as const satisfies Record<string, ProvenanceClassification>;

export type ProvenanceEntity = keyof typeof PROVENANCE_ENTITIES;

type ManualWritableColumn<E extends ProvenanceEntity> = (typeof PROVENANCE_ENTITIES)[E]['manualWritable'][number];

/**
 * Allowlist a manual write payload down to the entity's manually writable
 * columns. Unclassified keys are dropped along with Melee-owned and
 * server-managed ones. Statically-known writable keys keep their original
 * optionality, so required insert columns stay required.
 */
export function pickManualWritable<E extends ProvenanceEntity, T extends object>(
	entity: E,
	data: T,
): Pick<T, Extract<keyof T, ManualWritableColumn<E>>> {
	const writable = PROVENANCE_ENTITIES[entity].manualWritable as readonly string[];
	const picked: Record<string, unknown> = {};
	for (const key of Object.keys(data)) {
		if (writable.includes(key)) {
			picked[key] = (data as Record<string, unknown>)[key];
		}
	}
	return picked as Pick<T, Extract<keyof T, ManualWritableColumn<E>>>;
}
