import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { updateFeatureMatchSchema } from '~~/server/schemas/api/featureMatch';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Phase, Round, Talent, Match, Feature Match Slot and Player List writes over real SQL:
// a committed one is stored and announced under the writer's origin, a refused one
// stores and announces nothing. Only Ably is faked; rows owned elsewhere are named below.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));

const { phaseWriteModule } = await import('~~/server/modules/phase-write');
const { roundWriteModule } = await import('~~/server/modules/round-write');
const { talentWriteModule } = await import('~~/server/modules/talent-write');
const { matchWriteModule } = await import('~~/server/modules/match-write');
const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { playerListWriteModule } = await import('~~/server/modules/player-list-write');

beforeEach(() => ably.reset());
afterAll(async () => await harness.close());

const ORIGIN = 'origin-1';
/** A write naming no photo never asks the library. */
function noLibrary(): never {
	throw new Error('The library was asked about a write naming no photo');
}

const read = {
	phase: (id: number) => db.query.phases.findFirst({
		where: eq(schema.phases.id, id),
	}),
	round: (id: number) => db.query.rounds.findFirst({
		where: eq(schema.rounds.id, id),
	}),
	talent: (id: number) => db.query.eventTalents.findFirst({
		where: eq(schema.eventTalents.id, id),
	}),
	match: (id: number) => db.query.matches.findFirst({
		where: eq(schema.matches.id, id),
	}),
	slot: (id: number) => db.query.featureMatches.findFirst({
		where: eq(schema.featureMatches.id, id),
	}),
	playerList: (id: number) => db.query.playerLists.findFirst({
		where: eq(schema.playerLists.id, id),
	}),
};
type Kind = keyof typeof read;

/** One of each kind in an Event, by id: its Player List holds the first two of its four Players. */
type Staged = Record<Kind | 'eventId', number> & { players: number[] };

async function stage(): Promise<Staged> {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Swiss' }).returning({ id: schema.phases.id });
	const [round] = await db.insert(schema.rounds).values({
		eventId,
		phaseId: phase!.id,
		name: 'Round 1',
		roundNumber: 1,
	}).returning({ id: schema.rounds.id });
	const players = await db.insert(schema.players)
		.values(['Ada', 'Bo', 'Cy', 'Di'].map(name => ({ eventId, name })))
		.returning({ id: schema.players.id });
	const [match] = await db.insert(schema.matches).values({
		eventId,
		roundId: round!.id,
		tableNumber: 1,
		player1Id: players[0]!.id,
		player2Id: players[1]!.id,
	}).returning({ id: schema.matches.id });
	const [talent] = await db.insert(schema.eventTalents).values({ eventId, name: 'Host' }).returning({ id: schema.eventTalents.id });
	const [slot] = await db.insert(schema.featureMatches).values({ eventId, tableNumber: 1 }).returning({ id: schema.featureMatches.id });
	const [playerList] = await db.insert(schema.playerLists).values({ eventId, name: 'Top 8' }).returning({ id: schema.playerLists.id });
	await db.insert(schema.playerListMembers).values([
		{ listId: playerList!.id, playerId: players[0]!.id, sortOrder: 0 },
		{ listId: playerList!.id, playerId: players[1]!.id, sortOrder: 1 },
	]);
	return {
		eventId,
		phase: phase!.id,
		round: round!.id,
		talent: talent!.id,
		match: match!.id,
		slot: slot!.id,
		playerList: playerList!.id,
		players: players.map(player => player.id),
	};
}

async function membersOf(listId: number) {
	const members = await db.select().from(schema.playerListMembers).where(eq(schema.playerListMembers.listId, listId)).orderBy(asc(schema.playerListMembers.sortOrder));
	return members.map(member => member.playerId);
}

/** Every row an Event holds of the kinds written here. */
async function everythingIn({ eventId, playerList }: Staged) {
	return {
		phases: await db.select().from(schema.phases).where(eq(schema.phases.eventId, eventId)),
		rounds: await db.select().from(schema.rounds).where(eq(schema.rounds.eventId, eventId)),
		talents: await db.select().from(schema.eventTalents).where(eq(schema.eventTalents.eventId, eventId)),
		matches: await db.select().from(schema.matches).where(eq(schema.matches.eventId, eventId)),
		slots: await db.select().from(schema.featureMatches).where(eq(schema.featureMatches.eventId, eventId)),
		playerLists: await db.select().from(schema.playerLists).where(eq(schema.playerLists.eventId, eventId)),
		members: await membersOf(playerList),
	};
}

