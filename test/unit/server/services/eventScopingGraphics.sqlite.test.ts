import type { StoredCardData } from '~~/server/schemas/kv/card';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Cross-Event scoping proofs for the Screen and live-state services (#468):
 * Screens, the Screen Card, Broadcast Graphics Live Sessions, Feature Match
 * Slots and Sessions, Graphic Binding Data, and the player → match reverse
 * sync.
 *
 * Beyond the usual wrong-Event point reads, two probes plant genuinely foreign
 * references that only a scoped read keeps quiet: an Event 1 Slot whose
 * `activeSessionId` and `player1Id` both point into Event 2 (nothing in the
 * schema forbids it), and an Event 2 Slot pairing an Event 1 player — the
 * shape that would put another show's data on air if any of these reads lost
 * its Event predicate.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('hub:db', () => ({ db }));
// The Card service binds the KV display cache at import time; nothing here
// should reach it, and the durable Screen row is the authority under test.
vi.doMock('hub:kv', () => ({ kv: { get: async () => null, set: async () => {}, del: async () => {} } }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));

const { screenService } = await import('~~/server/services/screen');
const { cardService } = await import('~~/server/services/card');
const { broadcastGraphicsStateService } = await import('~~/server/services/broadcastGraphicsState');
const { featureMatchService } = await import('~~/server/services/featureMatch');
const { featureMatchStateService } = await import('~~/server/services/featureMatchState');
const { graphicBindingDataService } = await import('~~/server/services/graphicBindingData');
const { playerFeatureMatchSyncService } = await import('~~/server/services/playerFeatureMatchSync');

function storedCard(id: string): StoredCardData {
	return {
		id,
		name: 'Ragavan, Nimble Pilferer',
		set: 'mh2',
		layout: 'normal',
		imageData: { front: null, back: null },
		orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
		displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
		savedAt: 1755000000000,
	};
}

interface SeededEvent {
	eventId: number;
	talentId: number;
	screenId: number;
	playerId: number;
	archetypeId: number;
	phaseId: number;
	roundId: number;
	matchId: number;
	slotId: number;
}

async function seedEvent(name: string, index: number): Promise<SeededEvent> {
	const [event] = await db.insert(schema.events)
		.values({ name, game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;

	const [talent] = await db.insert(schema.eventTalents)
		.values({ eventId, name: `${name} Talent` })
		.returning({ id: schema.eventTalents.id });
	const [screen] = await db.insert(schema.screens)
		.values({
			eventId,
			name: `${name} Screen`,
			slug: 'main-shared',
			assetCapabilitySeed: `seed-${index}`,
			assetCapabilityDigest: `digest-${index}`,
		})
		.returning({ id: schema.screens.id });
	const [player] = await db.insert(schema.players)
		.values({ eventId, name: `${name} Player` })
		.returning({ id: schema.players.id });
	const [archetype] = await db.insert(schema.archetypes)
		.values({ eventId, name: 'Shared Archetype' })
		.returning({ id: schema.archetypes.id });
	const [phase] = await db.insert(schema.phases)
		.values({ eventId, name: `${name} Swiss` })
		.returning({ id: schema.phases.id });
	const [round] = await db.insert(schema.rounds)
		.values({ eventId, phaseId: phase!.id, name: 'Round 1', roundNumber: 1 })
		.returning({ id: schema.rounds.id });
	const [match] = await db.insert(schema.matches)
		.values({ eventId, roundId: round!.id })
		.returning({ id: schema.matches.id });
	const [slot] = await db.insert(schema.featureMatches)
		.values({ eventId })
		.returning({ id: schema.featureMatches.id });

	return {
		eventId,
		talentId: talent!.id,
		screenId: screen!.id,
		playerId: player!.id,
		archetypeId: archetype!.id,
		phaseId: phase!.id,
		roundId: round!.id,
		matchId: match!.id,
		slotId: slot!.id,
	};
}

let one: SeededEvent;
let two: SeededEvent;
/** Event 1 Slot whose session pointer and player both point into Event 2. */
let crossWiredSlotId: number;
/** Event 2's active Feature Match Session. */
let sessionTwoId: number;
/** Event 2's active Broadcast Graphics Live Session. */
let liveSessionTwoId: number;

beforeAll(async () => {
	one = await seedEvent('Event One', 1);
	two = await seedEvent('Event Two', 2);

	const [sessionTwo] = await db.insert(schema.featureMatchSessions)
		.values({
			eventId: two.eventId,
			slotId: two.slotId,
			status: 'active',
			sourceSnapshot: { eventId: two.eventId, slotId: two.slotId } as never,
			currentState: {} as never,
			sequence: 1,
		})
		.returning({ id: schema.featureMatchSessions.id });
	sessionTwoId = sessionTwo!.id;

	const [crossWiredSlot] = await db.insert(schema.featureMatches)
		.values({ eventId: one.eventId, activeSessionId: sessionTwoId, player1Id: two.playerId })
		.returning({ id: schema.featureMatches.id });
	crossWiredSlotId = crossWiredSlot!.id;

	const [liveSessionTwo] = await db.insert(schema.broadcastGraphicsLiveSessions)
		.values({
			eventId: two.eventId,
			screenId: two.screenId,
			status: 'active',
			currentState: {} as never,
			sequence: 1,
		})
		.returning({ id: schema.broadcastGraphicsLiveSessions.id });
	liveSessionTwoId = liveSessionTwo!.id;

	await db.update(schema.screens)
		.set({ activeCard: storedCard('card-two'), activeCardVersion: 1 })
		.where(eq(schema.screens.id, two.screenId));
});

afterAll(async () => await harness.close());

describe('screenService event scoping', () => {
	it('point reads with the wrong Event find nothing', async () => {
		const service = screenService();
		expect(await service.findById(two.screenId, one.eventId)).toBeUndefined();
	});

	it('slug reads resolve inside the asking Event only', async () => {
		const service = screenService();
		expect((await service.findBySlug(one.eventId, 'main-shared'))?.id).toBe(one.screenId);
		expect((await service.findBySlug(two.eventId, 'main-shared'))?.id).toBe(two.screenId);

		await db.insert(schema.screens).values({
			eventId: two.eventId,
			name: 'Solo',
			slug: 'solo-two',
			assetCapabilitySeed: 'seed-solo',
			assetCapabilityDigest: 'digest-solo',
		});
		expect(await service.slugExists(one.eventId, 'solo-two')).toBe(false);
		expect(await service.slugExists(two.eventId, 'solo-two')).toBe(true);
	});

	it('lists only the asking Event', async () => {
		const service = screenService();
		expect((await service.findByEventId(one.eventId)).map(screen => screen.id)).toEqual([one.screenId]);
		expect((await service.findIdsByEventId(one.eventId)).map(row => row.id)).toEqual([one.screenId]);
	});

	it('versioned writes with the wrong Event touch nothing', async () => {
		const service = screenService();
		expect(await service.update(two.screenId, one.eventId, { name: 'Hijacked' }, 0)).toBeUndefined();
		expect((await service.findById(two.screenId, two.eventId))?.name).toBe('Event Two Screen');
	});
});

describe('cardService event scoping', () => {
	it('never surfaces another Event\'s Screen Card', async () => {
		const service = cardService();
		expect(await service.getScreenCard(two.eventId, two.screenId)).toMatchObject({ id: 'card-two' });
		expect(await service.getScreenCard(one.eventId, two.screenId)).toBeNull();
	});
});

describe('broadcastGraphicsStateService event scoping', () => {
	it('session reads with the wrong Event find nothing', async () => {
		const service = broadcastGraphicsStateService();
		expect(await service.findSessionById(liveSessionTwoId, one.eventId)).toBeUndefined();
		expect(await service.findActiveSessionByScreen(two.screenId, one.eventId)).toBeUndefined();
	});

	it('the Event-wide active-session sweep stays inside the asking Event', async () => {
		const service = broadcastGraphicsStateService();
		expect(await service.findActiveSessionsByEvent(one.eventId)).toEqual([]);
		expect((await service.findActiveSessionsByEvent(two.eventId)).map(session => session.id)).toEqual([liveSessionTwoId]);
	});
});

describe('featureMatchService event scoping', () => {
	it('point reads with the wrong Event find nothing', async () => {
		const service = featureMatchService();
		expect(await service.findById(two.slotId, one.eventId)).toBeUndefined();
		expect(await service.exists(two.slotId, one.eventId)).toBe(false);
	});

	it('lists and counts only the asking Event', async () => {
		const service = featureMatchService();
		const ids = (await service.findByEventId(one.eventId)).map(slot => slot.id);
		expect(ids.toSorted((a, b) => a - b)).toEqual([one.slotId, crossWiredSlotId].toSorted((a, b) => a - b));
		expect(await service.countByEventId(one.eventId)).toBe(2);
		expect(await service.countByEventId(two.eventId)).toBe(1);
	});

	it('a session pointer into another Event resolves to no active session', async () => {
		const slot = await featureMatchService().findById(crossWiredSlotId, one.eventId);
		expect(slot?.activeSessionId).toBe(sessionTwoId);
		expect(slot?.activeSession).toBeNull();
	});
});

describe('featureMatchStateService event scoping', () => {
	it('refuses to open a session on another Event\'s Slot', async () => {
		expect(await featureMatchStateService().createSessionForSlot(two.slotId, one.eventId)).toBeNull();
	});

	it('a player reference into another Event resolves no snapshot data', async () => {
		const slot = (await db.query.featureMatches.findFirst({
			where: (table, { eq: whereEq }) => whereEq(table.id, crossWiredSlotId),
		}))!;
		const snapshot = await featureMatchStateService().buildSourceSnapshot(slot);
		expect(snapshot.player1.playerId).toBe(two.playerId);
		expect(snapshot.player1.data).toBeNull();
	});
});

describe('graphicBindingDataService event scoping', () => {
	it('foreign selection ids resolve to nothing and Event lists stay home', async () => {
		const declarations = [
			{ key: 'player', label: 'Player', kind: 'player' },
			{ key: 'match', label: 'Match', kind: 'match' },
			{ key: 'slot', label: 'Slot', kind: 'feature-match-slot' },
			{ key: 'phase', label: 'Phase', kind: 'phase' },
			{ key: 'round', label: 'Round', kind: 'round' },
			{ key: 'archetype', label: 'Archetype', kind: 'archetype' },
		] as const;
		const data = await graphicBindingDataService().load(one.eventId, declarations, {
			player: two.playerId,
			match: two.matchId,
			slot: two.slotId,
		});

		expect(data.event?.name).toBe('Event One');
		expect(Object.keys(data.talents).map(Number)).toEqual([one.talentId]);
		expect(data.players).toEqual({});
		expect(data.matches).toEqual({});
		expect(data.featureMatchSlots).toEqual({});
		expect(Object.keys(data.phases).map(Number)).toEqual([one.phaseId]);
		expect(Object.keys(data.rounds).map(Number)).toEqual([one.roundId]);
		expect(Object.keys(data.archetypes).map(Number)).toEqual([one.archetypeId]);
	});
});

describe('playerFeatureMatchSyncService event scoping', () => {
	it('reverse sync never rewrites another Event\'s Slot pairing the same player', async () => {
		// Event 2's Slot deliberately pairs Event 1's player; the schema does not
		// forbid it, so only the sync's Event predicate keeps it untouched.
		await db.update(schema.featureMatches)
			.set({ player1Id: one.playerId })
			.where(eq(schema.featureMatches.id, two.slotId));
		await db.update(schema.featureMatches)
			.set({ player1Id: one.playerId, activeSessionId: null })
			.where(eq(schema.featureMatches.id, one.slotId));

		const updated = await playerFeatureMatchSyncService().syncMatchesFromPlayers(one.eventId, [one.playerId]);
		expect(updated).toEqual([one.slotId]);

		const slotOne = await db.query.featureMatches.findFirst({
			where: (table, { eq: whereEq }) => whereEq(table.id, one.slotId),
		});
		expect(slotOne?.player1Data).toMatchObject({ name: 'Event One Player' });
		const slotTwo = await db.query.featureMatches.findFirst({
			where: (table, { eq: whereEq }) => whereEq(table.id, two.slotId),
		});
		expect(slotTwo?.player1Data).toBeNull();
	});
});
