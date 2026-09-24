import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { createMockEvent, createMockTalent } from '~~/test/helpers/fixtures';

const featureResetQuery = { kind: 'feature-reset-query' };
const buildClearImportedMatchDataQueries = vi.fn().mockResolvedValue({
	queries: [featureResetQuery],
	clearedSlotCount: 1,
});
const protectMeleeClientSecret = vi.fn(async (secret: string) => `encrypted:${secret}`);

vi.mock('~~/server/db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	eventCardNameOverrides: { eventId: 'eventCardNameOverrides.eventId' },
	events: {
		id: 'events.id',
		game: 'events.game',
		meleeSyncLeaseToken: 'events.meleeSyncLeaseToken',
		meleeSyncLeaseCommand: 'events.meleeSyncLeaseCommand',
		meleeSyncLeaseExpiresAt: 'events.meleeSyncLeaseExpiresAt',
	},
	eventTalents: { eventId: 'eventTalents.eventId' },
	players: { eventId: 'players.eventId', externalSource: 'players.externalSource' },
	phases: { eventId: 'phases.eventId', externalSource: 'phases.externalSource' },
	matches: { eventId: 'matches.eventId', externalSource: 'matches.externalSource' },
}));
vi.mock('~~/server/services/featureMatch', () => ({
	buildClearImportedMatchDataQueries,
}));
vi.mock('~~/server/services/meleeCredentials', () => ({
	protectMeleeClientSecret,
}));

const { eventService } = await import('~~/server/services/event');

