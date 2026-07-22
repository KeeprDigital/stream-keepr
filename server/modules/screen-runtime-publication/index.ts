import type { CardInput } from '~~/server/schemas/kv/card';
import { publishMessage } from '~~/server/utils/ably';

interface PublicationInput {
	eventId: number;
	screenId: number;
	originConnectionId?: string;
}

interface CardUpdatedInput extends PublicationInput {
	card: CardInput;
}

export function screenRuntimePublicationModule() {
	async function cardUpdated({ eventId, screenId, card, originConnectionId }: CardUpdatedInput) {
		await publishMessage(eventId, 'card:updated', { card, screenId }, originConnectionId);
	}

	async function cardCleared({ eventId, screenId, originConnectionId }: PublicationInput) {
		await publishMessage(eventId, 'card:cleared', { screenId }, originConnectionId);
	}

	return {
		cardUpdated,
		cardCleared,
	};
}
