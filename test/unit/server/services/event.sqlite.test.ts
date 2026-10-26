import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Event service over real SQL: the game policy a new Event starts with,
// the Melee config write and the imported-data reset it carries, and the
// Melee Sync lease.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const protectMeleeClientSecret = vi.fn(async (secret: string) => `encrypted:${secret}`);

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/services/meleeCredentials', () => ({ protectMeleeClientSecret }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));

const { eventService } = await import('~~/server/services/event');

beforeEach(() => protectMeleeClientSecret.mockClear());

afterAll(async () => await harness.close());

async function storedEvent(id: number) {
	return (await db.query.events.findFirst({
		where: eq(schema.events.id, id),
	}))!;
}

const syncedAt = new Date('2026-01-01T00:00:00Z');
const leaseExpiresAt = new Date('2999-01-01T00:00:00Z');

/** A Melee-configured Event holding imported and manual data side by side. */
async function stageMeleeEvent() {
	const [event] = await db.insert(schema.events).values({
		name: 'Melee Event',
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
		meleeEnabled: true,
		meleeEventId: 'old-event',
		meleeClientId: 'old-client',
		meleeClientSecret: 'encrypted:old-secret',
		initialSetupCompletedAt: syncedAt,
		lastEventSyncedAt: syncedAt,
		lastPlayersSyncedAt: syncedAt,
		lastDecklistsSyncedAt: syncedAt,
		lastSyncError: 'old-error',
		meleeSyncLeaseToken: 'lease-token',
		meleeSyncLeaseCommand: 'update',
		meleeSyncLeaseExpiresAt: leaseExpiresAt,
	}).returning();
	const eventId = event!.id;
	const [card] = await db.insert(schema.cards).values({ name: `Card ${eventId}`, game: 'mtg' }).returning();
	await db.insert(schema.eventCardNameOverrides).values({
		eventId,
		inputName: 'x',
		normalizedInputName: 'x',
		resolvedCardId: card!.id,
	});
	const [imported, manual] = await db.insert(schema.players)
		.values([
			{
				eventId,
				name: 'Imported',
				externalSource: 'melee',
				externalId: 'p-1',
			},
			{ eventId, name: 'Manual', externalSource: 'manual' },
		])
		.returning();
	const [importedPhase] = await db.insert(schema.phases)
		.values([
			{
				eventId,
				name: 'Imported',
				externalSource: 'melee',
				externalId: 'ph-1',
			},
			{ eventId, name: 'Manual', externalSource: 'manual' },
		])
		.returning();
	const [round] = await db.insert(schema.rounds).values({
		eventId,
		phaseId: importedPhase!.id,
		name: 'R1',
		roundNumber: 1,
		externalSource: 'melee',
		externalId: 'r-1',
	}).returning();
	const [match] = await db.insert(schema.matches).values({
		eventId,
		roundId: round!.id,
		externalSource: 'melee',
		externalId: 'm-1',
	}).returning();
	const [importedScreen, manualScreen] = await db.insert(schema.screens).values([
		{
			eventId,
			name: 'Imported Deck',
			slug: `imported-${eventId}`,
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId: imported!.id },
				},
			} as never,
			assetCapabilitySeed: 's',
			assetCapabilityDigest: `d-${eventId}-a`,
		},
		{
			eventId,
			name: 'Manual Deck',
			slug: `manual-${eventId}`,
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId: manual!.id },
				},
			} as never,
			assetCapabilitySeed: 's',
			assetCapabilityDigest: `d-${eventId}-b`,
		},
	]).returning();
	const [slot] = await db.insert(schema.featureMatches).values({
		eventId,
		matchId: match!.id,
		externalId: 'm-1',
		externalSource: 'melee',
		player1Id: imported!.id,
		player1Data: { name: 'Imported' },
		bestOf: 5,
	}).returning();
	const [session] = await db.insert(schema.featureMatchSessions).values({
		eventId,
		slotId: slot!.id,
		status: 'active',
		sourceSnapshot: { old: 'snapshot' } as never,
		currentState: { old: 'state' } as never,
		sequence: 7,
	}).returning();
	await db.update(schema.featureMatches).set({ activeSessionId: session!.id }).where(eq(schema.featureMatches.id, slot!.id));
	await db.insert(schema.liveStateCommandReceipts).values({
		eventId,
		aggregateKind: 'featureMatchSession',
		aggregateId: session!.id,
		commandId: `old-command-${eventId}`,
		commandType: 'SnapshotCorrected',
		contentKey: 'old-content-key',
		sequence: 7,
	});
	return {
		eventId,
		importedScreenId: importedScreen!.id,
		manualScreenId: manualScreen!.id,
		slotId: slot!.id,
		sessionId: session!.id,
	};
}

