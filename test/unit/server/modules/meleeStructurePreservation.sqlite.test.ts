import type { MeleeEventParsed } from '~~/server/schemas/external/melee';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Melee Sync never removes manual tournament structure (#701, ADR-0040).
 *
 * Every Round and Match row here sits under real foreign keys with the
 * schema's `ON DELETE CASCADE`, so a stale imported Phase or Round removed
 * while it still holds manual structure would take that structure with it.
 * That cascade is the defect these proofs pin, which is why they run on
 * SQLite and not on the chainable db mock.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const publishMessage = vi.fn();
const publishMessageStrict = vi.fn();

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage,
	publishMessageStrict,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: vi.fn(),
}));
vi.doMock('~~/server/services/meleeIntegration', () => ({
	requireMeleeService: vi.fn(() => ({})),
}));
vi.doMock('~~/server/services/meleeCredentials', () => ({
	protectMeleeClientSecret: vi.fn(async (secret: string) => `encrypted:${secret}`),
}));

const { createMeleeSyncWorkflows } = await import('~~/server/modules/melee-sync/workflows');
const { eventService } = await import('~~/server/services/event');

const ctx = { originConnectionId: 'origin-1' };
const meleeEventData = {
	game: 'mtg' as const,
	meleeEnabled: true,
	meleeEventId: 'melee-1',
	meleeClientId: 'client',
	meleeClientSecret: 'secret',
};

afterAll(async () => await harness.close());

async function createEvent() {
	const [event] = await db.insert(schema.events)
		.values({
			name: 'Mixed Provenance Open',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			meleeEnabled: true,
			meleeEventId: 'melee-1',
		})
		.returning({ id: schema.events.id });
	return event!.id;
}

async function insertPhase(eventId: number, name: string, externalId: string | null) {
	const [phase] = await db.insert(schema.phases).values({
		eventId,
		name,
		externalId,
		externalSource: externalId ? 'melee' : 'manual',
		formatExternalId: externalId ? 'modern' : null,
	}).returning();
	return phase!;
}

async function insertRound(eventId: number, phaseId: number, name: string, externalId: string | null) {
	const [round] = await db.insert(schema.rounds).values({
		eventId,
		phaseId,
		name,
		roundNumber: 1,
		externalId,
		externalSource: externalId ? 'melee' : 'manual',
		lastSyncedAt: externalId
			? new Date('2026-10-01T00:00:00.000Z')
			: null,
	}).returning();
	return round!;
}

async function insertMatch(eventId: number, roundId: number, externalId: string | null) {
	const [match] = await db.insert(schema.matches).values({
		eventId,
		roundId,
		externalId,
		externalSource: externalId ? 'melee' : 'manual',
		tableNumber: 1,
	}).returning();
	return match!;
}

function upstream(phases: MeleeEventParsed['Phases']): MeleeEventParsed {
	return {
		ID: 1,
		Name: 'Mixed Provenance Open',
		Game: 'Magic: The Gathering',
		Phases: phases,
	} as MeleeEventParsed;
}

async function readStructure(eventId: number) {
	return {
		phases: await db.select().from(schema.phases).where(eq(schema.phases.eventId, eventId)).orderBy(schema.phases.id),
		rounds: await db.select().from(schema.rounds).where(eq(schema.rounds.eventId, eventId)).orderBy(schema.rounds.id),
		matches: await db.select().from(schema.matches).where(eq(schema.matches.eventId, eventId)).orderBy(schema.matches.id),
	};
}

beforeEach(() => {
	publishMessage.mockReset();
	publishMessageStrict.mockReset().mockResolvedValue(undefined);
});

