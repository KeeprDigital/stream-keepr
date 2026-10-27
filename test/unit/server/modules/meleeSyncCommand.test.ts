import type { H3Event } from 'h3';
import type { MeleeSyncContext } from '~~/server/modules/melee-sync/context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadEventData = vi.fn();
const mockAcquireLease = vi.fn();
const mockReleaseLease = vi.fn();
const mockRenewLease = vi.fn();
const mockRecordSuccess = vi.fn();
const mockRecordFailure = vi.fn();
const mockWorkflows = {
	runInitialSetup: vi.fn(),
	syncEventStructure: vi.fn(),
	syncPlayers: vi.fn(),
	syncDeckLists: vi.fn(),
	syncRoundMatches: vi.fn(),
	updateFromMelee: vi.fn(),
};

vi.mock('~~/server/modules/melee-sync/configuration', () => ({
	updateMeleeConfiguration: vi.fn(),
}));
vi.mock('~~/server/modules/melee-sync/eventData', () => ({
	requireMeleeSyncEventData: mockLoadEventData,
}));

vi.mock('~~/server/modules/melee-sync/workflows', () => ({
	createMeleeSyncWorkflows: () => mockWorkflows,
}));

vi.mock('~~/server/utils/ably', () => ({
	getOriginConnectionId: () => 'origin-1',
}));

vi.mock('~~/server/utils/meleeSyncState', () => ({
	acquireMeleeSyncLease: mockAcquireLease,
	MELEE_SYNC_LEASE_RENEW_INTERVAL_MS: 60_000,
	recordMeleeSyncFailure: mockRecordFailure,
	recordMeleeSyncSuccess: mockRecordSuccess,
	releaseMeleeSyncLease: mockReleaseLease,
	renewMeleeSyncLease: mockRenewLease,
}));

const { meleeSyncModule } = await import('~~/server/modules/melee-sync');

const requestEvent = {} as H3Event;
// What every command hands workflows and status recording, read from the request.
const ctx: MeleeSyncContext = { originConnectionId: 'origin-1' };
const eventData = {
	id: 1,
	game: 'mtg' as const,
	meleeEnabled: true,
	meleeEventId: 'melee-event-1',
	meleeClientId: 'client-id',
	meleeClientSecret: 'client-secret',
	initialSetupCompletedAt: null,
	lastEventSyncedAt: null,
	lastPlayersSyncedAt: null,
	lastDecklistsSyncedAt: null,
};