/** What the Event's channel was sent, as `[type, payload]`. */
function announced(eventId: number) {
	return ably.on(eventRealtimeChannel(eventId)).map(({ type, payload }) => [type, payload] as const);
}

type Write = (held: Staged, other: Staged) => Promise<unknown>;

/** A 404 that leaves both Events as they were and announces nothing. */
async function expectRefused(write: Write) {
	const [held, other] = [await stage(), await stage()];
	const before = [await everythingIn(held), await everythingIn(other)];

	await expect(write(held, other)).rejects.toMatchObject({ statusCode: 404 });

	expect([await everythingIn(held), await everythingIn(other)]).toEqual(before);
	expect(ably.published).toEqual([]);
}

describe('a committed write', () => {
	it.each<{ write: string; kind: Kind; run: Write; stores: object | null; announces: string }>([
		{
			write: 'creating a Phase',
			kind: 'phase',
			run: ({ eventId }) => phaseWriteModule().create({
				eventId,
				input: { name: 'Top Cut' },
				originConnectionId: ORIGIN,
			}),
			stores: { name: 'Top Cut' },
			announces: 'phase:created',
		},
		{
			write: 'updating a Phase',
			kind: 'phase',
			run: ({ eventId, phase }) => phaseWriteModule().update({
				eventId,
				phaseId: phase,
				input: { name: 'Day 1' },
				originConnectionId: ORIGIN,
			}),
			stores: { name: 'Day 1' },
			announces: 'phase:updated',
		},
		{
			write: 'removing a Phase',
			kind: 'phase',
			run: ({ eventId, phase }) => phaseWriteModule().remove({ eventId, phaseId: phase, originConnectionId: ORIGIN }),
			stores: null,
			announces: 'phase:deleted',
		},
		{
			write: 'creating a Round',
			kind: 'round',
			run: ({ eventId, phase }) => roundWriteModule().create({
				eventId,
				input: { phaseId: phase, name: 'Round 2', roundNumber: 2 },
				originConnectionId: ORIGIN,
			}),
			stores: { name: 'Round 2', roundNumber: 2 },
			announces: 'round:created',
		},
		{
			write: 'updating a Round',
			kind: 'round',
			run: ({ eventId, round }) => roundWriteModule().update({
				eventId,
				roundId: round,
				input: { name: 'Final' },
				originConnectionId: ORIGIN,
			}),
			stores: { name: 'Final' },
			announces: 'round:updated',
		},
		{
			write: 'removing a Round',
			kind: 'round',
			run: ({ eventId, round }) => roundWriteModule().remove({ eventId, roundId: round, originConnectionId: ORIGIN }),
			stores: null,
			announces: 'round:deleted',
		},
		{
			write: 'creating a Talent',
			kind: 'talent',
			run: ({ eventId }) => talentWriteModule().createTalent({
				eventId,
				input: { name: 'Caster' },
				originConnectionId: ORIGIN,
				graphicsAssets: noLibrary,
			}),
			stores: { name: 'Caster' },
			announces: 'talent:created',
		},
		{
			write: 'updating a Talent',
			kind: 'talent',
			run: ({ eventId, talent }) => talentWriteModule().updateTalent({
				eventId,
				talentId: talent,
				input: { name: 'Analyst' },
				originConnectionId: ORIGIN,
				graphicsAssets: noLibrary,
			}),
			stores: { name: 'Analyst' },
			announces: 'talent:updated',
		},
		{
			write: 'deleting a Talent',
			kind: 'talent',
			run: ({ eventId, talent }) => talentWriteModule().deleteTalent({ eventId, talentId: talent, originConnectionId: ORIGIN }),
			stores: null,
			announces: 'talent:deleted',
		},
		{
			write: 'creating a Match',
			kind: 'match',
			run: ({ eventId, round, players }) => matchWriteModule().create({
				eventId,
				input: {
					roundId: round,
					player1Id: players[2],
					player2Id: players[3],
					tableNumber: 2,
				},
				originConnectionId: ORIGIN,
			}),
			stores: { tableNumber: 2 },
			announces: 'match:created',
		},
		{
			write: 'updating a Match',
			kind: 'match',
			run: ({ eventId, match }) => matchWriteModule().update({
				eventId,
				matchId: match,
				input: { tableNumber: 7 },
				originConnectionId: ORIGIN,
			}),
			stores: { tableNumber: 7 },
			announces: 'match:updated',
		},
		{
			write: 'creating a Feature Match Slot',
			kind: 'slot',
			run: ({ eventId }) => featureMatchSlotWriteModule().create({
				eventId,
				input: { tableNumber: 2 },
				originConnectionId: ORIGIN,
			}),
			stores: { tableNumber: 2 },
			announces: 'featureMatch:created',
		},
		{
			write: 'editing a Feature Match Slot',
			kind: 'slot',
			run: ({ eventId, slot }) => featureMatchSlotWriteModule().updateSetup({
				eventId,
				slotId: slot,
				input: { tableNumber: 7 },
				originConnectionId: ORIGIN,
			}),
			stores: { tableNumber: 7 },
			announces: 'featureMatch:updated',
		},
		{
			write: 'creating a Player List',
			kind: 'playerList',
			run: ({ eventId }) => playerListWriteModule().createPlayerList({
				eventId,
				input: { name: 'Day 2' },
				originConnectionId: ORIGIN,
			}),
			stores: { name: 'Day 2' },
			announces: 'playerList:created',
		},
		{
			write: 'updating a Player List',
			kind: 'playerList',
			run: ({ eventId, playerList }) => playerListWriteModule().updatePlayerList({
				eventId,
				listId: playerList,
				input: { name: 'Undefeated' },
				originConnectionId: ORIGIN,
			}),
			stores: { name: 'Undefeated' },
			announces: 'playerList:updated',
		},
		{
			write: 'deleting a Player List',
			kind: 'playerList',
			run: ({ eventId, playerList }) => playerListWriteModule().deletePlayerList({ eventId, listId: playerList, originConnectionId: ORIGIN }),
			stores: null,
			announces: 'playerList:deleted',
		},
	])('is stored, and announced as $announces under the writer\'s origin, after $write', async ({ kind, run, stores, announces }) => {
		const held = await stage();

		const answer = await run(held, held);

		// A create or an update answers the entity it wrote; a delete answers none.
		const id = (answer as { id?: number } | undefined)?.id ?? held[kind];
		const row = await read[kind](id);
		const carried = stores
			? JSON.parse(JSON.stringify(answer))
			: id;
		if (stores)
			expect(row).toMatchObject({ eventId: held.eventId, ...stores });
		else
			expect(row).toBeUndefined();
		// The message carries what the write answered, so both readers see one shape.
		expect(announced(held.eventId).filter(([type]) => type === announces).map(([, { originConnectionId, ...payload }]) => ({
			originConnectionId,
			carried: Object.values(payload),
		}))).toEqual([
			{
				originConnectionId: ORIGIN,
				carried: [carried],
			},
		]);
	});

	// A setup edit writes only what it names: a side it leaves out keeps its player.
	it('leaves each side\'s player data as stored on a Feature Match Slot edit naming only the table', async () => {
		const { eventId } = await stage();
		const sides = {
			player1Data: { name: 'Alice' },
			player2Data: { name: 'Bob' },
		};
		const [slot] = await db.insert(schema.featureMatches).values({ eventId, tableNumber: 2, ...sides }).returning({ id: schema.featureMatches.id });

		const answered = await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId: slot!.id,
			// As the setup form sends it: the table number is text.
			input: updateFeatureMatchSchema.parse({ tableNumber: '12' }),
		});

		expect(answered).toMatchObject({ id: slot!.id, tableNumber: 12, ...sides });
		expect(await read.slot(slot!.id)).toMatchObject({ tableNumber: 12, ...sides });
	});

	// Which Slots a reorder stores and names is `featureMatch.sqlite.test.ts`'s; a deleted Match
	// and a deleted Slot are `featureMatchAssignment.sqlite` and `featureMatchSlotScreenRelease.sqlite`'s.
	it('announces a Feature Match Slot reorder under the writer\'s origin', async () => {
		const { eventId, slot } = await stage();
		await db.insert(schema.featureMatches).values({ eventId, tableNumber: 2, sortOrder: 1 });

		await featureMatchSlotWriteModule().reorder({
			eventId,
			slotId: slot,
			direction: 'down',
			originConnectionId: ORIGIN,
		});

		expect(announced(eventId)).toEqual([
			[
				'featureMatch:reordered',
				expect.objectContaining({ originConnectionId: ORIGIN }),
			],
		]);
	});

	// ADR-0045: the saving client applied only the Slot, so it must hear of the Player too.
	it('announces the Player a Slot setup edit writes first and with no origin, then the Slot under the writer\'s', async () => {
		const { eventId, slot, players } = await stage();

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId: slot,
			input: {
				player1Id: players[0]!,
				player1Data: { name: 'Ada', pronouns: 'she/her' },
			},
			originConnectionId: ORIGIN,
		});

		// Seating the Player also opens a Session, which `featureMatchSessionOpeners.sqlite.test.ts` holds.
		const eventData = announced(eventId).filter(([type]) => !type.startsWith('featureMatchSession:'));
		expect(eventData.map(([type, payload]) => [type, payload.originConnectionId ?? null])).toEqual([
			['player:updated', null],
			['featureMatch:updated', ORIGIN],
		]);
	});
});

