import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsSessionResponse,
} from '~~/shared/types/broadcastGraphicsSession';

/**
 * HTTP Adapter for Broadcast Graphics Live Session routes.
 *
 * Only route paths, methods, headers, and response shapes. Command construction
 * and the playout vocabulary live in the shared session module.
 */
export function useBroadcastGraphicsSessionRepository() {
	const apiHeaders = useApiHeaders();

	const getSession = async (
		eventId: number,
		screenId: number,
	): Promise<BroadcastGraphicsSessionResponse> => {
		return await $fetch<BroadcastGraphicsSessionResponse>(
			`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/session`,
		);
	};

	const sendCommand = async (
		eventId: number,
		screenId: number,
		sessionId: number,
		command: BroadcastGraphicsCommand,
	): Promise<BroadcastGraphicsCommandResult> => {
		return await $fetch<BroadcastGraphicsCommandResult>(
			`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/sessions/${sessionId}/commands`,
			{
				method: 'POST',
				body: command,
				headers: apiHeaders.getHeaders(),
			},
		);
	};

	return {
		getSession,
		sendCommand,
	};
}
