import { describe, expect, it, vi } from 'vitest';

const getHeaders = vi.fn(() => ({ 'x-realtime-connection-id': 'connection-1' }));
const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

vi.mock('~/composables/core/useApiHeaders', () => ({
	useApiHeaders: () => ({ getHeaders }),
}));

const { buildEventDataPath, normalizeEventDataListResponse, useEventDataFetch } = await import('~/modules/event-data/client');

describe('event Data client module', () => {
	it('normalizes Event Data list responses', () => {
		expect(normalizeEventDataListResponse([{ id: 1 }], { resourcePath: 'players' })).toEqual([{ id: 1 }]);
		expect(normalizeEventDataListResponse({ players: [{ id: 2 }] }, { resourcePath: 'players' })).toEqual([{ id: 2 }]);
		expect(normalizeEventDataListResponse({ featureMatches: [{ id: 3 }] }, { resourcePath: 'feature-matches', responseKey: 'featureMatches' })).toEqual([{ id: 3 }]);
		expect(normalizeEventDataListResponse({ total: 0 }, { resourcePath: 'players' })).toEqual([]);
	});

	it('builds Event Data paths consistently', () => {
		expect(buildEventDataPath({ eventId: 12, resourcePath: 'players' })).toBe('/api/events/12/players');
		expect(buildEventDataPath({ eventId: 12, resourcePath: 'player-lists', resourceId: 5, suffix: 'members/9' })).toBe('/api/events/12/player-lists/5/members/9');
		expect(buildEventDataPath({ resourcePath: 'events', resourceId: 1, eventScoped: false })).toBe('/api/events/1');
	});

	it('adds realtime-origin headers to write options', () => {
		const eventData = useEventDataFetch();

		expect(eventData.withOriginHeaders({ method: 'POST', body: { name: 'Alice' } })).toEqual({
			method: 'POST',
			body: { name: 'Alice' },
			headers: { 'x-realtime-connection-id': 'connection-1' },
		});
	});
});
