import type { BroadcastGraphicsLiveSessionResponse } from '~~/shared/types/broadcastGraphicsLiveSession';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { MessageData } from '~/types/realtime';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const mockRepository = {
	getSession: vi.fn(),
	sendCommand: vi.fn(),
};

vi.mock('~/composables/repositories/useBroadcastGraphicsLiveSessionRepository', () => ({
	useBroadcastGraphicsLiveSessionRepository: () => mockRepository,
}));

// Mirrors the real composable: failures land in the caller's error ref rather
// than propagating, so the store's own error handling is what these tests see.
mockNuxtImport('useAsyncAction', () => () => ({
	executeAction: vi.fn(async (
		action: () => Promise<unknown>,
		options?: { loadingRef?: { value: boolean }; errorRef?: { value: string | null } },
	) => {
		if (options?.loadingRef)
			options.loadingRef.value = true;
		if (options?.errorRef)
			options.errorRef.value = null;
		try {
			return await action();
		}
		catch (e: unknown) {
			if (options?.errorRef)
				options.errorRef.value = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'An error occurred';
			return null;
		}
		finally {
			if (options?.loadingRef)
				options.loadingRef.value = false;
		}
	}),
}));

/**
 * The installation-wide server clock, stubbed so a test can put this browser a known
 * distance from the authoritative one — and can hold it unsynced, which is the state
 * every output is in for the first moments after it loads.
 */
const mockServerTimeOffset = ref(0);
const mockClockSynced = ref(true);

mockNuxtImport('useServerTime', () => () => ({
	serverTimeOffset: mockServerTimeOffset,
	isSynced: mockClockSynced,
	lastSyncedAt: ref(null),
	getServerTime: () => Date.now() + mockServerTimeOffset.value,
	sync: vi.fn(),
	startSync: vi.fn(),
	stopSync: vi.fn(),
}));

const EVENT_ID = 12;
const SCREEN_ID = 3;

function session(overrides: Partial<BroadcastGraphicsLiveSessionResponse> = {}): BroadcastGraphicsLiveSessionResponse {
	return {
		id: 55,
		eventId: EVENT_ID,
		screenId: SCREEN_ID,
		status: 'active',
		currentState: { playout: {}, inputs: {} },
		sequence: 1,
		endedAt: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		...overrides,
	};
}

/** A placed Broadcast Graphic with no authored animation: every phase immediate. */
function graphic(id: string, animation?: BroadcastGraphicConfig['animation']): BroadcastGraphicConfig {
	return { id, name: id, items: [], animation };
}

function notification(
	overrides: Partial<MessageData<'broadcastGraphicsLiveSession:commandApplied'>> = {},
): MessageData<'broadcastGraphicsLiveSession:commandApplied'> {
	return {
		eventId: EVENT_ID,
		timestamp: 1_000,
		screenId: SCREEN_ID,
		sessionId: 55,
		sequence: 2,
		commandType: 'Take',
		currentState: { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} },
		...overrides,
	} as MessageData<'broadcastGraphicsLiveSession:commandApplied'>;
}