// An update to another Event's Round is `roundTiming.sqlite.test.ts`'s.
describe('a write to an entity the Event does not hold', () => {
	it.each<{ write: string; run: Write }>([
		{
			write: 'update a Phase',
			run: ({ eventId }, other) => phaseWriteModule().update({
				eventId,
				phaseId: other.phase,
				input: { name: 'Taken' },
				originConnectionId: ORIGIN,
			}),
		},
		{
			write: 'remove a Phase',
			run: ({ eventId }, other) => phaseWriteModule().remove({ eventId, phaseId: other.phase, originConnectionId: ORIGIN }),
		},
		{
			write: 'remove a Round',
			run: ({ eventId }, other) => roundWriteModule().remove({ eventId, roundId: other.round, originConnectionId: ORIGIN }),
		},
		{
			write: 'update a Talent',
			run: ({ eventId }, other) => talentWriteModule().updateTalent({
				eventId,
				talentId: other.talent,
				input: { name: 'Taken' },
				originConnectionId: ORIGIN,
				graphicsAssets: noLibrary,
			}),
		},
		{
			write: 'delete a Talent',
			run: ({ eventId }, other) => talentWriteModule().deleteTalent({ eventId, talentId: other.talent, originConnectionId: ORIGIN }),
		},
		{
			write: 'update a Match',
			run: ({ eventId }, other) => matchWriteModule().update({
				eventId,
				matchId: other.match,
				input: { tableNumber: 7 },
				originConnectionId: ORIGIN,
			}),
		},
		{
			write: 'remove a Match',
			run: ({ eventId }, other) => matchWriteModule().remove({ eventId, matchId: other.match, originConnectionId: ORIGIN }),
		},
		{
			write: 'edit a Feature Match Slot',
			run: ({ eventId }, other) => featureMatchSlotWriteModule().updateSetup({
				eventId,
				slotId: other.slot,
				input: { tableNumber: 7 },
				originConnectionId: ORIGIN,
			}),
		},
		{
			write: 'remove a Feature Match Slot',
			run: ({ eventId }, other) => featureMatchSlotWriteModule().remove({ eventId, slotId: other.slot, originConnectionId: ORIGIN }),
		},
		{
			write: 'update a Player List',
			run: ({ eventId }, other) => playerListWriteModule().updatePlayerList({
				eventId,
				listId: other.playerList,
				input: { name: 'Taken' },
				originConnectionId: ORIGIN,
			}),
		},
		{
			write: 'delete a Player List',
			run: ({ eventId }, other) => playerListWriteModule().deletePlayerList({ eventId, listId: other.playerList, originConnectionId: ORIGIN }),
		},
		{
			write: 'remove a Player who is not on its Player List',
			run: ({ eventId, playerList, players }) => playerListWriteModule().removePlayerListMember({
				eventId,
				listId: playerList,
				playerId: players[2]!,
				originConnectionId: ORIGIN,
			}),
		},
	])('refuses to $write with a 404, storing and announcing nothing', async ({ run }) => {
		await expectRefused(run);
	});
});

