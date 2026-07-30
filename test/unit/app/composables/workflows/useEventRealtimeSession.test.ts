import type { MessageType } from '~~/shared/types/messages';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { directChannelMessageTypes } from '~~/shared/types/messages';

type RealtimeHandlerMap = Record<string, (data: Record<string, unknown>) => void>;

function readSharedMessageTypes(): string[] {
	const filename = resolve(process.cwd(), 'shared/types/messages.ts');
	const sourceFile = ts.createSourceFile(
		filename,
		readFileSync(filename, 'utf8'),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);

	let messageTypes: string[] | null = null;
	sourceFile.forEachChild((node) => {
		if (!ts.isInterfaceDeclaration(node) || node.name.text !== 'MessageDefinitions')
			return;

		messageTypes = node.members
			.filter(ts.isPropertySignature)
			.map((member) => {
				if (ts.isStringLiteral(member.name) || ts.isIdentifier(member.name))
					return member.name.text;

				throw new Error(`Unsupported message definition key in ${filename}`);
			});
	});

	if (!messageTypes)
		throw new Error(`MessageDefinitions was not found in ${filename}`);

	return messageTypes;
}

describe('useEventRealtimeSession', () => {
	const mockResetAllEventStores = vi.fn();
	const mockNavigateTo = vi.fn();
	const realtime = {
		connectionId: 'connection-1',
		setRoom: vi.fn(),
		onRoom: vi.fn(),
		offRoom: vi.fn(),
	};

	const eventStore = {
		eventId: 12 as number | null,
		applyRemoteUpdated: vi.fn(),
		applyRemoteTalentCreated: vi.fn(),
		applyRemoteTalentUpdated: vi.fn(),
		applyRemoteTalentDeleted: vi.fn(),
	};
	const playerStore = {
		applyRemoteCreated: vi.fn(),
		applyRemoteUpdated: vi.fn(),
		applyRemoteDeleted: vi.fn(),
		loadPlayersByEventId: vi.fn(),
	};
	const playerDeckStore = {
		applyRemoteReviewed: vi.fn(),
		loadByEventId: vi.fn(),
	};
	const metagameStore = {
		applyRemoteInvalidated: vi.fn(),
	};
	const refreshMeleeStructureData = vi.fn();
	const refreshAfterMeleeReset = vi.fn();
	const archetypeStore = {
		applyRemoteCreated: vi.fn(),
		applyRemoteUpdated: vi.fn(),
		applyRemoteDeleted: vi.fn(),
		applyRemoteKeyCardsUpdated: vi.fn(),
	};
	const playerListStore = {
		applyRemoteCreated: vi.fn(),
		applyRemoteUpdated: vi.fn(),
		applyRemoteDeleted: vi.fn(),
		applyRemoteMembersChanged: vi.fn(),
	};
	const phaseStore = {
		applyRemoteCreated: vi.fn(),
		applyRemoteUpdated: vi.fn(),
		applyRemoteDeleted: vi.fn(),
		loadPhasesByEventId: vi.fn(),
	};
	const roundStore = {
		applyRemoteCreated: vi.fn(),
		applyRemoteUpdated: vi.fn(),
		applyRemoteDeleted: vi.fn(),
		loadRoundsByEventId: vi.fn(),
	};
	const matchStore = {
		applyRemoteCreated: vi.fn(),
		applyRemoteUpdated: vi.fn(),
		applyRemoteDeleted: vi.fn(),
		applyRemoteMatchesRefreshed: vi.fn(),
	};
	const featureMatchStore = {
		applyRemoteCreated: vi.fn(),
		applyRemoteUpdated: vi.fn(),
		applyRemoteDeleted: vi.fn(),
		applyRemoteReordered: vi.fn(),
		loadFeatureMatchesByEventId: vi.fn(),
	};
	const featureMatchStateStore = {
		applyRemoteSessionEvent: vi.fn(),
	};
	const broadcastGraphicsLiveSessionStore = {
		applyRemoteCommand: vi.fn(),
	};
	const screenStore = {
		applyRemoteCreated: vi.fn(),
		applyRemoteUpdated: vi.fn(),
		applyRemoteDeleted: vi.fn(),
	};
	const cardStore = {
		applyRemoteUpdated: vi.fn(),
		applyRemotePreview: vi.fn(),
		applyRemoteCleared: vi.fn(),
		applyRemoteTimeout: vi.fn(),
		applyRemoteTimeoutCancel: vi.fn(),
	};

	let watchCallback: ((eventId: number | null) => void) | undefined;
	let disposeCallback: (() => void) | undefined;

	function getHandlers(): RealtimeHandlerMap {
		return realtime.onRoom.mock.calls[0]![1] as RealtimeHandlerMap;
	}

	async function startSession(): Promise<RealtimeHandlerMap> {
		const { useEventRealtimeSession } = await import('~~/app/composables/workflows/useEventRealtimeSession');
		useEventRealtimeSession();
		return getHandlers();
	}

	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		eventStore.eventId = 12;
		playerStore.loadPlayersByEventId.mockResolvedValue(undefined);
		playerDeckStore.loadByEventId.mockResolvedValue(undefined);
		phaseStore.loadPhasesByEventId.mockResolvedValue(undefined);
		roundStore.loadRoundsByEventId.mockResolvedValue(undefined);
		featureMatchStore.loadFeatureMatchesByEventId.mockResolvedValue(undefined);
		matchStore.applyRemoteMatchesRefreshed.mockResolvedValue(undefined);
		refreshMeleeStructureData.mockResolvedValue(undefined);
		refreshAfterMeleeReset.mockResolvedValue(undefined);
		mockNavigateTo.mockResolvedValue(undefined);
		watchCallback = undefined;
		disposeCallback = undefined;

		vi.doMock('~/utils/eventStores', () => ({ resetAllEventStores: mockResetAllEventStores }));
		vi.stubGlobal('useRealtime', () => realtime);
		vi.stubGlobal('useEventStore', () => eventStore);
		vi.stubGlobal('usePlayerStore', () => playerStore);
		vi.stubGlobal('usePlayerDeckStore', () => playerDeckStore);
		vi.stubGlobal('useMetagameStore', () => metagameStore);
		vi.stubGlobal('useMeleeDataRefresh', () => ({ refreshMeleeStructureData, refreshAfterMeleeReset }));
		vi.stubGlobal('useArchetypeStore', () => archetypeStore);
		vi.stubGlobal('usePlayerListStore', () => playerListStore);
		vi.stubGlobal('usePhaseStore', () => phaseStore);
		vi.stubGlobal('useRoundStore', () => roundStore);
		vi.stubGlobal('useMatchStore', () => matchStore);
		vi.stubGlobal('useFeatureMatchStore', () => featureMatchStore);
		vi.stubGlobal('useFeatureMatchStateStore', () => featureMatchStateStore);
		vi.stubGlobal('useBroadcastGraphicsLiveSessionStore', () => broadcastGraphicsLiveSessionStore);
		vi.stubGlobal('useScreenStore', () => screenStore);
		vi.stubGlobal('useCardStore', () => cardStore);
		vi.stubGlobal('navigateTo', mockNavigateTo);
		vi.stubGlobal('watch', (source: () => number | null, callback: (eventId: number | null) => void, options?: { immediate?: boolean }) => {
			watchCallback = callback;
			if (options?.immediate)
				callback(source());
		});
		vi.stubGlobal('onScopeDispose', (callback: () => void) => {
			disposeCallback = callback;
		});
	});

	it('registers every shared event-room message type except direct channel commands', async () => {
		const handlers = await startSession();
		const expectedEventRoomTypes = readSharedMessageTypes()
			.filter(type => !directChannelMessageTypes.has(type as MessageType))
			.sort();

		expect(Object.keys(handlers).sort()).toEqual(expectedEventRoomTypes);
	});

	it('registers room handlers and enters the active event room', async () => {
		await startSession();

		expect(realtime.onRoom).toHaveBeenCalledOnce();
		expect(realtime.onRoom).toHaveBeenCalledWith('event-session', expect.objectContaining({
			'event:updated': expect.any(Function),
			'event:deleted': expect.any(Function),
			'player:updated': expect.any(Function),
			'melee:decklistsSynced': expect.any(Function),
		}));
		expect(realtime.setRoom).toHaveBeenCalledWith('event:12');
	});

	it('allows a new session after scope disposal', async () => {
		const { useEventRealtimeSession } = await import('~~/app/composables/workflows/useEventRealtimeSession');

		useEventRealtimeSession();
		disposeCallback?.();
		useEventRealtimeSession();

		expect(realtime.onRoom).toHaveBeenCalledTimes(2);
	});

	it('dispatches accepted messages to the owning stores', async () => {
		const handlers = await startSession();
		const message = { eventId: 12, originConnectionId: 'connection-2' };
		const directStoreHandlers: Record<string, ReturnType<typeof vi.fn>> = {
			'event:updated': eventStore.applyRemoteUpdated,
			'talent:created': eventStore.applyRemoteTalentCreated,
			'talent:updated': eventStore.applyRemoteTalentUpdated,
			'talent:deleted': eventStore.applyRemoteTalentDeleted,
			'player:created': playerStore.applyRemoteCreated,
			'player:updated': playerStore.applyRemoteUpdated,
			'player:deleted': playerStore.applyRemoteDeleted,
			'playerDeck:reviewed': playerDeckStore.applyRemoteReviewed,
			'archetype:created': archetypeStore.applyRemoteCreated,
			'archetype:updated': archetypeStore.applyRemoteUpdated,
			'archetype:deleted': archetypeStore.applyRemoteDeleted,
			'archetype:keyCardsUpdated': archetypeStore.applyRemoteKeyCardsUpdated,
			'playerList:created': playerListStore.applyRemoteCreated,
			'playerList:updated': playerListStore.applyRemoteUpdated,
			'playerList:deleted': playerListStore.applyRemoteDeleted,
			'playerList:membersChanged': playerListStore.applyRemoteMembersChanged,
			'phase:created': phaseStore.applyRemoteCreated,
			'phase:updated': phaseStore.applyRemoteUpdated,
			'phase:deleted': phaseStore.applyRemoteDeleted,
			'round:created': roundStore.applyRemoteCreated,
			'round:updated': roundStore.applyRemoteUpdated,
			'round:deleted': roundStore.applyRemoteDeleted,
			'round:matchesRefreshed': matchStore.applyRemoteMatchesRefreshed,
			'match:created': matchStore.applyRemoteCreated,
			'match:updated': matchStore.applyRemoteUpdated,
			'match:deleted': matchStore.applyRemoteDeleted,
			'featureMatch:created': featureMatchStore.applyRemoteCreated,
			'featureMatch:updated': featureMatchStore.applyRemoteUpdated,
			'featureMatch:deleted': featureMatchStore.applyRemoteDeleted,
			'featureMatch:reordered': featureMatchStore.applyRemoteReordered,
			'featureMatchSession:eventApplied': featureMatchStateStore.applyRemoteSessionEvent,
			'broadcastGraphicsLiveSession:commandApplied': broadcastGraphicsLiveSessionStore.applyRemoteCommand,
			'screen:created': screenStore.applyRemoteCreated,
			'screen:updated': screenStore.applyRemoteUpdated,
			'screen:deleted': screenStore.applyRemoteDeleted,
			'card:updated': cardStore.applyRemoteUpdated,
			'card:preview': cardStore.applyRemotePreview,
			'card:cleared': cardStore.applyRemoteCleared,
			'card:timeout': cardStore.applyRemoteTimeout,
			'card:timeout:cancel': cardStore.applyRemoteTimeoutCancel,
		};
		const extraHandledTypes = new Set([
			'event:deleted',
			'melee:dataReset',
			'melee:structureSynced',
			'melee:playersSynced',
			'melee:featureMatchesSynced',
			'melee:decklistsSynced',
			'melee:roundSynced',
		]);
		const invalidatingTypes = new Set([
			'player:created',
			'player:updated',
			'player:deleted',
			'playerDeck:reviewed',
			'archetype:created',
			'archetype:updated',
			'archetype:deleted',
			'archetype:keyCardsUpdated',
			'playerList:deleted',
			'playerList:membersChanged',
		]);
		const testedTypes = [...Object.keys(directStoreHandlers), ...extraHandledTypes].sort();

		expect(testedTypes).toEqual(Object.keys(handlers).sort());

		for (const [type, storeHandler] of Object.entries(directStoreHandlers)) {
			vi.clearAllMocks();

			handlers[type]!(message);

			expect(storeHandler).toHaveBeenCalledWith(message);
			if (invalidatingTypes.has(type))
				expect(metagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		}

		vi.clearAllMocks();
		handlers['melee:decklistsSynced']!(message);
		await Promise.resolve();

		expect(metagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		expect(playerStore.loadPlayersByEventId).toHaveBeenCalledWith(12);
		expect(featureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(12);
		expect(playerDeckStore.loadByEventId).toHaveBeenCalledWith(12);

		vi.clearAllMocks();
		handlers['melee:playersSynced']!(message);
		await Promise.resolve();

		expect(metagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		expect(playerStore.loadPlayersByEventId).toHaveBeenCalledWith(12);
		expect(featureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(12);

		vi.clearAllMocks();
		handlers['melee:structureSynced']!({
			...message,
			phaseCount: 2,
			roundCount: 8,
			changes: {
				phases: { created: [1], updated: [], deleted: [] },
				rounds: { created: [], updated: [2], deleted: [] },
			},
		});
		await vi.waitFor(() => {
			expect(refreshMeleeStructureData).toHaveBeenCalledWith(12);
		});

		vi.clearAllMocks();
		handlers['melee:dataReset']!({ ...message, reason: 'event-changed' });
		await vi.waitFor(() => {
			expect(refreshAfterMeleeReset).toHaveBeenCalledWith(12);
		});

		vi.clearAllMocks();
		handlers['melee:featureMatchesSynced']!({ ...message, slotIds: [4, 5] });
		await vi.waitFor(() => {
			expect(featureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(12);
		});

		vi.clearAllMocks();
		const roundMessage = {
			...message,
			roundId: 3,
			matchCount: 4,
			created: 2,
			updated: 1,
			staleDeleted: 1,
		};
		handlers['melee:roundSynced']!(roundMessage);
		await vi.waitFor(() => {
			expect(roundStore.loadRoundsByEventId).toHaveBeenCalledWith(12);
			expect(matchStore.applyRemoteMatchesRefreshed).toHaveBeenCalledWith(roundMessage);
			expect(featureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(12);
		});
	});

	it('resets event state and navigates home when the active event is deleted', async () => {
		const handlers = await startSession();
		realtime.setRoom.mockClear();

		handlers['event:deleted']!({ eventId: 12 });

		expect(realtime.setRoom).toHaveBeenCalledWith(null);
		expect(mockResetAllEventStores).toHaveBeenCalledOnce();
		expect(mockNavigateTo).toHaveBeenCalledWith('/');
	});

	it('catches and logs sync realtime handler errors', async () => {
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = new Error('player update failed');
		playerStore.applyRemoteUpdated.mockImplementationOnce(() => {
			throw error;
		});
		const handlers = await startSession();

		handlers['player:updated']!({ eventId: 12, originConnectionId: 'connection-2' });

		expect(consoleSpy).toHaveBeenCalledWith(
			'Failed to handle realtime message "player:updated":',
			error,
		);
		consoleSpy.mockRestore();
	});

	it('updates and clears the active room through the event watcher', async () => {
		await startSession();

		// Room changes are synchronous — the transport owns token scoping, so
		// the stale-switch races the old authorize-then-join dance guarded
		// against are unrepresentable here (covered by the transport's tests).
		eventStore.eventId = 34;
		watchCallback?.(34);
		expect(realtime.setRoom).toHaveBeenCalledWith('event:34');

		eventStore.eventId = null;
		watchCallback?.(null);
		expect(realtime.setRoom).toHaveBeenCalledWith(null);
	});

	it('cleans up room handlers on scope disposal', async () => {
		await startSession();

		disposeCallback?.();

		expect(realtime.offRoom).toHaveBeenCalledWith('event-session');
		expect(realtime.setRoom).toHaveBeenCalledWith(null);
	});
});