async function countBySource(table: typeof schema.players | typeof schema.phases | typeof schema.matches, eventId: number, source: 'melee' | 'manual') {
	return (await db.select().from(table).where(and(eq(table.eventId, eventId), eq(table.externalSource, source)))).length;
}

describe('create', () => {
	it('starts an Event from its game\'s complete policy, letting an explicit setting win', async () => {
		const policy = await eventService().create({ name: 'One Piece', game: 'op' } as never);
		const custom = await eventService().create({ name: 'Custom', game: 'op', featureMatchDefaultClockDuration: 45 } as never);

		expect(await storedEvent(policy.id)).toMatchObject({
			featureMatchDefaultBestOf: 1,
			featureMatchDefaultStartingLife: 0,
			featureMatchDefaultClockType: 'countdown',
			featureMatchDefaultClockDuration: 30,
			featureMatchDefaultCountUpAfterCountdown: false,
			featureMatchDefaultExtraTurnsEnabled: false,
			featureMatchDefaultExtraTurns: 0,
		});
		expect(policy.talents).toEqual([]);
		expect(await storedEvent(custom.id)).toMatchObject({ featureMatchDefaultBestOf: 1, featureMatchDefaultClockDuration: 45 });
	});
});

describe('update', () => {
	it('marks decklists stale when a points system is switched on', async () => {
		const { eventId } = await stageMeleeEvent();
		await db.update(schema.events).set({ pointsSystem: null }).where(eq(schema.events.id, eventId));

		await eventService().update(eventId, { pointsSystem: '7ph' } as never);

		expect(await storedEvent(eventId)).toMatchObject({ pointsSystem: '7ph', lastDecklistsSyncedAt: null });
	});
});

