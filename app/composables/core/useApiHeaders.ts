import type { RealtimeTransport } from '~/types/realtime';

export function useApiHeaders(realtime: RealtimeTransport | undefined = tryUseRealtime()) {
	function getHeaders(): HeadersInit {
		return realtime?.connectionId
			? { 'x-realtime-connection-id': realtime.connectionId }
			: {};
	}

	return {
		getHeaders,
	};
}