describe('melee Sync structure reconciliation keeps manual descendants', () => {
	it('keeps a stale imported Phase holding a manual Round and its Matches, as manual structure', async () => {
		const eventId = await createEvent();
		const stalePhase = await insertPhase(eventId, 'Old Swiss', 'phase-old');
		const manualRound = await insertRound(eventId, stalePhase.id, 'Bonus Round', null);
		const manualMatch = await insertMatch(eventId, manualRound.id, null);
		const importedRound = await insertRound(eventId, stalePhase.id, 'Round 1', 'round-old');
		await insertMatch(eventId, importedRound.id, 'match-old');

		const result = await createMeleeSyncWorkflows().syncEventStructure(ctx, eventId, meleeEventData, upstream([
			{
				ID: 200,
				Name: 'Swiss',
				FormatId: 'modern',
				SortOrder: 0,
				Rounds: [
					{ ID: 2001, Name: 'Round 1', SortOrder: 0 },
				],
			},
		] as MeleeEventParsed['Phases']));

		const after = await readStructure(eventId);
		expect(after.phases.find(phase => phase.id === stalePhase.id)).toMatchObject({
			name: 'Old Swiss',
			externalId: null,
			externalSource: 'manual',
		});
		expect(after.rounds.find(round => round.id === manualRound.id)).toMatchObject({
			phaseId: stalePhase.id,
			externalId: null,
			externalSource: 'manual',
		});
		expect(after.matches.find(match => match.id === manualMatch.id)).toMatchObject({
			roundId: manualRound.id,
			externalSource: 'manual',
		});
		// The imported Round held nothing manual, so it went as before, with its Match.
		expect(after.rounds.some(round => round.id === importedRound.id)).toBe(false);
		expect(after.matches.some(match => match.externalId === 'match-old')).toBe(false);
		expect(result.warnings).toEqual([
			'Phase "Old Swiss" is no longer on Melee.gg and holds manual Rounds or Matches, so it was kept as a manual Phase',
		]);
	});

	it('keeps a stale imported Round holding a manual Match, and its Feature Match Assignment, under its live Phase', async () => {
		const eventId = await createEvent();
		const livePhase = await insertPhase(eventId, 'Swiss', '400');
		const staleRound = await insertRound(eventId, livePhase.id, 'Round 3', 'round-gone');
		const importedMatch = await insertMatch(eventId, staleRound.id, 'match-gone');
		const manualMatch = await insertMatch(eventId, staleRound.id, null);
		const [player] = await db.insert(schema.players).values({
			eventId,
			name: 'Ada',
			externalId: 'p-1',
			externalSource: 'melee',
		}).returning();
		await db.insert(schema.playerRoundStandings).values({
			eventId,
			playerId: player!.id,
			roundId: staleRound.id,
			wins: 2,
		});
		const [slot] = await db.insert(schema.featureMatches).values({ eventId, matchId: manualMatch.id }).returning();
		const [assignment] = await db.insert(schema.featureMatchAssignments)
			.values({
				eventId,
				roundId: staleRound.id,
				slotId: slot!.id,
				matchId: manualMatch.id,
				note: 'Feature table',
			})
			.returning();

		const result = await createMeleeSyncWorkflows().syncEventStructure(ctx, eventId, meleeEventData, upstream([
			{
				ID: 400,
				Name: 'Swiss',
				FormatId: 'modern',
				SortOrder: 0,
				Rounds: [],
			},
		] as MeleeEventParsed['Phases']));

		const after = await readStructure(eventId);
		expect(after.phases.find(phase => phase.id === livePhase.id)).toMatchObject({
			externalId: '400',
			externalSource: 'melee',
		});
		expect(after.rounds.find(round => round.id === staleRound.id)).toMatchObject({
			phaseId: livePhase.id,
			name: 'Round 3',
			externalId: null,
			externalSource: 'manual',
			lastSyncedAt: null,
		});
		expect(after.matches.map(match => match.id)).toEqual([manualMatch.id]);
		expect(after.matches.some(match => match.id === importedMatch.id)).toBe(false);
		expect(await db.select().from(schema.playerRoundStandings).where(eq(schema.playerRoundStandings.roundId, staleRound.id))).toEqual([]);
		expect(await db.query.featureMatchAssignments.findFirst({
			where: (table, { eq }) => eq(table.id, assignment!.id),
		}))
			.toMatchObject({ roundId: staleRound.id, matchId: manualMatch.id, note: 'Feature table' });
		expect(result.warnings).toEqual([
			'Round "Round 3" in "Swiss" is no longer on Melee.gg and holds manual Matches, so it was kept as a manual Round',
		]);
		expect(publishMessageStrict).toHaveBeenCalledWith(eventId, 'melee:structureSynced', expect.objectContaining({
			changes: {
				phases: { created: [], updated: [], deleted: [] },
				rounds: {
					created: [],
					updated: [staleRound.id],
					deleted: [],
				},
			},
		}), 'origin-1');
	});

	it('removes imported-only stale structure, and a repeated sync changes nothing and warns nothing', async () => {
		const eventId = await createEvent();
		const mixedPhase = await insertPhase(eventId, 'Day 1', 'phase-day-1');
		const manualRound = await insertRound(eventId, mixedPhase.id, 'Side Event', null);
		const manualMatch = await insertMatch(eventId, manualRound.id, null);
		const importedOnlyPhase = await insertPhase(eventId, 'Day 2', 'phase-day-2');
		const importedOnlyRound = await insertRound(eventId, importedOnlyPhase.id, 'Round 9', 'round-9');
		await insertMatch(eventId, importedOnlyRound.id, 'match-9');
		const livePhases = [
			{
				ID: 300,
				Name: 'Top 8',
				FormatId: 'modern',
				SortOrder: 0,
				Rounds: [
					{ ID: 3001, Name: 'Quarterfinals', SortOrder: 0 },
				],
			},
		] as MeleeEventParsed['Phases'];
		const workflows = createMeleeSyncWorkflows();

		const first = await workflows.syncEventStructure(ctx, eventId, meleeEventData, upstream(livePhases));
		const afterFirst = await readStructure(eventId);
		expect(first.warnings).toHaveLength(1);
		expect(afterFirst.phases.map(phase => [
			phase.id === mixedPhase.id
				? 'kept'
				: phase.name,
			phase.externalSource,
		])).toEqual([
			['kept', 'manual'],
			['Top 8', 'melee'],
		]);
		expect(afterFirst.rounds.map(round => [round.name, round.externalSource])).toEqual([
			['Side Event', 'manual'],
			['Quarterfinals', 'melee'],
		]);
		expect(afterFirst.matches.map(match => match.id)).toEqual([manualMatch.id]);

		publishMessageStrict.mockClear();
		const second = await workflows.syncEventStructure(ctx, eventId, meleeEventData, upstream(livePhases));
		expect(second.warnings).toBeUndefined();
		expect(await readStructure(eventId)).toEqual(afterFirst);
		expect(publishMessageStrict).not.toHaveBeenCalled();
	});
});

