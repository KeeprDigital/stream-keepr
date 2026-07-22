import type { MessageType } from '~~/shared/types/messages';
import type { MessageData, RealtimeHandler } from '~/types/realtime';

export type AcceptRealtimeMessage = <T extends MessageType>(
	type: T,
	handler: (data: MessageData<T>) => void | Promise<void>,
) => RealtimeHandler<T>;
