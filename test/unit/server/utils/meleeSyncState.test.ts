import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEventService = {
	tryAcquireMeleeSyncLease: vi.fn(),
	renewMeleeSyncLease: vi.fn(),
	releaseMeleeSyncLease: vi.fn(),
	updateSyncMetadata: vi.fn(),
	findById: vi.fn(),
};
const mockPublishMessage = vi.fn();

vi.mock('~~/server/services/event', () => ({
	eventService: () => mockEventService,
}));

vi.mock('~~/server/utils/ably', () => ({
	publishMessage: mockPublishMessage,
}));

vi.mock('~~/server/mappers/event', () => ({
	mapEventToResponse: vi.fn(event => event),
}));

vi.stubGlobal('createError', (input: { statusCode: number; message: string; data?: unknown }) => {
	return Object.assign(new Error(input.message), {
		statusCode: input.statusCode,
		data: input.data,
	});
});

const {
	acquireMeleeSyncLease,
	recordMeleeSyncFailure,
	recordMeleeSyncSuccess,
	releaseMeleeSyncLease,
	renewMeleeSyncLease,
} = await import('~~/server/utils/meleeSyncState');

const ctx = { originConnectionId: 'origin-1' };

describe('melee sync lease state', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventService.updateSyncMetadata.mockResolvedValue(true);
		mockEventService.findById.mockResolvedValue({ id: 9, talents: [] });
		mockPublishMessage.mockResolvedValue(undefined);
	});

	it('conditions successful metadata on the owning lease token before publication', async () => {
		const syncedAt = new Date('2026-01-01T00:05:00.000Z');

		await expect(recordMeleeSyncSuccess(ctx, 9, {
			lastPlayersSyncedAt: syncedAt,
		}, 'lease-token')).resolves.toBe(true);

		expect(mockEventService.updateSyncMetadata).toHaveBeenCalledWith(9, {
			lastPlayersSyncedAt: syncedAt,
			lastSyncError: null,
		}, 'lease-token');
		expect(mockPublishMessage).toHaveBeenCalledOnce();
		expect(mockPublishMessage).toHaveBeenCalledWith(9, 'event:updated', expect.anything(), 'origin-1');
	});

	it('does not publish when token-conditioned failure metadata loses ownership', async () => {
		mockEventService.updateSyncMetadata.mockResolvedValue(false);

		await expect(recordMeleeSyncFailure(
			ctx,
			9,
			new Error('upstream failed'),
			{},
			'lease-token',
		)).resolves.toBe(false);

		expect(mockEventService.updateSyncMetadata).toHaveBeenCalledWith(9, {
			lastSyncError: 'Melee sync failed. Retry the operation.',
		}, 'lease-token');
		expect(mockPublishMessage).not.toHaveBeenCalled();
	});

	it('persists a safe card-provider failure without upstream details', async () => {
		const error = Object.assign(new Error('Scryfall HTTP 503 secret upstream body'), {
			code: 'IMPORTED_CARD_LOOKUP_UNAVAILABLE',
		});

		await recordMeleeSyncFailure(ctx, 9, error, {}, 'lease-token');

		expect(mockEventService.updateSyncMetadata).toHaveBeenCalledWith(9, {
			lastSyncError: 'Card data provider is temporarily unavailable. Existing deck data was preserved; retry the sync.',
		}, 'lease-token');
		expect(JSON.stringify(mockEventService.updateSyncMetadata.mock.calls)).not.toContain('secret upstream body');
	});

	it('does not persist messages from arbitrary errors carrying client-like status metadata', async () => {
		const error = Object.assign(new Error('library detail must remain private'), { statusCode: 400 });

		await recordMeleeSyncFailure(ctx, 9, error, {}, 'lease-token');

		expect(mockEventService.updateSyncMetadata).toHaveBeenCalledWith(9, {
			lastSyncError: 'Melee sync failed. Retry the operation.',
		}, 'lease-token');
	});

	it('returns an opaque lease after atomic acquisition', async () => {
		const now = new Date('2026-01-01T00:00:00.000Z');
		const expiresAt = new Date('2026-01-01T00:01:00.000Z');
		mockEventService.tryAcquireMeleeSyncLease.mockResolvedValue({
			acquired: true,
			lease: { token: 'fixed-token', command: 'players', expiresAt },
		});

		const result = await acquireMeleeSyncLease(9, 'players', {
			now,
			durationMs: 60_000,
			token: 'fixed-token',
		});

		expect(result).toEqual({ token: 'fixed-token', command: 'players', expiresAt });
		expect(mockEventService.tryAcquireMeleeSyncLease).toHaveBeenCalledWith({
			eventId: 9,
			token: 'fixed-token',
			command: 'players',
			now,
			expiresAt,
		});
	});

	it('returns a clear 409 for a concurrent command', async () => {
		const expiresAt = new Date('2026-01-01T00:15:00.000Z');
		mockEventService.tryAcquireMeleeSyncLease.mockResolvedValue({
			acquired: false,
			activeLease: { command: 'update', expiresAt },
		});

		await expect(acquireMeleeSyncLease(9, 'players', {
			now: new Date('2026-01-01T00:00:00.000Z'),
			token: 'new-token',
		})).rejects.toMatchObject({
			statusCode: 409,
			message: 'Melee sync command "update" is already running for this event',
			data: {
				code: 'MELEE_SYNC_IN_PROGRESS',
				command: 'update',
				retryAt: expiresAt.toISOString(),
			},
		});
	});

	// Polling never blocks an operator: a command waits out a Live Results tick
	// for up to 10 s, but never another operator command, and a tick never waits.
	describe('waiting out a Live Results tick', () => {
		const startedAt = new Date('2026-01-01T00:00:00.000Z');
		const expiresAt = new Date('2026-01-01T00:15:00.000Z');

		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(startedAt);
		});

		afterEach(() => vi.useRealTimers());

		/** The active lease is `holder`'s until `releasedAfterMs`, then free. */
		function holdLease(holder: string, releasedAfterMs: number) {
			mockEventService.tryAcquireMeleeSyncLease.mockImplementation(async (input: { token: string; command: string; now: Date }) =>
				input.now.getTime() - startedAt.getTime() >= releasedAfterMs
					? {
							acquired: true,
							lease: { token: input.token, command: input.command, expiresAt },
						}
					: {
							acquired: false,
							activeLease: { command: holder, expiresAt },
						});
		}

		it.each([
			{
				case: 'an operator command waits for a tick that ends in 1 s',
				holder: 'live-results',
				command: 'update',
				releasedAfterMs: 1_000,
				settlesAtMs: 1_000,
				outcome: 'acquired',
			},
			{
				case: 'an operator command gives up on a tick held past 10 s',
				holder: 'live-results',
				command: 'update',
				releasedAfterMs: 60_000,
				settlesAtMs: 10_000,
				outcome: 409,
			},
			{
				case: 'configuration waits for a tick too',
				holder: 'live-results',
				command: 'configuration',
				releasedAfterMs: 500,
				settlesAtMs: 500,
				outcome: 'acquired',
			},
			{
				case: 'an operator command never waits for another operator command',
				holder: 'round',
				command: 'update',
				releasedAfterMs: 1_000,
				settlesAtMs: 0,
				outcome: 409,
			},
			{
				case: 'a tick never waits for another tick',
				holder: 'live-results',
				command: 'live-results',
				releasedAfterMs: 1_000,
				settlesAtMs: 0,
				outcome: 409,
			},
		] as const)('$case', async ({ holder, command, releasedAfterMs, settlesAtMs, outcome }) => {
			holdLease(holder, releasedAfterMs);

			const settled = acquireMeleeSyncLease(9, command, { token: 'operator-token' })
				.then(lease => ({ lease, at: Date.now() - startedAt.getTime() }))
				.catch((error: { statusCode: number; data: unknown }) => ({ error, at: Date.now() - startedAt.getTime() }));
			await vi.advanceTimersByTimeAsync(20_000);
			const result = await settled;

			expect(result.at).toBe(settlesAtMs);
			if (outcome === 'acquired') {
				expect(result).toMatchObject({
					lease: { token: 'operator-token', command },
				});
			}
			else {
				expect(result).toMatchObject({
					error: {
						statusCode: 409,
						data: { code: 'MELEE_SYNC_IN_PROGRESS', command: holder },
					},
				});
			}
		});
	});

	it('treats release failures as best-effort cleanup without logging the lease token', async () => {
		mockEventService.releaseMeleeSyncLease.mockRejectedValue(new Error('D1 unavailable'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(releaseMeleeSyncLease(9, 'private-lease-token')).resolves.toBe(false);

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('event 9'));
		expect(JSON.stringify(warn.mock.calls)).not.toContain('private-lease-token');
		warn.mockRestore();
	});

	it('renews the owning lease from the current time', async () => {
		mockEventService.renewMeleeSyncLease.mockResolvedValue(true);
		const now = new Date('2026-01-01T00:05:00.000Z');

		await expect(renewMeleeSyncLease(9, 'token', { now, durationMs: 60_000 })).resolves.toBe(true);
		expect(mockEventService.renewMeleeSyncLease).toHaveBeenCalledWith(
			9,
			'token',
			new Date('2026-01-01T00:06:00.000Z'),
		);
	});
});
