import type { MiniflareD1Harness } from '~~/test/helpers/miniflare-d1';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createMiniflareD1Harness } from '~~/test/helpers/miniflare-d1';

// A Melee Round snapshot replaces the Round's Matches and Round Standings as
// one authoritative write touching only changed rows, on a real D1 binding so a
// thousand-row snapshot is held to D1's bound-parameter limit.

const harness: MiniflareD1Harness = await createMiniflareD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { meleeRoundSnapshotService } = await import('~~/server/services/meleeRoundSnapshot');

afterEach(() => vi.useRealTimers());
afterAll(async () => await harness.dispose());

async function stageRound(playerCount = 2) {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Swiss' }).returning();
	const [round] = await db.insert(schema.rounds)
		.values({
			eventId,
			phaseId: phase!.id,
			name: 'Round 1',
			roundNumber: 1,
			externalId: 'round-1',
			externalSource: 'melee',
		})
		.returning();
	const playerIds: number[] = [];
	for (let start = 0; start < playerCount; start += 20) {
		const rows = await db.insert(schema.players)
			.values(Array.from({
				length: Math.min(20, playerCount - start),
			}, (_, index) => ({ eventId, name: `Player ${start + index}` })))
			.returning({ id: schema.players.id });
		playerIds.push(...rows.map(row => row.id));
	}
	return { eventId, roundId: round!.id, playerIds };
}

function match(eventId: number, roundId: number, externalId: string, name = externalId) {
	return {
		eventId,
		roundId,
		externalId,
		externalSource: 'melee' as const,
		player1Data: { name },
		sortOrder: 0,
	};
}

function standing(playerId: number, position: number) {
	return {
		playerId,
		wins: 1,
		losses: 0,
		draws: 0,
		position,
		points: 3,
	};
}

async function stored(eventId: number) {
	const matches = await db.select().from(schema.matches).where(eq(schema.matches.eventId, eventId));
	const standings = await db.select().from(schema.playerRoundStandings).where(eq(schema.playerRoundStandings.eventId, eventId));
	return {
		matches: matches.map(row => row.externalId).toSorted(),
		standings: standings.map(row => row.playerId).toSorted(),
	};
}

async function updatedAtByExternalId(eventId: number) {
	const rows = await db.select().from(schema.matches).where(eq(schema.matches.eventId, eventId));
	return Object.fromEntries(rows.map(row => [
		row.externalId ?? `manual-${row.id}`,
		row.updatedAt.getTime(),
	]));
}

