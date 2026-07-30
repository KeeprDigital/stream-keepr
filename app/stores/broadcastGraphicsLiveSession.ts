import type {
	BroadcastGraphicsCommandType,
	BroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-session';
import type { BroadcastGraphicsSessionResponse } from '~~/shared/types/broadcastGraphicsSession';
import type { BroadcastGraphicConfig, GraphicPlayoutState } from '~~/shared/types/graphics';
import type { MessageData } from '~/types/realtime';
import {
	broadcastGraphicPlayoutState,
	createInitialBroadcastGraphicsLiveState,
	onAirBroadcastGraphicIds,
} from '~~/shared/modules/broadcast-graphics-session';
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
export const useBroadcastGraphicsSessionStore = defineStore('broadcastGraphicsSession', () => {
	const repository = useBroadcastGraphicsSessionRepository();
	const { executeAction } = useAsyncAction();

	const sessions = ref<Map<number, BroadcastGraphicsSessionResponse>>(new Map());
	const loading = ref(false);
	const error = ref<string | null>(null);

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

	function cacheSession(session: BroadcastGraphicsSessionResponse) {
		sessions.value.set(session.screenId, session);
	}

	async function loadSession(eventId: number, screenId: number): Promise<BroadcastGraphicsSessionResponse | null> {
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
	): Promise<BroadcastGraphicsSessionResponse | null> {
		return await executeAction(
			async () => {
				const session = sessions.value.get(screenId) ?? await repository.getSession(eventId, screenId);
				const result = await repository.sendCommand(eventId, screenId, session.id, {
					commandId: randomCommandId(type),
					type,
					payload: { graphicId, cut },
				});
				cacheSession(result.session);
				return result.session;
			},
			{ errorRef: error },
		);
	}

	/** Take a Broadcast Graphic on air; `cut` skips its enter animation once one exists. */
	function take(eventId: number, screenId: number, graphicId: string, cut = false) {
		return sendCommand(eventId, screenId, 'Take', graphicId, cut);
	}

	/** Take a Broadcast Graphic off air; `cut` skips its exit animation once one exists. */
	function out(eventId: number, screenId: number, graphicId: string, cut = false) {
		return sendCommand(eventId, screenId, 'Out', graphicId, cut);
	}

	async function applyRemoteCommand(data: MessageData<'broadcastGraphicsSession:commandApplied'>) {
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
		loading.value = false;
		error.value = null;
	}

	return {
		sessions,
		loading,
		error,
		liveState,
		playoutState,
		onAirGraphicIds,
		loadSession,
		take,
		out,
		applyRemoteCommand,
		$reset,
	};
});
