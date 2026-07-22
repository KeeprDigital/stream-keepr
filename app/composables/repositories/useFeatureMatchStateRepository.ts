import type {
	FeatureMatchSessionCommand,
	FeatureMatchSessionCommandResult,
	FeatureMatchSessionResponse,
} from '~~/shared/types/featureMatchSession';
import type { FeatureMatch } from '~/types';

function isHttpStatus(err: unknown, statusCode: number): boolean {
	if (typeof err !== 'object' || err === null)
		return false;

	const statusCodeValue = 'statusCode' in err ? err.statusCode : undefined;
	const statusValue = 'status' in err ? err.status : undefined;
	return statusCodeValue === statusCode || statusValue === statusCode;
}

/**
 * HTTP Adapter for Feature Match Session routes.
 *
 * Command construction and sequencing live in the Feature Match Session client
 * Module; this Adapter only knows route paths, methods, headers, and response
 * shapes.
 */
export function useFeatureMatchStateRepository() {
	const apiHeaders = useApiHeaders();

	const getSlot = async (
		eventId: number,
		slotId: number,
	): Promise<FeatureMatch | null> => {
		try {
			return await $fetch<FeatureMatch>(
				`/api/events/${eventId}/feature-match-slots/${slotId}`,
			);
		}
		catch (err: unknown) {
			if (isHttpStatus(err, 404))
				return null;
			throw err;
		}
	};

	const listSlots = async (eventId: number): Promise<FeatureMatch[]> => {
		const response = await $fetch<{ featureMatchSlots: FeatureMatch[] }>(
			`/api/events/${eventId}/feature-match-slots`,
		);
		return response.featureMatchSlots;
	};

	const createSession = async (
		eventId: number,
		slotId: number,
	): Promise<FeatureMatchSessionResponse> => {
		return await $fetch<FeatureMatchSessionResponse>(
			`/api/events/${eventId}/feature-match-slots/${slotId}/sessions`,
			{
				method: 'POST',
				headers: apiHeaders.getHeaders(),
			},
		);
	};

	const sendCommand = async (
		eventId: number,
		sessionId: number,
		command: FeatureMatchSessionCommand,
	): Promise<FeatureMatchSessionCommandResult> => {
		return await $fetch<FeatureMatchSessionCommandResult>(
			`/api/events/${eventId}/feature-match-sessions/${sessionId}/commands`,
			{
				method: 'POST',
				body: command,
				headers: apiHeaders.getHeaders(),
			},
		);
	};

	return {
		getSlot,
		listSlots,
		createSession,
		sendCommand,
	};
}
