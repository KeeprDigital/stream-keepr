import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { MAX_REALTIME_MESSAGE_BYTES, realtimeMessageBytes } from '~~/shared/types/messages';
import { eventRealtimeChannel, screenRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// What an Archetype rename or delete announces of the Players it re-projects, over
// real SQL: one message naming them, whatever their number (ADR-0084). Faked: Ably,
// and the Broadcast Graphics Live Session port.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));

/** Each Event whose Graphic Input Bindings were re-resolved, in order. */
const reResolved: number[] = [];
vi.doMock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: async (eventId: number) => {
		reResolved.push(eventId);
	},
}));

const { archetypeWriteModule } = await import('~~/server/modules/archetype-write');
const { playerUpdateModule } = await import('~~/server/modules/player-update');
const { eventDataPublicationModule } = await import('~~/server/modules/event-data-publication');

beforeEach(() => {
	ably.reset();
	reResolved.length = 0;
});
afterAll(async () => await harness.close());

const ORIGIN = 'origin-1';
const PROJECTIONS_CHANGED = 'player:deckProjectionsChanged';

let sequence = 0;

/**
 * An Event whose Archetype, Azorius Control, is the reviewed primary Deck List
 * of `pilots` Players, with one Player more whose Deck List is unreviewed.
 */
async function stage(pilots: number) {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [archetype] = await db.insert(schema.archetypes).values({ eventId, name: 'Azorius Control', colors: 'WU' }).returning();
	const players = await db.insert(schema.players)
		.values(Array.from({ length: pilots + 1 }, (_, index) => ({ eventId, name: `Player ${index + 1}` })))
		.returning({ id: schema.players.id });
	const playerIds = players.map(player => player.id);
	const bystanderId = playerIds.pop()!;
	await db.insert(schema.playerDecks).values([...playerIds, bystanderId].map((playerId): typeof schema.playerDecks.$inferInsert => ({
		eventId,
		playerId,
		externalId: `deck-${++sequence}`,
		externalSource: 'melee',
		formatExternalId: 'modern',
		name: 'Imported Deck',
		isPrimary: true,
		...(playerId !== bystanderId && {
			archetypeId: archetype!.id,
			reviewedAt: new Date('2026-10-01T00:00:00.000Z'),
		}),
	})));
	return {
		eventId,
		archetypeId: archetype!.id,
		playerIds,
		bystanderId,
	};
}

/** A Deck List Screen of one Player, by id. */
async function stageDeckListScreen(eventId: number, playerId: number) {
	const [screen] = await db.insert(schema.screens)
		.values({
			eventId,
			name: `Deck List ${++sequence}`,
			slug: `deck-list-${sequence}`,
			currentMode: 'deck',
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId },
				},
			} as never,
			assetCapabilitySeed: `seed-${sequence}`,
			assetCapabilityDigest: `digest-${sequence}`,
		})
		.returning({ id: schema.screens.id });
	return screen!.id;
}

/** What the Event's channel was sent, as `[type, payload]`. */
function announced(eventId: number) {
	return ably.on(eventRealtimeChannel(eventId)).map(({ type, payload }) => [type, payload] as const);
}

/** The kinds of Output Change each notice on a Screen's channel named. */
function toldScreen(eventId: number, screenId: number) {
	return ably.on(screenRealtimeChannel(eventId, screenId)).map(({ payload }) => payload.causes);
}

/** The deck name each Player shows, in the order asked. */
async function deckNames(eventId: number, playerIds: number[]) {
	const players = await db.select().from(schema.players).where(eq(schema.players.eventId, eventId));
	const shown = new Map(players.map(player => [player.id, (player.gameData as { deckName?: string } | null)?.deckName ?? null]));
	return playerIds.map(playerId => shown.get(playerId));
}