describe('eventService', () => {
	beforeEach(() => {
		resetDbMocks();
		buildClearImportedMatchDataQueries.mockClear();
		protectMeleeClientSecret.mockClear();
	});

	describe('findById', () => {
		it('returns event with talents when found', async () => {
			const event = createMockEvent();
			const talent = createMockTalent();
			const eventWithTalents = { ...event, talents: [talent] };
			mockDb.query.events.findFirst.mockResolvedValue(eventWithTalents);

			const result = await eventService().findById(1);

			expect(result).toEqual(eventWithTalents);
			expect(mockDb.query.events.findFirst).toHaveBeenCalledOnce();
		});
	});

	describe('findAll', () => {
		it('returns all events', async () => {
			const events = [createMockEvent(), createMockEvent({ id: 2, name: 'Event 2' })];
			getChain('select').where.mockResolvedValue(events);

			const result = await eventService().findAll();

			expect(result).toEqual(events);
			expect(mockDb.select).toHaveBeenCalledOnce();
		});

		it('returns empty array when no events exist', async () => {
			getChain('select').where.mockResolvedValue([]);

			const result = await eventService().findAll();

			expect(result).toEqual([]);
		});

		it('filters by game when param provided', async () => {
			getChain('select').where.mockResolvedValue([]);

			await eventService().findAll({ game: 'mtg' });

			expect(getChain('select').where).toHaveBeenCalledOnce();
		});
	});

	describe('create', () => {
		it('returns new event with empty talents array', async () => {
			const newEvent = createMockEvent();
			getChain('insert').returning.mockResolvedValue([newEvent]);

			const result = await eventService().create({ name: 'Test Event', game: 'mtg' } as any);

			expect(result).toEqual({ ...newEvent, talents: [] });
			expect(mockDb.insert).toHaveBeenCalledOnce();
		});

		it('materialises the complete selected-game policy before insertion', async () => {
			const newEvent = createMockEvent({ game: 'op' });
			getChain('insert').returning.mockResolvedValue([newEvent]);

			await eventService().create({ name: 'One Piece Event', game: 'op' } as any);

			expect(getChain('insert').values).toHaveBeenCalledWith(expect.objectContaining({
				game: 'op',
				featureMatchOrientation: 'horizontal',
				featureMatchDefaultBestOf: 1,
				featureMatchDefaultStartingLife: 0,
				featureMatchDefaultClockType: 'countdown',
				featureMatchDefaultClockDuration: 30,
				featureMatchDefaultCountUpAfterCountdown: false,
				featureMatchDefaultExtraTurnsEnabled: false,
				featureMatchDefaultExtraTurns: 0,
			}));
		});

		it('lets an explicit event setting override the selected-game policy', async () => {
			getChain('insert').returning.mockResolvedValue([createMockEvent({ game: 'op' })]);

			await eventService().create({
				name: 'Custom One Piece Event',
				game: 'op',
				featureMatchDefaultClockDuration: 45,
			} as any);

			expect(getChain('insert').values).toHaveBeenCalledWith(expect.objectContaining({
				featureMatchDefaultBestOf: 1,
				featureMatchDefaultClockDuration: 45,
			}));
		});
	});

	describe('update', () => {
		it('returns updated event with talents', async () => {
			const updatedEvent = createMockEvent({ name: 'Updated' });
			const talent = createMockTalent();
			mockDb.query.events.findFirst.mockResolvedValue(createMockEvent());
			getChain('update').returning.mockResolvedValue([updatedEvent]);
			getChain('select').where.mockResolvedValue([talent]);

			const result = await eventService().update(1, { name: 'Updated' } as any);

			expect(result).toEqual({ ...updatedEvent, talents: [talent] });
		});

		it('marks decklist sync stale when enabling a points system', async () => {
			mockDb.query.events.findFirst.mockResolvedValue(createMockEvent({ pointsSystem: null }));
			getChain('update').returning.mockResolvedValue([createMockEvent({ pointsSystem: '7ph', lastDecklistsSyncedAt: null })]);
			getChain('select').where.mockResolvedValue([]);

			await eventService().update(1, { pointsSystem: '7ph' } as any);

			expect(getChain('update').set).toHaveBeenCalledWith(expect.objectContaining({
				pointsSystem: '7ph',
				lastDecklistsSyncedAt: null,
			}));
		});
	});

	describe('updateMeleeConfig', () => {
		it('encrypts every newly supplied secret before persistence', async () => {
			mockDb.query.events.findFirst.mockResolvedValue({ meleeEventId: 'same-id' });

			await eventService().updateMeleeConfig(1, {
				meleeEnabled: true,
				meleeEventId: 'same-id',
				meleeClientId: 'client',
				meleeClientSecret: 'plaintext-secret',
			} as any);

			expect(protectMeleeClientSecret).toHaveBeenCalledWith('plaintext-secret');
			expect(getChain('update').set).toHaveBeenCalledWith(expect.objectContaining({
				meleeClientSecret: 'encrypted:plaintext-secret',
			}));
			expect(getChain('update').set).not.toHaveBeenCalledWith(expect.objectContaining({
				meleeClientSecret: 'plaintext-secret',
			}));
		});

		it('does not prepare or execute reset writes when secret encryption fails', async () => {
			mockDb.query.events.findFirst.mockResolvedValue({ meleeEventId: 'old-id' });
			protectMeleeClientSecret.mockRejectedValueOnce(new Error('encryption unavailable'));

			await expect(eventService().updateMeleeConfig(1, {
				meleeEnabled: true,
				meleeEventId: 'new-id',
				meleeClientId: 'client',
				meleeClientSecret: 'plaintext-secret',
			} as any)).rejects.toThrow('encryption unavailable');

			expect(buildClearImportedMatchDataQueries).not.toHaveBeenCalled();
			expect(mockDb.delete).not.toHaveBeenCalled();
			expect(mockDb.update).not.toHaveBeenCalled();
			expect(mockDb.batch).not.toHaveBeenCalled();
		});

		it('preserves the existing stored secret when no replacement is supplied', async () => {
			mockDb.query.events.findFirst.mockResolvedValue({ meleeEventId: 'same-id' });

			await eventService().updateMeleeConfig(1, {
				meleeEnabled: true,
				meleeEventId: 'same-id',
				meleeClientId: 'client',
			} as any);

			expect(protectMeleeClientSecret).not.toHaveBeenCalled();
			expect(getChain('update').set).not.toHaveBeenCalledWith(expect.objectContaining({
				meleeClientSecret: expect.anything(),
			}));
		});

		it('resets imported melee data when meleeEventId changes', async () => {
			mockDb.query.events.findFirst.mockResolvedValue({ meleeEventId: 'old-id' });

			const input = {
				meleeEnabled: true,
				meleeEventId: 'new-id',
				meleeClientId: 'client',
				meleeClientSecret: 'secret',
			};

			await eventService().updateMeleeConfig(1, input as any);

			expect(mockDb.batch).toHaveBeenCalledOnce();
			expect(mockDb.delete).toHaveBeenCalledWith(expect.objectContaining({
				eventId: 'eventCardNameOverrides.eventId',
			}));
			expect(buildClearImportedMatchDataQueries).toHaveBeenCalledWith(1);
			expect(mockDb.batch).toHaveBeenCalledWith(expect.arrayContaining([
				featureResetQuery,
				getChain('update'),
			]));
		});

		it('resets sync metadata when melee is disabled', async () => {
			mockDb.query.events.findFirst.mockResolvedValue({ meleeEventId: 'same-id' });

			await eventService().updateMeleeConfig(1, {
				meleeEnabled: false,
				meleeEventId: 'same-id',
				meleeClientId: null,
				meleeClientSecret: null,
				liveMatchRefreshEnabled: false,
				liveMatchRefreshIntervalSeconds: 30,
			} as any);

			expect(getChain('update').set).toHaveBeenCalledWith(expect.objectContaining({
				initialSetupCompletedAt: null,
				lastEventSyncedAt: null,
				lastPlayersSyncedAt: null,
				lastDecklistsSyncedAt: null,
				lastSyncError: null,
			}));
			expect(buildClearImportedMatchDataQueries).toHaveBeenCalledWith(1);
			const persisted = getChain('update').set.mock.calls[0]?.[0];
			expect(persisted).not.toHaveProperty('meleeSyncLeaseToken');
			expect(persisted).not.toHaveProperty('meleeSyncLeaseCommand');
			expect(persisted).not.toHaveProperty('meleeSyncLeaseExpiresAt');
		});

		it('resets sync metadata when the melee event changes', async () => {
			mockDb.query.events.findFirst.mockResolvedValue({ meleeEventId: 'old-id' });

			await eventService().updateMeleeConfig(1, {
				meleeEnabled: true,
				meleeEventId: 'new-id',
				meleeClientId: 'client',
				meleeClientSecret: 'secret',
				liveMatchRefreshEnabled: true,
				liveMatchRefreshIntervalSeconds: 30,
			} as any);

			expect(getChain('update').set).toHaveBeenCalledWith(expect.objectContaining({
				initialSetupCompletedAt: null,
				lastEventSyncedAt: null,
				lastPlayersSyncedAt: null,
				lastDecklistsSyncedAt: null,
				lastSyncError: null,
			}));
		});

		it('returns false when event not found', async () => {
			mockDb.query.events.findFirst.mockResolvedValue(undefined);

			const result = await eventService().updateMeleeConfig(999, {} as any);

			expect(result).toBe(false);
		});
	});

	describe('remove', () => {
		it('returns true when event deleted', async () => {
			getChain('delete').returning.mockResolvedValue([createMockEvent()]);

			const result = await eventService().remove(1);

			expect(result).toBe(true);
		});

		it('returns false when event not found', async () => {
			getChain('delete').returning.mockResolvedValue([]);

			const result = await eventService().remove(999);

			expect(result).toBe(false);
		});
	});

	describe('updateSyncMetadata', () => {
		it('returns true when sync metadata is updated', async () => {
			getChain('update').returning.mockResolvedValue([{ id: 1 }]);

			const result = await eventService().updateSyncMetadata(1, {
				lastSyncError: 'sync failed',
			});

			expect(result).toBe(true);
			expect(getChain('update').set).toHaveBeenCalledWith(expect.objectContaining({
				lastSyncError: 'sync failed',
			}));
		});

		it('returns false when event is not found', async () => {
			getChain('update').returning.mockResolvedValue([]);

			const result = await eventService().updateSyncMetadata(999, {
				lastSyncError: 'sync failed',
			});

			expect(result).toBe(false);
		});
	});

	describe('melee sync lease', () => {
		const now = new Date('2026-01-01T00:00:00.000Z');
		const expiresAt = new Date('2026-01-01T00:15:00.000Z');
		const input = {
			eventId: 1,
			token: 'new-token',
			command: 'update',
			now,
			expiresAt,
		};

		it('atomically acquires an available lease', async () => {
			getChain('update').returning.mockResolvedValue([{ id: 1 }]);

			const result = await eventService().tryAcquireMeleeSyncLease(input);

			expect(result).toEqual({
				acquired: true,
				lease: { token: 'new-token', command: 'update', expiresAt },
			});
			expect(getChain('update').set).toHaveBeenCalledWith({
				meleeSyncLeaseToken: 'new-token',
				meleeSyncLeaseCommand: 'update',
				meleeSyncLeaseExpiresAt: expiresAt,
			});
		});

		it('recovers an expired lease when the first compare-and-set races', async () => {
			getChain('update').returning.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 1 }]);
			mockDb.query.events.findFirst.mockResolvedValue({
				meleeSyncLeaseToken: 'expired-token',
				meleeSyncLeaseCommand: 'players',
				meleeSyncLeaseExpiresAt: new Date('2025-12-31T23:59:59.000Z'),
			});

			const result = await eventService().tryAcquireMeleeSyncLease(input);

			expect(result).toEqual({
				acquired: true,
				lease: { token: 'new-token', command: 'update', expiresAt },
			});
			expect(mockDb.update).toHaveBeenCalledTimes(2);
		});

		it('reports the active lease without exposing its token', async () => {
			getChain('update').returning.mockResolvedValue([]);
			mockDb.query.events.findFirst.mockResolvedValue({
				meleeSyncLeaseToken: 'active-token',
				meleeSyncLeaseCommand: 'decklists',
				meleeSyncLeaseExpiresAt: expiresAt,
			});

			const result = await eventService().tryAcquireMeleeSyncLease(input);

			expect(result).toEqual({
				acquired: false,
				activeLease: { command: 'decklists', expiresAt },
			});
			expect(result).not.toEqual(expect.objectContaining({ token: expect.anything() }));
		});

		it('conditionally releases only the owning token', async () => {
			getChain('update').returning.mockResolvedValue([{ id: 1 }]);

			const released = await eventService().releaseMeleeSyncLease(1, 'owning-token');

			expect(released).toBe(true);
			expect(getChain('update').set).toHaveBeenCalledWith({
				meleeSyncLeaseToken: null,
				meleeSyncLeaseCommand: null,
				meleeSyncLeaseExpiresAt: null,
			});
		});

		it('renews only the token that still owns the lease', async () => {
			getChain('update').returning.mockResolvedValue([{ id: 1 }]);
			const renewedUntil = new Date('2026-01-01T00:20:00.000Z');

			const renewed = await eventService().renewMeleeSyncLease(1, 'owning-token', renewedUntil);

			expect(renewed).toBe(true);
			expect(getChain('update').set).toHaveBeenCalledWith({
				meleeSyncLeaseExpiresAt: renewedUntil,
			});
		});
	});

	describe('exists', () => {
		it('returns true when event exists', async () => {
			mockDb.query.events.findFirst.mockResolvedValue({ id: 1 });

			const result = await eventService().exists(1);

			expect(result).toBe(true);
		});

		it('returns false when event does not exist', async () => {
			mockDb.query.events.findFirst.mockResolvedValue(undefined);

			const result = await eventService().exists(999);

			expect(result).toBe(false);
		});
	});
});