describe('broadcastGraphicsLiveSessionStore', () => {
	let store: ReturnType<typeof useBroadcastGraphicsLiveSessionStore>;

	beforeEach(() => {
		store = useBroadcastGraphicsLiveSessionStore();
		store.$reset();
		vi.clearAllMocks();
		mockRepository.getSession.mockResolvedValue(session());
	});

	it('derives Graphic Playout State and the on-air stack from the loaded snapshot', async () => {
		mockRepository.getSession.mockResolvedValue(session({
			currentState: { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false }, bug: { onAir: false, effectiveStartedAt: 0, cut: false } }, inputs: {} },
		}));

		await store.loadSession(EVENT_ID, SCREEN_ID);

		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('on-air');
		expect(store.playoutState(SCREEN_ID, 'bug')).toBe('off');
		expect(store.onAirGraphicIds(SCREEN_ID, [graphic('bug'), graphic('slate')])).toEqual(['slate']);
	});

	it('reports every Broadcast Graphic off before any snapshot has loaded', () => {
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('off');
		expect(store.onAirGraphicIds(SCREEN_ID, [graphic('slate')])).toEqual([]);
	});

	it('sends a Take naming the loaded epoch, and keeps the returned snapshot', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		mockRepository.sendCommand.mockResolvedValue({
			screenId: SCREEN_ID,
			sessionId: 55,
			sequence: 2,
			commandType: 'Take',
			currentState: { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} },
			session: session({ sequence: 2, currentState: { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} } }),
		});

		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		expect(mockRepository.sendCommand).toHaveBeenCalledWith(EVENT_ID, SCREEN_ID, 55, expect.objectContaining({
			type: 'Take',
			payload: { graphicId: 'slate', cut: false },
		}));
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('on-air');
	});

	it('marks an Out as a Cut when the operator asked for one', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		mockRepository.sendCommand.mockResolvedValue({
			screenId: SCREEN_ID,
			sessionId: 55,
			sequence: 2,
			commandType: 'Out',
			currentState: { playout: {}, inputs: {} },
			session: session({ sequence: 2 }),
		});

		await store.out(EVENT_ID, SCREEN_ID, 'slate', true);

		expect(mockRepository.sendCommand).toHaveBeenCalledWith(EVENT_ID, SCREEN_ID, 55, expect.objectContaining({
			type: 'Out',
			payload: { graphicId: 'slate', cut: true },
		}));
	});

	it('names two separate operator intents distinctly, so neither suppresses the other', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		mockRepository.sendCommand.mockResolvedValue({
			screenId: SCREEN_ID,
			sessionId: 55,
			sequence: 2,
			commandType: 'Take',
			currentState: { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} },
			session: session({ sequence: 2 }),
		});

		// Two presses are two intents. Sharing an id would make the receipt store
		// answer the second with the first one's outcome.
		await store.take(EVENT_ID, SCREEN_ID, 'slate');
		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		const [first, second] = mockRepository.sendCommand.mock.calls.map(call => call[3].commandId);
		expect(first).not.toBe(second);
	});

	it('reuses the command id when it restates one intent against the current epoch', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();
		mockRepository.sendCommand
			.mockRejectedValueOnce({ statusCode: 409, message: 'Broadcast graphics live session has ended' })
			.mockResolvedValueOnce({
				screenId: SCREEN_ID,
				sessionId: 56,
				sequence: 2,
				commandType: 'Take',
				currentState: { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} },
				session: session({ id: 56, sequence: 2 }),
			});
		mockRepository.getSession.mockResolvedValue(session({ id: 56, sequence: 1 }));

		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		// One press is one intent however many times it has to be delivered, so the
		// retry carries the same command id. A fresh id would defeat the receipt
		// that exists to recognise it: were the first attempt to have landed after
		// all, the retry would be accepted a second time rather than answered with
		// the outcome it already had.
		const [first, retried] = mockRepository.sendCommand.mock.calls.map(call => call[3].commandId);
		expect(retried).toBe(first);
	});

	it('reloads and retries once when the epoch it cached has already ended', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();

		// The Screen left and re-entered Broadcast Graphics mode out of band, so the
		// epoch this client holds is gone.
		mockRepository.sendCommand
			.mockRejectedValueOnce({ statusCode: 409, message: 'Broadcast graphics live session has ended' })
			.mockResolvedValueOnce({
				screenId: SCREEN_ID,
				sessionId: 56,
				sequence: 2,
				commandType: 'Take',
				currentState: { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} },
				session: session({ id: 56, sequence: 2, currentState: { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} } }),
			});
		mockRepository.getSession.mockResolvedValue(session({ id: 56, sequence: 1 }));

		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		expect(mockRepository.getSession).toHaveBeenCalledOnce();
		expect(mockRepository.sendCommand.mock.calls.map(call => call[2])).toEqual([55, 56]);
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('on-air');
		expect(store.error).toBeNull();
	});

	it('surfaces the failure when the retry against the current epoch also fails', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();
		mockRepository.sendCommand.mockRejectedValue({ statusCode: 409, message: 'Screen is not in Broadcast Graphics mode' });
		mockRepository.getSession.mockResolvedValue(session({ id: 56 }));

		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		expect(mockRepository.sendCommand).toHaveBeenCalledTimes(2);
		expect(store.error).toMatch(/Broadcast Graphics mode/);
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('off');
	});

	it('does not retry a failure that is not a conflict', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();
		mockRepository.sendCommand.mockRejectedValue({ statusCode: 500, message: 'Internal Server Error' });

		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		expect(mockRepository.sendCommand).toHaveBeenCalledOnce();
		expect(mockRepository.getSession).not.toHaveBeenCalled();
		expect(store.error).toBe('Internal Server Error');
	});

	it('reports a Broadcast Graphic as pending only while its own action is in flight', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		let release: (value: unknown) => void = () => {};
		mockRepository.sendCommand.mockImplementation(() => new Promise((resolve) => {
			release = resolve;
		}));

		const inFlight = store.take(EVENT_ID, SCREEN_ID, 'slate');
		await Promise.resolve();

		expect(store.isPending(SCREEN_ID, 'slate')).toBe(true);
		expect(store.isPending(SCREEN_ID, 'bug')).toBe(false);

		release({
			screenId: SCREEN_ID,
			sessionId: 55,
			sequence: 2,
			commandType: 'Take',
			currentState: { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} },
			session: session({ sequence: 2, currentState: { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} } }),
		});
		await inFlight;

		expect(store.isPending(SCREEN_ID, 'slate')).toBe(false);
	});

	it('clears the pending marker even when the action fails', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		mockRepository.sendCommand.mockRejectedValue({ statusCode: 500, message: 'boom' });

		await store.take(EVENT_ID, SCREEN_ID, 'slate');

		expect(store.isPending(SCREEN_ID, 'slate')).toBe(false);
	});

	it('follows a notification that continues the sequence it already holds', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();

		await store.applyRemoteCommand(notification());

		expect(mockRepository.getSession).not.toHaveBeenCalled();
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('on-air');
	});

	it('ignores a notification the authoritative sequence has already passed', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		await store.applyRemoteCommand(notification());
		vi.clearAllMocks();

		await store.applyRemoteCommand(notification({
			sequence: 2,
			currentState: { playout: { slate: { onAir: false, effectiveStartedAt: 0, cut: false } }, inputs: {} },
		}));

		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('on-air');
	});

	it('reloads the authoritative snapshot when it has fallen behind the sequence', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();
		mockRepository.getSession.mockResolvedValue(session({
			sequence: 9,
			currentState: { playout: { bug: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} },
		}));

		// A disconnect swallowed sequences 2 through 8: the notification is not
		// authority, so the snapshot is what resolves the gap.
		await store.applyRemoteCommand(notification({ sequence: 9 }));

		expect(mockRepository.getSession).toHaveBeenCalledWith(EVENT_ID, SCREEN_ID);
		expect(store.playoutState(SCREEN_ID, 'bug')).toBe('on-air');
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('off');
	});

	it('reloads rather than trusting a notification from a different Live Session epoch', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();
		mockRepository.getSession.mockResolvedValue(session({ id: 56, sequence: 1 }));

		await store.applyRemoteCommand(notification({ sessionId: 56, sequence: 2 }));

		expect(mockRepository.getSession).toHaveBeenCalledWith(EVENT_ID, SCREEN_ID);
		expect(store.playoutState(SCREEN_ID, 'slate')).toBe('off');
	});

	it('reloads when a notification arrives for a Screen it has never loaded', async () => {
		await store.applyRemoteCommand(notification());

		expect(mockRepository.getSession).toHaveBeenCalledWith(EVENT_ID, SCREEN_ID);
	});

	it('edits one Graphic Input as its own command, so the server can share the working value', async () => {
		await store.loadSession(EVENT_ID, SCREEN_ID);
		mockRepository.sendCommand.mockResolvedValue({
			screenId: SCREEN_ID,
			sessionId: 55,
			sequence: 2,
			commandType: 'Set Input',
			currentState: { playout: {}, inputs: {} },
			session: session({ sequence: 2 }),
		});

		await store.setInput(EVENT_ID, SCREEN_ID, 'slate', 'name', 'Ava Reed');

		expect(mockRepository.sendCommand).toHaveBeenCalledWith(EVENT_ID, SCREEN_ID, 55, expect.objectContaining({
			type: 'Set Input',
			payload: { graphicId: 'slate', inputKey: 'name', value: 'Ava Reed' },
		}));
	});

	it('names the acceptance it supersedes when it accepts a staged Graphic Input set', async () => {
		mockRepository.getSession.mockResolvedValue(session({
			currentState: {
				playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } },
				inputs: { slate: { working: { name: 'Ava Reed' }, accepted: { name: 'Unnamed' }, acceptedRevision: 4 } },
			},
		}));
		await store.loadSession(EVENT_ID, SCREEN_ID);
		const accepted = {
			playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } },
			inputs: { slate: { working: { name: 'Ava Reed' }, accepted: { name: 'Ava Reed' }, acceptedRevision: 5 } },
		};
		mockRepository.sendCommand.mockResolvedValue({
			screenId: SCREEN_ID,
			sessionId: 55,
			sequence: 2,
			commandType: 'Update Graphic',
			currentState: accepted,
			session: session({ sequence: 2, currentState: accepted }),
		});

		await store.updateGraphic(EVENT_ID, SCREEN_ID, 'slate');
		await store.updateGraphic(EVENT_ID, SCREEN_ID, 'slate', true);

		// Two presses are two intents, and each supersedes the acceptance current when
		// it was pressed — the second one names the acceptance the first produced.
		expect(mockRepository.sendCommand.mock.calls.map(call => call[3].payload)).toEqual([
			{ graphicId: 'slate', cut: false, basedOnAcceptedRevision: 4 },
			{ graphicId: 'slate', cut: true, basedOnAcceptedRevision: 5 },
		]);
	});

	it('restates one Update Graphic unchanged — same command id, same acceptance revision', async () => {
		mockRepository.getSession.mockResolvedValue(session({
			currentState: {
				playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } },
				inputs: { slate: { working: { name: 'Ava Reed' }, accepted: {}, acceptedRevision: 4 } },
			},
		}));
		await store.loadSession(EVENT_ID, SCREEN_ID);
		vi.clearAllMocks();
		mockRepository.sendCommand
			.mockRejectedValueOnce({ statusCode: 409, message: 'Broadcast graphics live session has ended' })
			.mockResolvedValueOnce({
				screenId: SCREEN_ID,
				sessionId: 56,
				sequence: 2,
				commandType: 'Update Graphic',
				currentState: { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} },
				session: session({ id: 56, sequence: 2 }),
			});
		// The reload the retry goes through reports a *different* acceptance revision.
		mockRepository.getSession.mockResolvedValue(session({
			id: 56,
			currentState: {
				playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } },
				inputs: { slate: { working: {}, accepted: {}, acceptedRevision: 9 } },
			},
		}));

		await store.updateGraphic(EVENT_ID, SCREEN_ID, 'slate');

		// One press is one intent, however many times it has to be delivered. Both the
		// command id and the acceptance it supersedes are part of that intent: a fresh
		// id would defeat the receipt that recognises the repeat, and re-reading the
		// revision inside the retry would re-base the sequence guard onto whatever
		// landed in the meantime and stop it protecting the colleague it exists for.
		const [first, retried] = mockRepository.sendCommand.mock.calls.map(call => call[3]);
		expect(retried.commandId).toBe(first.commandId);
		expect(retried.payload).toEqual(first.payload);
		expect(first.payload.basedOnAcceptedRevision).toBe(4);
	});
});