describe('re-projecting the Players an Archetype change touched', () => {
	// One publish per Player was 400 for a common Archetype, in one Worker invocation.
	it.each([1, 3, 400])('announces %i re-projected Players in one message naming each, under the writer\'s origin', async (pilots) => {
		const { eventId, archetypeId, playerIds } = await stage(pilots);
		await db.update(schema.archetypes).set({ name: 'Azorius Tempo' }).where(eq(schema.archetypes.id, archetypeId));

		const answered = await playerUpdateModule().reconcileDeckProjections({ eventId, playerIds, originConnectionId: ORIGIN });

		expect(new Set(await deckNames(eventId, playerIds))).toEqual(new Set(['Azorius Tempo']));
		expect(answered.map(player => player.id)).toEqual(playerIds);
		expect(announced(eventId)).toEqual([
			[
				PROJECTIONS_CHANGED,
				{ playerIds, originConnectionId: ORIGIN },
			],
		]);
	});

	it.each([
		{
			none: 'none was asked for',
			asked: () => [] as number[],
		},
		{
			none: 'those asked for are another Event\'s',
			asked: (other: number[]) => other,
		},
	])('announces nothing when $none', async ({ asked }) => {
		const { eventId } = await stage(1);
		const other = await stage(2);

		await expect(playerUpdateModule().reconcileDeckProjections({
			eventId,
			playerIds: asked(other.playerIds),
		})).resolves.toEqual([]);

		expect(ably.published).toEqual([]);
		expect(reResolved).toEqual([]);
	});

	// A Screen is told once of the lot, and only where it shows one of the Players.
	it('re-resolves Graphic Input Bindings once, and tells each Screen showing one of the Players once', async () => {
		const { eventId, playerIds, bystanderId } = await stage(3);
		const showsPilot = await stageDeckListScreen(eventId, playerIds[1]!);
		const showsBystander = await stageDeckListScreen(eventId, bystanderId);

		await playerUpdateModule().reconcileDeckProjections({ eventId, playerIds });

		expect(reResolved).toEqual([eventId]);
		expect(toldScreen(eventId, showsPilot)).toEqual([
			['player'],
		]);
		expect(toldScreen(eventId, showsBystander)).toEqual([]);
	});
});

describe('an Archetype write', () => {
	// A peer applies the Archetype's own message to the Players it has re-read by then.
	it.each([
		{
			write: 'rename',
			act: (eventId: number, archetypeId: number) => archetypeWriteModule().updateArchetype({
				eventId,
				archetypeId,
				input: { name: 'Azorius Tempo' },
				originConnectionId: ORIGIN,
			}),
			then: 'archetype:updated',
			deckName: 'Azorius Tempo',
		},
		{
			write: 'delete',
			act: (eventId: number, archetypeId: number) => archetypeWriteModule().deleteArchetype({ eventId, archetypeId, originConnectionId: ORIGIN }),
			then: 'archetype:deleted',
			deckName: 'Imported Deck',
		},
	])('a $write announces its Players in one message, before the Archetype', async ({ act, then, deckName }) => {
		const { eventId, archetypeId, playerIds } = await stage(3);

		await act(eventId, archetypeId);

		expect(await deckNames(eventId, playerIds)).toEqual([deckName, deckName, deckName]);
		expect(announced(eventId).map(([type, payload]) => [type, payload.playerIds, payload.originConnectionId])).toEqual([
			[PROJECTIONS_CHANGED, playerIds, ORIGIN],
			[then, undefined, ORIGIN],
		]);
	});
});

describe('a re-projection of more Players than one message can name', () => {
	/** No staged Event's id, so the publish reads no Screen. */
	const EVENT_ID = 900;

	const weigh = (playerIds: number[]) => realtimeMessageBytes(EVENT_ID, PROJECTIONS_CHANGED, { playerIds }, ORIGIN);

	/** Distinct Player ids whose message weighs exactly `bytes`. */
	function playerIdsWeighing(bytes: number) {
		const forIds = bytes - weigh([]);
		// A seven-digit id costs eight bytes with its comma; the last takes up the one to eight left.
		const sevenDigits = Math.floor((forIds - 1) / 8);
		return [
			...Array.from({ length: sevenDigits }, (_, index) => 1_000_001 + index),
			10 ** (forIds - sevenDigits * 8 - 1),
		];
	}

	// Above the limit the provider refuses the publish, and a refusal is logged and
	// swallowed. So the ids are left out: every consumer re-reads, as after a sync.
	it.each([
		{ weighing: 'exactly the limit', bytes: MAX_REALTIME_MESSAGE_BYTES, names: 'each Player' },
		{ weighing: 'one byte over the limit', bytes: MAX_REALTIME_MESSAGE_BYTES + 1, names: 'no Player' },
	] as const)('names $names in a message that would weigh $weighing', async ({ bytes, names }) => {
		const oversized = vi.spyOn(console, 'error').mockImplementation(() => {});
		const playerIds = playerIdsWeighing(bytes);
		expect(weigh(playerIds)).toBe(bytes);

		await eventDataPublicationModule().playerDeckProjectionsChanged({ eventId: EVENT_ID, playerIds, originConnectionId: ORIGIN });

		expect(announced(EVENT_ID)).toEqual([
			[
				PROJECTIONS_CHANGED,
				{
					playerIds: names === 'each Player'
						? playerIds
						: null,
					originConnectionId: ORIGIN,
				},
			],
		]);
		expect(oversized).not.toHaveBeenCalled();
	});
});
