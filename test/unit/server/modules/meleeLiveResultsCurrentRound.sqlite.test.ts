import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/*
 * The Current Round is read from stored Rounds and Matches: Melee-managed Rounds
 * only, in Round order across Phases, and only Matches stored from Melee are pairings.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { loadCurrentRound } = await import('~~/server/modules/melee-sync/liveResults/currentRound');

afterAll(async () => await harness.close());

type RoundKey = 'manualRound' | 'round3' | 'round4' | 'quarterfinals';
/** A stored Match: reported, unreported, a bye, or entered by hand rather than from Melee. */
type StoredMatch = 'reported' | 'unreported' | 'bye' | 'manual';

/**
 * A Swiss Phase (a hand-made Round, Round 3, Round 4) then a Top Cut Phase
 * (Quarterfinals), holding `matches`. Top Cut is inserted first so Round order
 * is the Phase sort order's, not insertion's.
 */
async function seedEvent(options: {
	matches: Partial<Record<RoundKey, StoredMatch[]>>;
	round4ControlMode?: 'default' | 'manual_override';
}) {
	const [event] = await db.insert(schema.events).values({
		name: 'Melee Championship',
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
		meleeEnabled: true,
		meleeEventId: 'melee-1',
	}).returning({ id: schema.events.id });
	const eventId = event!.id;
	const [topCut, swiss] = await db.insert(schema.phases).values([
		{
			eventId,
			name: 'Top Cut',
			sortOrder: 1,
			externalId: '41',
			externalSource: 'melee',
		},
		{
			eventId,
			name: 'Swiss',
			sortOrder: 0,
			externalId: '40',
			externalSource: 'melee',
		},
	]).returning();
	const [quarterfinals, manualRound, round3, round4] = await db.insert(schema.rounds).values([
		{
			eventId,
			phaseId: topCut!.id,
			name: 'Quarterfinals',
			roundNumber: 1,
			externalId: '4001',
			externalSource: 'melee',
		},
		{
			eventId,
			phaseId: swiss!.id,
			name: 'Side Event',
			roundNumber: 0,
			externalSource: 'manual',
		},
		{
			eventId,
			phaseId: swiss!.id,
			name: 'Round 3',
			roundNumber: 3,
			externalId: '3003',
			externalSource: 'melee',
		},
		{
			eventId,
			phaseId: swiss!.id,
			name: 'Round 4',
			roundNumber: 4,
			externalId: '3004',
			externalSource: 'melee',
			controlMode: options.round4ControlMode ?? 'default',
		},
	]).returning();
	const roundIds: Record<RoundKey, number> = {
		manualRound: manualRound!.id,
		round3: round3!.id,
		round4: round4!.id,
		quarterfinals: quarterfinals!.id,
	};
	const rows = Object.entries(options.matches).flatMap(([key, states]) => states.map((state, index) => ({
		eventId,
		roundId: roundIds[key as RoundKey],
		externalId: state === 'manual'
			? null
			: `${key}-${index}`,
		externalSource: state === 'manual'
			? 'manual' as const
			: 'melee' as const,
		sortOrder: index,
		hasResult: state === 'reported',
		player1GameWins: state === 'reported'
			? 2
			: null,
		player2GameWins: state === 'reported'
			? 0
			: null,
		gameDraws: state === 'reported'
			? 0
			: null,
		isBye: state === 'bye',
	})));
	if (rows.length > 0)
		await db.insert(schema.matches).values(rows);
	return { eventId, roundIds };
}

describe('loadCurrentRound', () => {
	it.each([
		{
			name: 'nothing paired: probe the first Melee-managed Round, skipping a hand-made one',
			matches: {},
			current: null,
			target: { kind: 'probe', round: 'round3' },
		},
		{
			name: 'Round 4 has an unreported Match: poll its results',
			matches: {
				round3: ['reported', 'reported'],
				round4: ['reported', 'unreported'],
			},
			current: 'round4',
			target: { kind: 'results', round: 'round4' },
		},
		{
			name: 'Round 4 reported or byes: probe Quarterfinals in the next Phase',
			matches: {
				round3: ['reported'],
				round4: ['reported', 'bye'],
			},
			current: 'round4',
			target: { kind: 'probe', round: 'quarterfinals' },
		},
		{
			name: 'Quarterfinals paired while Round 4 still has an unreported Match: poll Quarterfinals',
			matches: {
				round4: ['reported', 'unreported'],
				quarterfinals: ['unreported'],
			},
			current: 'quarterfinals',
			target: { kind: 'results', round: 'quarterfinals' },
		},
		{
			name: 'Matches entered by hand are not pairings',
			matches: {
				round4: ['reported'],
				quarterfinals: ['manual'],
			},
			current: 'round4',
			target: { kind: 'probe', round: 'quarterfinals' },
		},
		{
			name: 'Quarterfinals complete, nothing next: idle',
			matches: {
				round4: ['reported'],
				quarterfinals: ['reported'],
			},
			current: 'quarterfinals',
			target: { kind: 'idle' },
		},
	] satisfies {
		name: string;
		matches: Partial<Record<RoundKey, StoredMatch[]>>;
		current: RoundKey | null;
		target: { kind: 'results' | 'probe'; round: RoundKey } | { kind: 'idle' };
	}[])('$name', async ({ matches, current, target }) => {
		const { eventId, roundIds } = await seedEvent({ matches });

		const resolved = await loadCurrentRound(eventId);

		expect(resolved.current?.id ?? null).toBe(current && roundIds[current]);
		expect(resolved.target.kind === 'idle'
			? { kind: 'idle' }
			: { kind: resolved.target.kind, roundId: resolved.target.round.id })
			.toEqual(target.kind === 'idle'
				? target
				: { kind: target.kind, roundId: roundIds[target.round] });
	});

	it('skips a manual-override Round: its Matches are not pairings and it is never probed', async () => {
		const { eventId, roundIds } = await seedEvent({
			matches: {
				round3: ['reported'],
				round4: ['unreported'],
			},
			round4ControlMode: 'manual_override',
		});

		const resolved = await loadCurrentRound(eventId);

		expect(resolved.current?.id).toBe(roundIds.round3);
		expect(resolved.target).toMatchObject({
			kind: 'probe',
			round: { id: roundIds.quarterfinals },
		});
	});
});