describe('meleeRoundSnapshotService.replace', () => {
	it('creates, updates and sweeps stale rows, counting each, and stamps the Round synced', async () => {
		const { eventId, roundId, playerIds: [a, b] } = await stageRound();
		const service = meleeRoundSnapshotService();

		expect(await service.replace({
			eventId,
			roundId,
			matches: [
				match(eventId, roundId, 'm-1'),
				match(eventId, roundId, 'm-2'),
			],
			standings: [
				standing(a!, 1),
				standing(b!, 2),
			],
		}))
			.toMatchObject({ created: 2, updated: 0, staleDeleted: 0 });
		const second = await service.replace({
			eventId,
			roundId,
			matches: [
				match(eventId, roundId, 'm-2', 'Updated'),
			],
			standings: [
				standing(b!, 1),
			],
		});

		expect(second).toMatchObject({ created: 0, updated: 1, staleDeleted: 1 });
		expect(second.matches[0]!.player1Data).toEqual({ name: 'Updated' });
		expect(await stored(eventId)).toEqual({
			matches: ['m-2'],
			standings: [b],
		});
		expect((await db.query.rounds.findFirst({
			where: eq(schema.rounds.id, roundId),
		}))?.lastSyncedAt).toBeInstanceOf(Date);
	});

	it.each([
		[
			'an identical snapshot',
			(m: ReturnType<typeof match>) => m,
			[] as string[],
			false,
		],
		[
			'one Match Result reported',
			(m: ReturnType<typeof match>) => m.externalId === 'm-2'
				? {
						...m,
						hasResult: true,
						player1GameWins: 2,
						player2GameWins: 1,
						gameDraws: 0,
					}
				: m,
			['m-2'],
			false,
		],
		[
			'one table re-seated',
			(m: ReturnType<typeof match>) => m.externalId === 'm-1'
				? { ...m, tableNumber: 9 }
				: m,
			[] as string[],
			true,
		],
	] as const)('rewrites only the Matches that changed on %s', async (_case, change, changedIds, pairingsChanged) => {
		vi.useFakeTimers({
			toFake: ['Date'],
		});
		vi.setSystemTime(1_000_000);
		const { eventId, roundId, playerIds: [a, b] } = await stageRound();
		const service = meleeRoundSnapshotService();
		const snapshot = [
			match(eventId, roundId, 'm-1'),
			match(eventId, roundId, 'm-2'),
		];
		const first = await service.replace({
			eventId,
			roundId,
			matches: snapshot,
			standings: [
				standing(a!, 1),
				standing(b!, 2),
			],
		});
		const ids = Object.fromEntries(first.matches.map(row => [row.externalId, row.id]));
		vi.setSystemTime(2_000_000);

		const second = await service.replace({
			eventId,
			roundId,
			matches: snapshot.map(change),
			standings: [
				standing(b!, 2),
				standing(a!, 1),
			],
		});

		expect(second).toMatchObject({
			created: 0,
			updated: changedIds.length + (pairingsChanged
				? 1
				: 0),
			staleDeleted: 0,
			resultChangedMatchIds: changedIds.map(externalId => ids[externalId]),
			pairingsChanged,
			standingsChanged: false,
		});
		expect(second.matches.map(row => row.externalId).toSorted()).toEqual(['m-1', 'm-2']);
		expect(await updatedAtByExternalId(eventId)).toEqual({
			'm-1': pairingsChanged
				? 2_000_000
				: 1_000_000,
			'm-2': changedIds.includes('m-2')
				? 2_000_000
				: 1_000_000,
		});
	});

	it('reports a new snapshot as changed pairings and Round Standings', async () => {
		const { eventId, roundId, playerIds: [a] } = await stageRound();

		expect(await meleeRoundSnapshotService().replace({
			eventId,
			roundId,
			matches: [
				match(eventId, roundId, 'm-1'),
			],
			standings: [
				standing(a!, 1),
			],
		})).toMatchObject({ resultChangedMatchIds: [], pairingsChanged: true, standingsChanged: true });
	});

	it.each([
		[
			'null leaves them alone',
			null,
			false,
			1,
		],
		[
			'a changed set replaces them',
			2,
			true,
			2,
		],
	] as const)('round Standings: %s', async (_case, nextPosition, standingsChanged, keptPosition) => {
		const { eventId, roundId, playerIds: [a] } = await stageRound();
		const service = meleeRoundSnapshotService();
		await service.replace({
			eventId,
			roundId,
			matches: [],
			standings: [
				standing(a!, 1),
			],
		});

		const result = await service.replace({
			eventId,
			roundId,
			matches: [],
			standings: nextPosition == null
				? null
				: [
						standing(a!, nextPosition),
					],
		});

		expect(result.standingsChanged).toBe(standingsChanged);
		const rows = await db.select().from(schema.playerRoundStandings).where(eq(schema.playerRoundStandings.roundId, roundId));
		expect(rows.map(row => [row.playerId, row.position])).toEqual([
			[a, keptPosition],
		]);
	});

	it('sweeps stale Melee Matches but keeps manual Matches in the Round', async () => {
		const { eventId, roundId } = await stageRound();
		await db.insert(schema.matches).values({
			eventId,
			roundId,
			player1Data: { name: 'Manual' },
		});
		await meleeRoundSnapshotService().replace({
			eventId,
			roundId,
			matches: [
				match(eventId, roundId, 'm-1'),
			],
			standings: [],
		});

		const result = await meleeRoundSnapshotService().replace({
			eventId,
			roundId,
			matches: [],
			standings: [],
		});

		expect(result).toMatchObject({ staleDeleted: 1, pairingsChanged: true });
		const rows = await db.select().from(schema.matches).where(eq(schema.matches.roundId, roundId));
		expect(rows.map(row => row.player1Data?.name)).toEqual(['Manual']);
	});

	it('clears the Round for an empty snapshot', async () => {
		const { eventId, roundId, playerIds: [a] } = await stageRound();
		await meleeRoundSnapshotService().replace({
			eventId,
			roundId,
			matches: [
				match(eventId, roundId, 'm-1'),
			],
			standings: [
				standing(a!, 1),
			],
		});

		expect(await meleeRoundSnapshotService().replace({
			eventId,
			roundId,
			matches: [],
			standings: [],
		}))
			.toEqual({
				matches: [],
				created: 0,
				updated: 0,
				staleDeleted: 1,
				resultChangedMatchIds: [],
				pairingsChanged: true,
				standingsChanged: true,
			});
		expect(await stored(eventId)).toEqual({ matches: [], standings: [] });
	});

	it('never matches or sweeps another Event\'s Match holding the same external id', async () => {
		const one = await stageRound();
		const two = await stageRound();
		await meleeRoundSnapshotService().replace({
			eventId: one.eventId,
			roundId: one.roundId,
			matches: [
				match(one.eventId, one.roundId, 'shared', 'One'),
			],
			standings: [],
		});

		expect(await meleeRoundSnapshotService().replace({
			eventId: two.eventId,
			roundId: two.roundId,
			matches: [
				match(two.eventId, two.roundId, 'shared', 'Two'),
			],
			standings: [],
		}))
			.toMatchObject({ created: 1, updated: 0 });
		await meleeRoundSnapshotService().replace({
			eventId: two.eventId,
			roundId: two.roundId,
			matches: [],
			standings: [],
		});

		const [kept] = await db.select().from(schema.matches).where(and(eq(schema.matches.eventId, one.eventId), eq(schema.matches.externalId, 'shared')));
		expect(kept?.player1Data).toEqual({ name: 'One' });
	});

	it('writes a thousand Matches and Round Standings in one snapshot', async () => {
		const { eventId, roundId, playerIds } = await stageRound(1000);

		const result = await meleeRoundSnapshotService().replace({
			eventId,
			roundId,
			matches: Array.from({ length: 1000 }, (_, index) => ({
				...match(eventId, roundId, `m-${index}`),
				sortOrder: index,
			})),
			standings: playerIds.map((playerId, index) => standing(playerId, index + 1)),
		});

		expect(result).toMatchObject({ created: 1000, updated: 0, staleDeleted: 0 });
		const after = await stored(eventId);
		expect(after.matches).toHaveLength(1000);
		expect(after.standings).toHaveLength(1000);
	});

	it.each([
		[
			'a Match identity twice',
			'Duplicate Melee Match external identity',
			(eventId: number, roundId: number) => ({
				matches: [
					match(eventId, roundId, 'dup'),
					match(eventId, roundId, 'dup'),
				],
				standings: [],
			}),
		],
		[
			'a Player\'s standing twice',
			'Duplicate Round standing player identity',
			(_eventId: number, _roundId: number, playerId: number) => ({
				matches: [],
				standings: [
					standing(playerId, 1),
					standing(playerId, 2),
				],
			}),
		],
		[
			'a Match without a Melee identity',
			'outside its authoritative scope',
			(eventId: number, roundId: number) => ({
				matches: [
					{ eventId, roundId },
				],
				standings: [],
			}),
		],
	] as const)('refuses a snapshot naming %s, writing nothing', async (_case, message, snapshot) => {
		const { eventId, roundId, playerIds: [a] } = await stageRound();

		await expect(meleeRoundSnapshotService().replace({
			eventId,
			roundId,
			...snapshot(eventId, roundId, a!),
		} as never)).rejects.toThrow(message);
		expect(await stored(eventId)).toEqual({ matches: [], standings: [] });
	});
});
