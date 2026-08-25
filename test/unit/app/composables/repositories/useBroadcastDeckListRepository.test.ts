import { beforeEach, describe, expect, it, vi } from 'vitest';

const { command } = vi.hoisted(() => ({ command: vi.fn() }));

vi.mock('~~/app/modules/event-data/client', () => ({
	useEventDataFetch: () => ({ command }),
	isEventDataNotFoundError: () => false,
}));

const { useBroadcastDeckListRepository } = await import('~~/app/composables/repositories/useBroadcastDeckListRepository');

describe('useBroadcastDeckListRepository', () => {
	beforeEach(() => vi.clearAllMocks());

	it('adapts collection, detail, and revisioned writes to Event Data paths', async () => {
		command
			.mockResolvedValueOnce({ broadcastDeckLists: [{ id: 1 }] })
			.mockResolvedValueOnce({ id: 1, sourceText: '1 Island' })
			.mockResolvedValueOnce({ id: 2 })
			.mockResolvedValueOnce({ id: 1, revision: 2 })
			.mockResolvedValueOnce({ success: true });
		const repository = useBroadcastDeckListRepository();

		expect(await repository.list(7)).toEqual([{ id: 1 }]);
		await repository.getById(7, 1);
		await repository.create(7, { name: 'Deck', sourceText: '1 Island' });
		await repository.update(7, 1, { expectedRevision: 1, name: 'Renamed' });
		await repository.remove(7, 1, 2);

		expect(command.mock.calls).toEqual([
			[{ eventId: 7, resourcePath: 'broadcast-deck-lists' }, { method: 'GET' }],
			[{ eventId: 7, resourcePath: 'broadcast-deck-lists', resourceId: 1 }, { method: 'GET' }],
			[{ eventId: 7, resourcePath: 'broadcast-deck-lists' }, { method: 'POST', body: { name: 'Deck', sourceText: '1 Island' } }],
			[{ eventId: 7, resourcePath: 'broadcast-deck-lists', resourceId: 1 }, { method: 'PATCH', body: { expectedRevision: 1, name: 'Renamed' } }],
			[{ eventId: 7, resourcePath: 'broadcast-deck-lists', resourceId: 1 }, { method: 'DELETE', body: { expectedRevision: 2 } }],
		]);
	});
});