describe('a write naming a reference outside the Event', () => {
	it.each<{ write: string; naming: string; run: Write }>([
		{
			write: 'create a Round',
			naming: 'Phase',
			run: ({ eventId }, other) => roundWriteModule().create({
				eventId,
				input: { phaseId: other.phase, name: 'Round 2', roundNumber: 2 },
			}),
		},
		{
			write: 'update a Round',
			naming: 'Phase',
			run: ({ eventId, round }, other) => roundWriteModule().update({
				eventId,
				roundId: round,
				input: { phaseId: other.phase },
			}),
		},
		{
			write: 'create a Match',
			naming: 'Round',
			run: ({ eventId }, other) => matchWriteModule().create({
				eventId,
				input: { roundId: other.round },
			}),
		},
		{
			write: 'update a Match',
			naming: 'Player',
			run: ({ eventId, match }, other) => matchWriteModule().update({
				eventId,
				matchId: match,
				input: { player1Id: other.players[0] },
			}),
		},
		{
			write: 'create a Feature Match Slot',
			naming: 'Match',
			run: ({ eventId }, other) => featureMatchSlotWriteModule().create({
				eventId,
				input: { matchId: other.match },
			}),
		},
		{
			write: 'edit a Feature Match Slot',
			naming: 'Player',
			run: ({ eventId, slot }, other) => featureMatchSlotWriteModule().updateSetup({
				eventId,
				slotId: slot,
				input: { player1Id: other.players[0] },
			}),
		},
	])('refuses to $write naming another Event\'s $naming, storing and announcing nothing', async ({ run }) => {
		await expectRefused(run);
	});
});

