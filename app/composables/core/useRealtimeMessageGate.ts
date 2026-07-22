import type { MaybeRef } from 'vue';
import type { MessageType } from '~~/shared/types/messages';
import type { MessageData, RealtimeHandler } from '~/types/realtime';
import { toValue } from 'vue';

export function useRealtimeMessageGate(connectionId: MaybeRef<string | undefined>) {
	function isSelfOrigin(data: { originConnectionId?: string } | undefined): boolean {
		const resolvedConnectionId = toValue(connectionId);
		return !!data?.originConnectionId && data.originConnectionId === resolvedConnectionId;
	}

	function accept<T extends MessageType>(type: T, handler: (data: MessageData<T>) => void | Promise<void>): RealtimeHandler<T> {
		return (data) => {
			if (isSelfOrigin(data))
				return;

			try {
				const result = handler(data);
				if (result) {
					void Promise.resolve(result).catch((err) => {
						console.warn(`Failed to handle realtime message "${type}":`, err);
					});
				}
			}
			catch (err) {
				console.warn(`Failed to handle realtime message "${type}":`, err);
			}
		};
	}

	return {
		accept,
		isSelfOrigin,
	};
}
