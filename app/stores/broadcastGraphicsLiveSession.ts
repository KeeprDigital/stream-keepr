import type {
	BroadcastGraphicsCommandType,
	BroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import type { BroadcastGraphicConfig, GraphicPlayoutState } from '~~/shared/types/graphics';
import type { MessageData } from '~/types/realtime';
import {
	broadcastGraphicPlayoutState,
	createInitialBroadcastGraphicsLiveState,
	onAirBroadcastGraphicIds,
} from '~~/shared/modules/broadcast-graphics-live-session';
import { randomCommandId } from '~~/shared/utils/uuid';

/**
 * Client-side Broadcast Graphics playout state, per Screen.
 *
 * The snapshot loaded from the server is the only authority here: a playout
 * command's result and a reloaded snapshot are written straight in, and a
 * realtime notification is trusted only while it continues the sequence this
 * client already holds. A gap means this client fell behind, so it reloads the
 * authoritative snapshot rather than guessing what it missed. That is what makes
 * a reconnecting Live Control and a reconnecting Screen Output converge on the
 * same state.
 */
export const useBroadcastGraphicsLiveSessionStore = defineStore('broadcastGraphicsLiveSession', () => {
	const repository = useBroadcastGraphicsLiveSessionRepository();
	const { executeAction } = useAsyncAction();

	const sessions = ref<Map<number, BroadcastGraphicsLiveSessionResponse>>(new Map());
	const loading = ref(false);
	const error = ref<string | null>(null);
	/** Playout actions awaiting their authoritative answer, keyed per Broadcast Graphic. */
	const pending = ref<Set<string>>(new Set());

	function playoutKey(screenId: number, graphicId: string): string {
		return `${screenId}:${graphicId}`;
	}

	/**
	 * Whether this Broadcast Graphic has an action in flight.
	 *
	 * Scoped per graphic rather than per Screen: taking one graphic must never
	 * freeze the controls of another.
	 */
	function isPending(screenId: number, graphicId: string): boolean {
		return pending.value.has(playoutKey(screenId, graphicId));
	}

	function isConflict(failure: unknown): boolean {
		if (typeof failure !== 'object' || failure === null)
			return false;
		const status = 'statusCode' in failure ? failure.statusCode : ('status' in failure ? failure.status : undefined);
		return status === 409;
	}

	function liveState(screenId: number): BroadcastGraphicsLiveState {
		return sessions.value.get(screenId)?.currentState ?? createInitialBroadcastGraphicsLiveState();
	}

	/** The Graphic Playout State of one placed Broadcast Graphic. */
	function playoutState(screenId: number, graphicId: string): GraphicPlayoutState {
		return broadcastGraphicPlayoutState(liveState(screenId), graphicId);
	}

	/** Which Broadcast Graphics compose into the Screen's frame, in authored stack order. */
	function onAirGraphicIds(
		screenId: number,
		graphics: readonly Pick<BroadcastGraphicConfig, 'id'>[],
	): string[] {
		return onAirBroadcastGraphicIds(liveState(screenId), graphics);
	}

	function cacheSession(session: BroadcastGraphicsLiveSessionResponse) {
		sessions.value.set(session.screenId, session);
	}

	function cacheCommandResult(result: BroadcastGraphicsCommandResult): BroadcastGraphicsLiveSessionResponse {
		cacheSession(result.session);
		return result.session;
	}

	async function loadSession(eventId: number, screenId: number): Promise<BroadcastGraphicsLiveSessionResponse | null> {
		return await executeAction(
			async () => {
				const session = await repository.getSession(eventId, screenId);
				cacheSession(session);
				return session;
			},
			{ loadingRef: loading, errorRef: error },
		);
	}

	async function sendCommand(
		eventId: number,
		screenId: number,
		type: BroadcastGraphicsCommandType,
		graphicId: string,
		cut: boolean,
	): Promise<BroadcastGraphicsLiveSessionResponse | null> {
		const command = {
			commandId: randomCommandId(type),
			type,
			payload: { graphicId, cut },
		};
		const pendingKey = playoutKey(screenId, graphicId);
		pending.value.add(pendingKey);

		try {
			return await executeAction(
				async () => {
					const session = sessions.value.get(screenId) ?? await repository.getSession(eventId, screenId);

					try {
						return cacheCommandResult(await repository.sendCommand(eventId, screenId, session.id, command));
					}
					catch (failure) {
						// A conflict is what an epoch this client no longer shares looks
						// like: the Screen may have left and re-entered Broadcast Graphics
						// mode in another tab, ending the epoch under us. Without this the
						// operator's every Take would 409 until they reloaded the page —
						// a silent dead end on a live show. The snapshot is the authority
						// on which epoch is current, so reload and restate the intent once.
						if (!isConflict(failure))
							throw failure;

						const current = await repository.getSession(eventId, screenId);
						cacheSession(current);
						return cacheCommandResult(
							await repository.sendCommand(eventId, screenId, current.id, command),
						);
					}
				},
				{ errorRef: error },
			);
		}
		finally {
			pending.value.delete(pendingKey);
		}
	}

	/** Take a Broadcast Graphic on air; `cut` skips its enter animation once one exists. */
	function take(eventId: number, screenId: number, graphicId: string, cut = false) {
		return sendCommand(eventId, screenId, 'Take', graphicId, cut);
	}

	/** Take a Broadcast Graphic off air; `cut` skips its exit animation once one exists. */
	function out(eventId: number, screenId: number, graphicId: string, cut = false) {
		return sendCommand(eventId, screenId, 'Out', graphicId, cut);
	}

	async function applyRemoteCommand(data: MessageData<'broadcastGraphicsLiveSession:commandApplied'>) {
		const known = sessions.value.get(data.screenId);

		// Nothing loaded, or a different epoch entirely: the snapshot is the only
		// thing that can say which epoch this client should be following.
		if (!known || known.id !== data.sessionId) {
			await loadSession(data.eventId, data.screenId);
			return;
		}

		if (data.sequence <= known.sequence)
			return;

		if (data.sequence > known.sequence + 1) {
			await loadSession(data.eventId, data.screenId);
			return;
		}

		cacheSession({
			...known,
			sequence: data.sequence,
			currentState: data.currentState,
			updatedAt: new Date(data.timestamp),
		});
	}

	function $reset() {
		sessions.value.clear();
		pending.value.clear();
		loading.value = false;
		error.value = null;
	}

	return {
		sessions,
		loading,
		error,
		playoutState,
		onAirGraphicIds,
		isPending,
		loadSession,
		take,
		out,
		applyRemoteCommand,
		$reset,
	};
});
