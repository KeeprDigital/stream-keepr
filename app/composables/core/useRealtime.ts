import type { RealtimeTransport } from '~/types/realtime';

export function useRealtime(): RealtimeTransport {
	const realtime = tryUseRealtime();

	if (!realtime) {
		throw new Error('Realtime transport is not available. Make sure this code is running on the client with the realtime plugin configured.');
	}

	return realtime;
}

export function tryUseRealtime(): RealtimeTransport | undefined {
	const { $realtime } = useNuxtApp();

	return $realtime as RealtimeTransport | undefined;
}