describe('melee sync command boundary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadEventData.mockResolvedValue(eventData);
		mockAcquireLease.mockResolvedValue({
			token: 'lease-token',
			command: 'update',
			expiresAt: new Date('2026-01-01T00:15:00.000Z'),
		});
		mockReleaseLease.mockResolvedValue(true);
		mockRenewLease.mockResolvedValue(true);
		mockRecordSuccess.mockResolvedValue(true);
		mockRecordFailure.mockResolvedValue(true);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const at = expect.any(Date);
	const playersResult = {
		success: true,
		results: {
			created: 0,
			updated: 1,
			deactivated: 0,
			matchesUpdated: 0,
			errors: [],
		},
	};

	describe('the sync times a successful command records', () => {
		it.each([
			[
				'an update',
				'updateFromMelee',
				'update',
				[],
				{
					success: true,
					steps: ['structure', 'players', 'decklists'],
				},
				{ lastEventSyncedAt: at, lastPlayersSyncedAt: at, lastDecklistsSyncedAt: at },
			],
			[
				'an update whose game has no Deck List adapter',
				'updateFromMelee',
				'update',
				[
					{ includeDeckLists: true },
				],
				{
					success: true,
					steps: ['structure', 'players', 'decklists'],
					deckListsSkipped: true,
				},
				{ lastEventSyncedAt: at, lastPlayersSyncedAt: at },
			],
			[
				'initial setup',
				'runInitialSetup',
				'initial-setup',
				[],
				{ success: true },
				{
					initialSetupCompletedAt: at,
					lastEventSyncedAt: at,
					lastPlayersSyncedAt: at,
					lastDecklistsSyncedAt: at,
				},
			],
			[
				'initial setup whose game has no Deck List adapter',
				'runInitialSetup',
				'initial-setup',
				[],
				{ success: true, deckListsSkipped: true },
				{ initialSetupCompletedAt: at, lastEventSyncedAt: at, lastPlayersSyncedAt: at },
			],
			[
				'a standalone Deck List sync, which never completes setup',
				'syncDeckLists',
				'decklists',
				[],
				{ success: true, warnings: [] },
				{ lastDecklistsSyncedAt: at },
			],
			[
				'a Deck List sync the adapter skipped',
				'syncDeckLists',
				'decklists',
				[],
				{ success: true, skipped: true, warnings: [] },
				{},
			],
		] as const)('%s', async (_label, command, lease, args, workflowResult, recorded) => {
			mockWorkflows[command].mockResolvedValue(workflowResult);

			await (meleeSyncModule() as any)[command](requestEvent, 1, ...args);

			expect(mockAcquireLease).toHaveBeenCalledWith(1, lease);
			expect(mockRecordSuccess).toHaveBeenCalledWith(ctx, 1, recorded, 'lease-token');
			expect(mockRecordFailure).not.toHaveBeenCalled();
			expect(mockReleaseLease).toHaveBeenCalledWith(1, 'lease-token');
		});
	});

	it.each([
		[
			'initial setup',
			'runInitialSetup',
			{
				success: false,
				warnings: ['Deck list sync skipped 1 player'],
			},
			'Deck list sync skipped 1 player',
		],
		[
			'an update',
			'updateFromMelee',
			{
				success: false,
				steps: ['structure', 'players', 'decklists'],
				message: 'Updated event data with deck list warnings',
			},
			'Updated event data with deck list warnings',
		],
	] as const)('records a partial %s as one failure that advances structure and Players, not Deck Lists or setup', async (_label, command, workflowResult, message) => {
		mockWorkflows[command].mockResolvedValue(workflowResult);

		await expect((meleeSyncModule() as any)[command](requestEvent, 1)).resolves.toMatchObject({ success: false });

		expect(mockRecordSuccess).not.toHaveBeenCalled();
		expect(mockRecordFailure).toHaveBeenCalledOnce();
		expect(mockRecordFailure).toHaveBeenCalledWith(ctx, 1, expect.objectContaining({ message }), { lastEventSyncedAt: at, lastPlayersSyncedAt: at }, 'lease-token');
	});

	it('loads credentials only after acquiring the command lease', async () => {
		mockWorkflows.syncPlayers.mockResolvedValue(playersResult);

		await meleeSyncModule().syncPlayers(requestEvent, 1);

		expect(mockAcquireLease.mock.invocationCallOrder[0]).toBeLessThan(mockLoadEventData.mock.invocationCallOrder[0]!);
		expect(mockLoadEventData.mock.invocationCallOrder[0]).toBeLessThan(mockWorkflows.syncPlayers.mock.invocationCallOrder[0]!);
	});

	it('refreshes Players then one Round under a single round lease, keeping both warnings', async () => {
		mockWorkflows.syncPlayers.mockResolvedValue({
			...playersResult,
			warnings: ['Player notification delayed'],
		});
		mockWorkflows.syncRoundMatches.mockResolvedValue({
			success: true,
			warnings: ['One deck was unresolved'],
			round: { id: 10 },
			matchCount: 3,
		});

		const result = await meleeSyncModule().syncRoundMatches(requestEvent, 1, 10);

		expect(mockAcquireLease).toHaveBeenCalledOnce();
		expect(mockAcquireLease).toHaveBeenCalledWith(1, 'round');
		expect(mockWorkflows.syncPlayers.mock.invocationCallOrder[0]).toBeLessThan(mockWorkflows.syncRoundMatches.mock.invocationCallOrder[0]!);
		expect(result.warnings).toEqual(['Player notification delayed', 'One deck was unresolved']);
		expect(mockRecordSuccess).toHaveBeenCalledWith(ctx, 1, { lastPlayersSyncedAt: at }, 'lease-token');
	});

	it('records one failure and releases the lease when execution throws', async () => {
		const upstreamError = new Error('Melee unavailable');
		mockWorkflows.syncPlayers.mockRejectedValue(upstreamError);

		await expect(meleeSyncModule().syncPlayers(requestEvent, 1)).rejects.toBe(upstreamError);

		expect(mockRecordFailure).toHaveBeenCalledOnce();
		expect(mockRecordFailure).toHaveBeenCalledWith(ctx, 1, upstreamError, {}, 'lease-token');
		expect(mockRecordSuccess).not.toHaveBeenCalled();
		expect(mockReleaseLease).toHaveBeenCalledWith(1, 'lease-token');
	});

	it('records committed Player progress when the later Round write fails', async () => {
		const roundError = new Error('Melee Round Matches unavailable');
		mockWorkflows.syncPlayers.mockResolvedValue({
			success: true,
			results: {
				created: 0,
				updated: 2,
				deactivated: 0,
				matchesUpdated: 0,
				errors: [],
			},
		});
		mockWorkflows.syncRoundMatches.mockRejectedValue(roundError);

		await expect(meleeSyncModule().syncRoundMatches(requestEvent, 1, 10)).rejects.toBe(roundError);

		expect(mockRecordFailure).toHaveBeenCalledWith(ctx, 1, roundError, {
			lastPlayersSyncedAt: expect.any(Date),
		}, 'lease-token');
		expect(mockRecordSuccess).not.toHaveBeenCalled();
	});

	it('records completed setup steps when a later setup step throws', async () => {
		const deckError = new Error('Deck import failed');
		const structureAt = new Date('2026-02-01T00:00:00.000Z');
		const playersAt = new Date('2026-02-01T00:01:00.000Z');
		mockWorkflows.runInitialSetup.mockImplementation(async (
			_ctx: MeleeSyncContext,
			_eventId: number,
			_eventData: typeof eventData,
			_checkpoint: () => Promise<void>,
			recordProgress: (metadata: Record<string, Date>) => void,
		) => {
			recordProgress({ lastEventSyncedAt: structureAt });
			recordProgress({ lastPlayersSyncedAt: playersAt });
			throw deckError;
		});

		await expect(meleeSyncModule().runInitialSetup(requestEvent, 1)).rejects.toBe(deckError);

		expect(mockRecordFailure).toHaveBeenCalledWith(ctx, 1, deckError, {
			lastEventSyncedAt: structureAt,
			lastPlayersSyncedAt: playersAt,
		}, 'lease-token');
		expect(mockRecordFailure.mock.calls[0]?.[3]).not.toHaveProperty('lastDecklistsSyncedAt');
		expect(mockRecordFailure.mock.calls[0]?.[3]).not.toHaveProperty('initialSetupCompletedAt');
	});

	it('records completed update steps when a later update step throws', async () => {
		const roundError = new Error('Round refresh failed');
		const structureAt = new Date('2026-02-02T00:00:00.000Z');
		const playersAt = new Date('2026-02-02T00:01:00.000Z');
		const deckListsAt = new Date('2026-02-02T00:02:00.000Z');
		mockWorkflows.updateFromMelee.mockImplementation(async (
			_ctx: MeleeSyncContext,
			_eventId: number,
			_eventData: typeof eventData,
			_options: { includeDeckLists?: boolean },
			_checkpoint: () => Promise<void>,
			recordProgress: (metadata: Record<string, Date>) => void,
		) => {
			recordProgress({ lastEventSyncedAt: structureAt });
			recordProgress({ lastPlayersSyncedAt: playersAt });
			recordProgress({ lastDecklistsSyncedAt: deckListsAt });
			throw roundError;
		});

		await expect(meleeSyncModule().updateFromMelee(requestEvent, 1, { includeDeckLists: true })).rejects.toBe(roundError);

		expect(mockRecordFailure).toHaveBeenCalledWith(ctx, 1, roundError, {
			lastEventSyncedAt: structureAt,
			lastPlayersSyncedAt: playersAt,
			lastDecklistsSyncedAt: deckListsAt,
		}, 'lease-token');
		expect(mockRecordFailure.mock.calls[0]?.[3]).not.toHaveProperty('initialSetupCompletedAt');
	});

	it('renews the owned lease while a long-running command is still executing', async () => {
		vi.useFakeTimers();
		let completeWorkflow!: (result: { success: true; players: number; errors: never[] }) => void;
		mockWorkflows.syncPlayers.mockReturnValue(new Promise((resolve) => {
			completeWorkflow = resolve;
		}));

		const command = meleeSyncModule().syncPlayers(requestEvent, 1);
		await vi.advanceTimersByTimeAsync(60_000);

		expect(mockRenewLease).toHaveBeenCalledWith(1, 'lease-token');
		expect(mockReleaseLease).not.toHaveBeenCalled();

		completeWorkflow({ success: true, players: 2, errors: [] });
		await expect(command).resolves.toEqual({ success: true, players: 2, errors: [] });
		expect(mockRecordSuccess).toHaveBeenCalledOnce();
		expect(mockReleaseLease).toHaveBeenCalledWith(1, 'lease-token');
	});

	it('fails safely when a heartbeat discovers that lease ownership was lost', async () => {
		vi.useFakeTimers();
		mockRenewLease.mockResolvedValue(false);
		let completeWorkflow!: (result: { success: true; players: number; errors: never[] }) => void;
		mockWorkflows.syncPlayers.mockReturnValue(new Promise((resolve) => {
			completeWorkflow = resolve;
		}));

		const command = meleeSyncModule().syncPlayers(requestEvent, 1);
		await vi.advanceTimersByTimeAsync(60_000);
		completeWorkflow({ success: true, players: 2, errors: [] });

		await expect(command).rejects.toThrow('lease ownership was lost');
		expect(mockRecordSuccess).not.toHaveBeenCalled();
		expect(mockRecordFailure).toHaveBeenCalledWith(
			ctx,
			1,
			expect.objectContaining({ message: 'Melee sync lease ownership was lost while the command was running' }),
			{},
			'lease-token',
		);
		// Release remains token-guarded, so this stale command cannot clear a replacement lease.
		expect(mockReleaseLease).toHaveBeenCalledWith(1, 'lease-token');
	});

	it('checks ownership again before metadata when a short command finishes between heartbeats', async () => {
		mockRenewLease.mockResolvedValue(false);
		mockWorkflows.syncPlayers.mockResolvedValue({ success: true, players: 2, errors: [] });

		await expect(meleeSyncModule().syncPlayers(requestEvent, 1)).rejects.toThrow('lease ownership was lost');

		expect(mockRenewLease).toHaveBeenCalledOnce();
		expect(mockRecordSuccess).not.toHaveBeenCalled();
		expect(mockRecordFailure).toHaveBeenCalledWith(
			ctx,
			1,
			expect.objectContaining({ message: 'Melee sync lease ownership was lost while the command was running' }),
			{},
			'lease-token',
		);
		expect(mockReleaseLease).toHaveBeenCalledWith(1, 'lease-token');
	});

	it('fails safely when the token-conditioned metadata update loses its compare-and-set race', async () => {
		mockRecordSuccess.mockResolvedValue(false);
		mockWorkflows.syncPlayers.mockResolvedValue({ success: true, players: 2, errors: [] });

		await expect(meleeSyncModule().syncPlayers(requestEvent, 1)).rejects.toThrow('lease ownership was lost');

		expect(mockRenewLease).toHaveBeenCalledWith(1, 'lease-token');
		expect(mockRecordSuccess).toHaveBeenCalledWith(
			ctx,
			1,
			{
				lastPlayersSyncedAt: expect.any(Date),
			},
			'lease-token',
		);
		expect(mockRecordFailure).not.toHaveBeenCalled();
		expect(mockReleaseLease).toHaveBeenCalledWith(1, 'lease-token');
	});

	it('returns a lease conflict without executing or mutating sync status', async () => {
		const conflict = Object.assign(new Error('Melee sync command "update" is already running for this event'), {
			statusCode: 409,
			data: { code: 'MELEE_SYNC_IN_PROGRESS' },
		});
		mockAcquireLease.mockRejectedValue(conflict);

		await expect(meleeSyncModule().syncPlayers(requestEvent, 1)).rejects.toBe(conflict);

		expect(mockWorkflows.syncPlayers).not.toHaveBeenCalled();
		expect(mockRecordSuccess).not.toHaveBeenCalled();
		expect(mockRecordFailure).not.toHaveBeenCalled();
		expect(mockReleaseLease).not.toHaveBeenCalled();
	});
});