describe('the authoritative clock a Screen Output projects on', () => {
	let store: ReturnType<typeof useBroadcastGraphicsLiveSessionStore>;

	/** A one-second enter, so a phase boundary is something a test can stand either side of. */
	const FADE_IN = {
		enter: { duration: 1000, easing: 'linear' as const, delay: 0, fade: { opacity: 0 } },
	};
	const FADE_OUT = {
		exit: { duration: 1000, easing: 'linear' as const, delay: 0, fade: { opacity: 0 } },
	};

	beforeEach(() => {
		store = useBroadcastGraphicsLiveSessionStore();
		store.$reset();
		vi.clearAllMocks();
		mockRepository.getSession.mockResolvedValue(session());
		mockServerTimeOffset.value = 0;
		mockClockSynced.value = true;
	});

	it('projects on the shared server clock, not on this browser\'s', async () => {
		// A browser two minutes behind the server. Reading its own clock, it would take a
		// graphic taken a moment ago to have been taken two minutes in its own future, pin
		// it at full excursion for the whole of the skew, and then play its entrance from
		// zero once its clock caught up — the replay the no-replay invariant forbids,
		// arriving through the clock rather than through the stored field.
		mockServerTimeOffset.value = 120_000;
		const serverNow = Date.now() + 120_000;
		mockRepository.getSession.mockResolvedValue(session({
			currentState: {
				playout: { slate: { onAir: true, effectiveStartedAt: serverNow - 400, cut: false } },
				inputs: {},
			},
		}));

		await store.loadSession(EVENT_ID, SCREEN_ID);
		const projection = store.animationProjection(SCREEN_ID, [graphic('slate', FADE_IN)]);

		expect(projection.slate?.phase).toBe('enter');
		expect(projection.slate?.elapsed).toBeGreaterThanOrEqual(400);
		expect(projection.slate?.elapsed).toBeLessThan(1000);
	});

	it('keeps an Out Broadcast Graphic on program for exactly its exit, on that same clock', async () => {
		mockServerTimeOffset.value = -90_000;
		const serverNow = Date.now() - 90_000;
		mockRepository.getSession.mockResolvedValue(session({
			currentState: {
				playout: { slate: { onAir: false, effectiveStartedAt: serverNow - 200, cut: false } },
				inputs: {},
			},
		}));
		const graphics = [graphic('slate', FADE_OUT)];

		await store.loadSession(EVENT_ID, SCREEN_ID);

		// Still exiting, so still on program — and it leaves 1000ms after Out, rather than
		// in ninety seconds when this browser's clock catches up.
		expect(store.playoutState(SCREEN_ID, 'slate', graphics[0])).toBe('exiting');
		expect(store.onAirGraphicIds(SCREEN_ID, graphics)).toEqual(['slate']);
		expect(store.onAirGraphicIds(SCREEN_ID, graphics, store.serverNow() + 1200)).toEqual([]);
	});

	it('holds the Graphic Resting State until this browser knows the server clock', async () => {
		// Before the first sync the offset is zero, which is the local clock unmodified —
		// exactly the condition the hazard describes. So an unsynced output projects
		// nothing: an on-air graphic sits at its resting state rather than being pinned at
		// full excursion and then replaying its entrance the moment the sync lands.
		mockClockSynced.value = false;
		const serverNow = Date.now();
		mockRepository.getSession.mockResolvedValue(session({
			currentState: {
				playout: { slate: { onAir: true, effectiveStartedAt: serverNow - 400, cut: false } },
				inputs: {},
			},
		}));

		await store.loadSession(EVENT_ID, SCREEN_ID);

		expect(store.animationProjection(SCREEN_ID, [graphic('slate', FADE_IN)])).toEqual({});
		expect(store.playoutState(SCREEN_ID, 'slate', graphic('slate', FADE_IN))).toBe('on-air');
	});

	it('still withholds a coalescing acceptance while the clock is unsynced', async () => {
		// Holding the resting state must not quietly mean skipping the coalescing deferral.
		// Which rendering is on screen is one non-animating choice rather than a per-frame
		// sample, and the update chain bounds its own staleness, so it is answered even
		// unsynced — program keeps showing what the graphic entered with.
		mockClockSynced.value = false;
		const serverNow = Date.now();
		mockRepository.getSession.mockResolvedValue(session({
			currentState: {
				playout: {
					slate: { onAir: true, effectiveStartedAt: serverNow - 200, cut: false, updateStartedAt: serverNow + 800 },
				},
				inputs: {
					slate: {
						working: { headline: 'after' },
						accepted: { headline: 'after' },
						acceptedRevision: 2,
						updateFrom: { headline: 'before' },
					},
				},
			},
		}));
		const graphics = [{
			...graphic('slate', { ...FADE_IN, update: { duration: 400, easing: 'linear' as const, delay: 0, fade: { opacity: 0 } } }),
			inputs: [{
				type: 'text' as const,
				key: 'headline',
				label: 'Headline',
				required: false,
				updatePolicy: 'staged' as const,
				default: '',
				maxLength: 80,
			}],
		}];

		await store.loadSession(EVENT_ID, SCREEN_ID);
		const rendered = store.renderedInputValues(SCREEN_ID, graphics);

		expect(rendered.current.slate).toEqual({ headline: 'before' });
		expect(rendered.outgoing.slate).toBeUndefined();
		// And nothing animates, because the phase is still not projected while unsynced.
		expect(store.animationProjection(SCREEN_ID, graphics)).toEqual({});
	});

	it('takes an unsynced output off program at once rather than stranding it there', async () => {
		// The same rule on the way off air, where holding the settled state is not merely
		// tidier but safer: an exiting graphic is on program, so an unsynced output that
		// guessed at the phase could keep a graphic the operator has taken off on air.
		mockClockSynced.value = false;
		mockRepository.getSession.mockResolvedValue(session({
			currentState: {
				playout: { slate: { onAir: false, effectiveStartedAt: Date.now() - 200, cut: false } },
				inputs: {},
			},
		}));
		const graphics = [graphic('slate', FADE_OUT)];

		await store.loadSession(EVENT_ID, SCREEN_ID);

		expect(store.playoutState(SCREEN_ID, 'slate', graphics[0])).toBe('off');
		expect(store.onAirGraphicIds(SCREEN_ID, graphics)).toEqual([]);
	});

	it('has no phase to project for a Broadcast Graphic that authored no animation', async () => {
		mockRepository.getSession.mockResolvedValue(session({
			currentState: {
				playout: { slate: { onAir: true, effectiveStartedAt: Date.now(), cut: false } },
				inputs: {},
			},
		}));

		await store.loadSession(EVENT_ID, SCREEN_ID);

		expect(store.animationProjection(SCREEN_ID, [graphic('slate')])).toEqual({});
		expect(store.playoutState(SCREEN_ID, 'slate', graphic('slate'))).toBe('on-air');
	});
});
