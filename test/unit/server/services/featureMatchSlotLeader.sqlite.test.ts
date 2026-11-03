import type { OpLeader } from '~~/shared/types/game';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { LAW, NAMI, ZORO } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Slot side's Leader is manual slot data on a One Piece Event (ADR-0057).
 * Changing it during a Feature Match Session reaches that Session's source
 * snapshot without reopening it, and a swap keeps it with its player.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));

const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { featureMatchStateService } = await import('~~/server/services/featureMatchState');

afterAll(async () => {
	await harness.close();
});

function side(name: string, sideLeader: OpLeader) {
	return {
		name,
		gameData: { type: 'op' as const, leader: sideLeader },
	};
}

async function stageSession() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'One Piece Regional', game: 'op', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [slot] = await db.insert(schema.featureMatches)
		.values({
			eventId,
			player1Data: side('Ana', ZORO),
			player2Data: side('Ben', LAW),
		})
		.returning();
	const session = (await featureMatchStateService().createSessionForSlot(slot!.id, eventId))!;
	return { eventId, slotId: slot!.id, session };
}

/** Which Leader each side of the Session shows, by player name. */
async function sessionLeaders(slotId: number, eventId: number) {
	const slot = await db.query.featureMatches.findFirst({
		where: and(eq(schema.featureMatches.id, slotId), eq(schema.featureMatches.eventId, eventId)),
	});
	const session = (await db.query.featureMatchSessions.findFirst({
		where: eq(schema.featureMatchSessions.id, slot!.activeSessionId!),
	}))!;
	const { player1, player2 } = session.sourceSnapshot;
	return {
		sessionId: session.id,
		player1: [player1.data?.name, player1.data?.gameData],
		player2: [player2.data?.name, player2.data?.gameData],
	};
}

describe('a Slot side\'s Leader during a Feature Match Session', () => {
	it('reaches the Session\'s snapshot when changed, without reopening it', async () => {
		const { eventId, slotId, session } = await stageSession();

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: side('Ana', NAMI),
			},
		});

		expect(await sessionLeaders(slotId, eventId)).toEqual({
			sessionId: session.id,
			player1: [
				'Ana',
				{ type: 'op', leader: NAMI },
			],
			player2: [
				'Ben',
				{ type: 'op', leader: LAW },
			],
		});
	});

	it('stays with its player through a swap and a later change', async () => {
		const { eventId, slotId, session } = await stageSession();

		await featureMatchStateService().applyCommand(session.id, eventId, {
			commandId: 'swap',
			type: 'SwapPlayers',
			payload: {},
			baseSequence: session.sequence,
		});
		// The setup form saves in Slot order; the Session keeps the swap (ADR-0058).
		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: side('Ana', NAMI),
			},
		});

		const leaders = await sessionLeaders(slotId, eventId);
		expect([leaders.player1, leaders.player2]).toEqual([
			['Ben', { type: 'op', leader: LAW }],
			['Ana', { type: 'op', leader: NAMI }],
		]);
	});
});