describe('the Melee data reset keeps manual descendants', () => {
	it('keeps imported structure holding manual Rounds or Matches as manual, and removes the rest', async () => {
		const eventId = await createEvent();
		const manualPhase = await insertPhase(eventId, 'Showcase', null);
		const importedPhase = await insertPhase(eventId, 'Swiss', '500');
		const manualRound = await insertRound(eventId, importedPhase.id, 'Bonus Round', null);
		const manualMatchInManualRound = await insertMatch(eventId, manualRound.id, null);
		const importedRound = await insertRound(eventId, importedPhase.id, 'Round 1', '5001');
		await insertMatch(eventId, importedRound.id, '50011');
		const manualMatchInImportedRound = await insertMatch(eventId, importedRound.id, null);
		const importedOnlyPhase = await insertPhase(eventId, 'Top 8', '600');
		await insertRound(eventId, importedOnlyPhase.id, 'Quarterfinals', '6001');
		// An imported Round an operator moved under a manual Phase, holding nothing manual.
		const movedImportedRound = await insertRound(eventId, manualPhase.id, 'Round 2', '5002');
		await insertMatch(eventId, movedImportedRound.id, '50021');

		const reset = await eventService().updateMeleeConfig(eventId, {
			meleeEnabled: false,
			meleeEventId: null,
			meleeClientId: null,
		});

		const after = await readStructure(eventId);
		expect(after.phases.map(phase => [phase.id, phase.externalSource, phase.externalId])).toEqual([
			[manualPhase.id, 'manual', null],
			[importedPhase.id, 'manual', null],
		]);
		expect(after.rounds.map(round => [
			round.id,
			round.phaseId,
			round.externalSource,
			round.externalId,
		])).toEqual([
			[
				manualRound.id,
				importedPhase.id,
				'manual',
				null,
			],
			[
				importedRound.id,
				importedPhase.id,
				'manual',
				null,
			],
		]);
		expect(after.matches.map(match => [match.id, match.roundId, match.externalSource])).toEqual([
			[manualMatchInManualRound.id, manualRound.id, 'manual'],
			[manualMatchInImportedRound.id, importedRound.id, 'manual'],
		]);
		expect(reset?.keptStructure).toEqual({
			keptPhases: [
				{ id: importedPhase.id, name: 'Swiss' },
			],
			keptRounds: [
				{
					id: importedRound.id,
					name: 'Round 1',
					phaseId: importedPhase.id,
					phaseName: 'Swiss',
				},
			],
		});
	});
});
