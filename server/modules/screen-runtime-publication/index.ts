import type { CardInput } from '~~/server/schemas/kv/card';
import { publishMessage } from '~~/server/utils/ably';

interface PublicationInput {
	eventId: number;
	screenId: number;
	/** The Card revision the write committed, which every holder orders by (#734). */
	revision: number;
	originConnectionId?: string;
}

interface CardUpdatedInput extends PublicationInput {
	card: CardInput;
}

export function screenRuntimePublicationModule() {
	async function cardUpdated({ eventId, screenId, card, revision, originConnectionId }: CardUpdatedInput) {
		await publishMessage(eventId, 'card:updated', { card, screenId, revision }, originConnectionId);
	}

	async function cardCleared({ eventId, screenId, revision, originConnectionId }: PublicationInput) {
		await publishMessage(eventId, 'card:cleared', { screenId, revision }, originConnectionId);
	}

	return {
		cardUpdated,
		cardCleared,
	};
}
