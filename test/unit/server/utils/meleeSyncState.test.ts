import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEventService = {
	tryAcquireMeleeSyncLease: vi.fn(),
	renewMeleeSyncLease: vi.fn(),
	releaseMeleeSyncLease: vi.fn(),
	updateSyncMetadata: vi.fn(),
	findById: vi.fn(),
};
const mockPublishMessage = vi.fn();
const mockGetOriginConnectionId = vi.fn();

vi.mock('~~/server/services/event', () => ({
	eventService: () => mockEventService,
}));

vi.mock('~~/server/utils/ably', () => ({
	getOriginConnectionId: mockGetOriginConnectionId,
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

describe('melee sync lease state', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventService.updateSyncMetadata.mockResolvedValue(true);
		mockEventService.findById.mockResolvedValue({ id: 9, talents: [] });
		mockGetOriginConnectionId.mockReturnValue('origin-1');
		mockPublishMessage.mockResolvedValue(undefined);
	});

	it('conditions successful metadata on the owning lease token before publication', async () => {
		const syncedAt = new Date('2026-01-01T00:05:00.000Z');

		await expect(recordMeleeSyncSuccess({} as any, 9, {
			lastPlayersSyncedAt: syncedAt,
		}, 'lease-token')).resolves.toBe(true);

		expect(mockEventService.updateSyncMetadata).toHaveBeenCalledWith(9, {
			lastPlayersSyncedAt: syncedAt,
			lastSyncError: null,
		}, 'lease-token');
		expect(mockPublishMessage).toHaveBeenCalledOnce();
	});

	it('does not publish when token-conditioned failure metadata loses ownership', async () => {
		mockEventService.updateSyncMetadata.mockResolvedValue(false);

		await expect(recordMeleeSyncFailure(
			{} as any,
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

		await recordMeleeSyncFailure({} as any, 9, error, {}, 'lease-token');

		expect(mockEventService.updateSyncMetadata).toHaveBeenCalledWith(9, {
			lastSyncError: 'Card data provider is temporarily unavailable. Existing deck data was preserved; retry the sync.',
		}, 'lease-token');
		expect(JSON.stringify(mockEventService.updateSyncMetadata.mock.calls)).not.toContain('secret upstream body');
	});

	it('does not persist messages from arbitrary errors carrying client-like status metadata', async () => {
		const error = Object.assign(new Error('library detail must remain private'), { statusCode: 400 });

		await recordMeleeSyncFailure({} as any, 9, error, {}, 'lease-token');

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

	it('releases through the token-guarded service operation', async () => {
		mockEventService.releaseMeleeSyncLease.mockResolvedValue(true);

		await expect(releaseMeleeSyncLease(9, 'token')).resolves.toBe(true);
		expect(mockEventService.releaseMeleeSyncLease).toHaveBeenCalledWith(9, 'token');
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
