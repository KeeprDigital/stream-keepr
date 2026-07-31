import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';

/**
 * HTTP Adapter for Broadcast Graphics Live Session routes.
 *
 * Only route paths, methods, headers, and response shapes. Command construction
 * and the playout vocabulary live in the shared session module.
 */
export function useBroadcastGraphicsLiveSessionRepository() {
	const apiHeaders = useApiHeaders();

	const getSession = async (
		eventId: number,
		screenId: number,
	): Promise<BroadcastGraphicsLiveSessionResponse> => {
		return await $fetch<BroadcastGraphicsLiveSessionResponse>(
			`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/live-session`,
		);
	};

	const sendCommand = async (
		eventId: number,
		screenId: number,
		sessionId: number,
		command: BroadcastGraphicsCommand,
	): Promise<BroadcastGraphicsCommandResult> => {
		return await $fetch<BroadcastGraphicsCommandResult>(
			`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/live-sessions/${sessionId}/commands`,
			{
				method: 'POST',
				body: command,
				headers: apiHeaders.getHeaders(),
			},
		);
	};

	/**
	 * Addressed to the Screen rather than to an epoch: this is the action for an
	 * operator whose epoch is unusable, so naming one would defeat it.
	 */
	const resetSession = async (
		eventId: number,
		screenId: number,
	): Promise<BroadcastGraphicsLiveSessionResponse> => {
		return await $fetch<BroadcastGraphicsLiveSessionResponse>(
			`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/live-session/reset`,
			{ method: 'POST', headers: apiHeaders.getHeaders() },
		);
	};

	return {
		getSession,
		sendCommand,
		resetSession,
	};
}