describe('updateMeleeConfig', () => {
	it('stores only the encrypted form of a new secret, and keeps the stored one when none is sent', async () => {
		const { eventId } = await stageMeleeEvent();

		await eventService().updateMeleeConfig(eventId, {
			meleeEnabled: true,
			meleeEventId: 'old-event',
			meleeClientId: 'client',
			meleeClientSecret: 'plaintext',
		} as never);
		expect((await storedEvent(eventId)).meleeClientSecret).toBe('encrypted:plaintext');

		await eventService().updateMeleeConfig(eventId, { meleeEnabled: true, meleeEventId: 'old-event', meleeClientId: 'client' } as never);
		expect((await storedEvent(eventId)).meleeClientSecret).toBe('encrypted:plaintext');
	});

	it('writes nothing, imported data included, when the secret cannot be encrypted', async () => {
		const { eventId } = await stageMeleeEvent();
		protectMeleeClientSecret.mockRejectedValueOnce(new Error('encryption unavailable'));

		await expect(eventService().updateMeleeConfig(eventId, {
			meleeEnabled: true,
			meleeEventId: 'new-event',
			meleeClientId: 'client',
			meleeClientSecret: 'plaintext',
		} as never))
			.rejects
			.toThrow('encryption unavailable');

		expect(await storedEvent(eventId)).toMatchObject({ meleeEventId: 'old-event', meleeClientSecret: 'encrypted:old-secret' });
		expect(await countBySource(schema.players, eventId, 'melee')).toBe(1);
	});

	it('clears sync progress when Melee is switched off, leaving the running lease alone', async () => {
		const { eventId } = await stageMeleeEvent();

		await eventService().updateMeleeConfig(eventId, {
			meleeEnabled: false,
			meleeEventId: 'old-event',
			meleeClientId: null,
			meleeClientSecret: null,
		} as never);

		expect(await storedEvent(eventId)).toMatchObject({
			initialSetupCompletedAt: null,
			lastEventSyncedAt: null,
			lastPlayersSyncedAt: null,
			lastDecklistsSyncedAt: null,
			lastSyncError: null,
			meleeSyncLeaseToken: 'lease-token',
		});
	});

	it('resets imported data, keeping manual data, when the Melee event changes', async () => {
		const { eventId, importedScreenId, manualScreenId, slotId, sessionId } = await stageMeleeEvent();

		const result = await eventService().updateMeleeConfig(eventId, {
			meleeEnabled: true,
			meleeEventId: 'new-event',
			meleeClientId: 'new-client',
			meleeClientSecret: 'new-secret',
		} as never);

		expect(result?.clearedScreens.map(screen => screen.id)).toEqual([importedScreenId]);
		expect(await storedEvent(eventId)).toMatchObject({
			meleeEventId: 'new-event',
			lastEventSyncedAt: null,
			lastSyncError: null,
			meleeSyncLeaseToken: 'lease-token',
		});
		for (const table of [schema.players, schema.phases, schema.matches])
			expect(await countBySource(table, eventId, 'melee')).toBe(0);
		expect(await countBySource(schema.players, eventId, 'manual')).toBe(1);
		expect(await countBySource(schema.phases, eventId, 'manual')).toBe(1);
		expect(await db.select().from(schema.eventCardNameOverrides).where(eq(schema.eventCardNameOverrides.eventId, eventId))).toEqual([]);
		const screens = await db.select().from(schema.screens).where(eq(schema.screens.eventId, eventId));
		expect(screens.find(screen => screen.id === importedScreenId)?.modeConfigs).toEqual({
			deck: {
				deckSource: { type: 'player', playerId: null },
			},
		});
		expect(screens.find(screen => screen.id === manualScreenId)?.stateVersion).toBe(0);

		const slot = (await db.query.featureMatches.findFirst({
			where: eq(schema.featureMatches.id, slotId),
		}))!;
		expect(slot).toMatchObject({
			matchId: null,
			externalId: null,
			player1Id: null,
			player1Data: null,
			bestOf: 5,
		});
		expect(slot.activeSessionId).not.toBe(sessionId);
		expect((await db.query.featureMatchSessions.findFirst({
			where: eq(schema.featureMatchSessions.id, sessionId),
		}))?.status).toBe('closed');
		expect(await db.select().from(schema.liveStateCommandReceipts).where(eq(schema.liveStateCommandReceipts.eventId, eventId))).toEqual([]);
	});

	it('rolls the whole reset back when a later statement fails', async () => {
		const { eventId, importedScreenId, sessionId } = await stageMeleeEvent();
		await harness.client.execute(`create trigger reject_receipt_delete before delete on live_state_command_receipts
			begin select raise(abort, 'forced reset failure'); end`);
		try {
			await expect(eventService().updateMeleeConfig(eventId, {
				meleeEnabled: true,
				meleeEventId: 'new-event',
				meleeClientId: 'new-client',
				meleeClientSecret: 'new-secret',
			} as never))
				.rejects
				.toThrow(/forced reset failure/);
		}
		finally {
			await harness.client.execute('drop trigger reject_receipt_delete');
		}

		expect(await storedEvent(eventId)).toMatchObject({ meleeEventId: 'old-event', meleeClientSecret: 'encrypted:old-secret', lastSyncError: 'old-error' });
		expect(await countBySource(schema.players, eventId, 'melee')).toBe(1);
		expect(await countBySource(schema.matches, eventId, 'melee')).toBe(1);
		expect((await db.query.screens.findFirst({
			where: eq(schema.screens.id, importedScreenId),
		}))?.stateVersion).toBe(0);
		expect((await db.query.featureMatchSessions.findFirst({
			where: eq(schema.featureMatchSessions.id, sessionId),
		}))).toMatchObject({ status: 'active', sequence: 7 });
	});

	it('answers nothing for an unknown Event', async () => {
		expect(await eventService().updateMeleeConfig(999_999, {} as never)).toBeUndefined();
	});
});