// The count is read after the change, so the answer and the message agree with what is stored.
describe('a Player List membership change', () => {
	it.each<{
		change: string;
		/** The staged Players named, by position. */
		players: number[];
		run: (staged: Staged, playerIds: number[]) => Promise<{ memberCount: number }>;
		action: string;
		/** The staged Players the list then holds, in its order. */
		members: number[];
	}>([
		{
			change: 'adding members',
			players: [2, 3],
			run: ({ eventId, playerList }, playerIds) => playerListWriteModule().addPlayerListMembers({
				eventId,
				listId: playerList,
				playerIds,
				originConnectionId: ORIGIN,
			}),
			action: 'added',
			members: [0, 1, 2, 3],
		},
		{
			change: 'removing one member',
			players: [0],
			run: ({ eventId, playerList }, [playerId]) => playerListWriteModule().removePlayerListMember({
				eventId,
				listId: playerList,
				playerId: playerId!,
				originConnectionId: ORIGIN,
			}),
			action: 'removed',
			members: [1],
		},
		{
			change: 'removing members in a batch',
			players: [0, 1],
			run: ({ eventId, playerList }, playerIds) => playerListWriteModule().batchRemovePlayerListMembers({
				eventId,
				listId: playerList,
				playerIds,
				originConnectionId: ORIGIN,
			}),
			action: 'removed',
			members: [],
		},
		{
			change: 'reordering members',
			players: [1, 0],
			run: ({ eventId, playerList }, playerIds) => playerListWriteModule().reorderPlayerListMembers({
				eventId,
				listId: playerList,
				playerIds,
				originConnectionId: ORIGIN,
			}),
			action: 'reordered',
			members: [1, 0],
		},
	])('answers and announces the count the list holds after $change', async ({ players, run, action, members }) => {
		const staged = await stage();
		const playerIds = players.map(position => staged.players[position]!);

		const answer = await run(staged, playerIds);

		expect(await membersOf(staged.playerList)).toEqual(members.map(position => staged.players[position]));
		expect(answer).toMatchObject({ memberCount: members.length });
		expect(announced(staged.eventId)).toEqual([
			[
				'playerList:membersChanged',
				{
					listId: staged.playerList,
					playerIds,
					action,
					memberCount: members.length,
					originConnectionId: ORIGIN,
				},
			],
		]);
	});
});
