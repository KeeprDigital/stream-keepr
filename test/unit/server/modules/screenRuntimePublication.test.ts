import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPublishMessage = vi.fn();

vi.mock('~~/server/utils/ably', () => ({
	publishMessage: mockPublishMessage,
}));

const { screenRuntimePublicationModule } = await import('~~/server/modules/screen-runtime-publication');

function createCard(overrides: Record<string, unknown> = {}) {
	return {
		id: 'card-1',
		name: 'Lightning Bolt',
		set: 'lea',
		layout: 'normal',
		imageData: { front: null, back: null },
		orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
		displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
		...overrides,
	};
}

describe('screen runtime publication module', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('publishes card runtime updates', async () => {
		const card = createCard();

		await screenRuntimePublicationModule().cardUpdated({
			eventId: 1,
			screenId: 2,
			card: card as any,
			originConnectionId: 'origin-1',
		});

		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'card:updated', {
			card,
			screenId: 2,
		}, 'origin-1');
	});

	it('publishes card runtime clears', async () => {
		await screenRuntimePublicationModule().cardCleared({
			eventId: 1,
			screenId: 2,
			originConnectionId: 'origin-1',
		});

		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'card:cleared', {
			screenId: 2,
		}, 'origin-1');
	});
});