describe('the Melee Sync lease', () => {
	const now = new Date('2026-01-01T00:00:00Z');
	const expiresAt = new Date('2026-01-01T00:15:00Z');
	const acquire = (eventId: number, token: string) => eventService().tryAcquireMeleeSyncLease({
		eventId,
		token,
		command: 'update',
		now,
		expiresAt,
	});

	async function stageLease(lease: { token: string | null; expiresAt: Date | null }) {
		const [event] = await db.insert(schema.events).values({
			name: 'Lease',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			meleeSyncLeaseToken: lease.token,
			meleeSyncLeaseCommand: lease.token ? 'decklists' : null,
			meleeSyncLeaseExpiresAt: lease.expiresAt,
		}).returning();
		return event!.id;
	}

	it.each([
		[
			'free',
			{ token: null, expiresAt: null },
		],
		[
			'expired',
			{
				token: 'expired-token',
				expiresAt: new Date('2025-12-31T23:59:59Z'),
			},
		],
	])('takes a %s lease', async (_state, lease) => {
		const eventId = await stageLease(lease);

		expect(await acquire(eventId, 'new-token')).toEqual({
			acquired: true,
			lease: { token: 'new-token', command: 'update', expiresAt },
		});
		expect((await storedEvent(eventId)).meleeSyncLeaseToken).toBe('new-token');
	});

	it('reports a held lease by command and expiry, never by token', async () => {
		const eventId = await stageLease({ token: 'active-token', expiresAt });

		expect(await acquire(eventId, 'new-token')).toEqual({
			acquired: false,
			activeLease: { command: 'decklists', expiresAt },
		});
	});

	it('renews and releases only for the token that holds it', async () => {
		const eventId = await stageLease({ token: 'owning-token', expiresAt });
		const later = new Date('2026-01-01T00:20:00Z');

		expect(await eventService().renewMeleeSyncLease(eventId, 'other-token', later)).toBe(false);
		expect(await eventService().releaseMeleeSyncLease(eventId, 'other-token')).toBe(false);
		expect(await eventService().renewMeleeSyncLease(eventId, 'owning-token', later)).toBe(true);
		expect((await storedEvent(eventId)).meleeSyncLeaseExpiresAt).toEqual(later);
		expect(await eventService().releaseMeleeSyncLease(eventId, 'owning-token')).toBe(true);
		expect(await storedEvent(eventId)).toMatchObject({ meleeSyncLeaseToken: null, meleeSyncLeaseCommand: null, meleeSyncLeaseExpiresAt: null });
	});
});

describe('reads and sync metadata', () => {
	it('records sync metadata only for the lease token that owns the Event', async () => {
		const { eventId } = await stageMeleeEvent();

		expect(await eventService().updateSyncMetadata(eventId, { lastSyncError: 'stale' }, 'other-token')).toBe(false);
		expect(await eventService().updateSyncMetadata(eventId, { lastSyncError: 'owned' }, 'lease-token')).toBe(true);
		expect((await storedEvent(eventId)).lastSyncError).toBe('owned');
		expect(await eventService().updateSyncMetadata(999_999, { lastSyncError: 'missing' })).toBe(false);
	});

	it('lists Events by game, and answers existence and removal', async () => {
		const op = await eventService().create({ name: 'Listed', game: 'op' } as never);

		const listed = await eventService().findAll({ game: 'op' });
		expect(listed.map(event => event.id)).toContain(op.id);
		expect(listed.every(event => event.game === 'op')).toBe(true);
		expect(await eventService().exists(op.id)).toBe(true);
		expect(await eventService().remove(op.id)).toBe(true);
		expect(await eventService().remove(op.id)).toBe(false);
		expect(await eventService().exists(op.id)).toBe(false);
	});
});
