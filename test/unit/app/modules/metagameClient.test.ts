import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildMetagameScopeQuery,
	useMetagameClient,
} from '~~/app/modules/metagame/client';

const mockFetch = vi.fn();
vi.stubGlobal('$fetch', mockFetch);

describe('metagame client module', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch.mockResolvedValue({});
	});

	it('builds scope query parameters for all supported scopes', () => {
		expect(buildMetagameScopeQuery({ scope: 'all', topN: 16, playerListId: 5 })).toEqual({ scope: 'all' });
		expect(buildMetagameScopeQuery({ scope: 'topN', topN: 16 })).toEqual({ scope: 'topN', topN: 16 });
		expect(buildMetagameScopeQuery({ scope: 'minPoints', minPoints: 9 })).toEqual({ scope: 'minPoints', minPoints: 9 });
		expect(buildMetagameScopeQuery({ scope: 'minPoints' })).toEqual({ scope: 'minPoints' });
		expect(buildMetagameScopeQuery({ scope: 'all', minPoints: 9 })).toEqual({ scope: 'all' });
		expect(buildMetagameScopeQuery({ scope: 'playerList', playerListId: 5 })).toEqual({ scope: 'playerList', playerListId: 5 });
		expect(buildMetagameScopeQuery({ scope: 'playerList' })).toEqual({ scope: 'playerList' });
	});

	it('fetches summary with normalized scope options', async () => {
		const client = useMetagameClient();
		await client.loadSummary(1, { scope: 'topN', topN: 8 });

		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/metagame', {
			query: { scope: 'topN', topN: 8 },
		});
	});

	it('fetches archetype breakdown with sort defaults', async () => {
		const client = useMetagameClient();
		await client.loadArchetypeBreakdown(1, { scope: 'all' });

		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/metagame/archetypes', {
			query: { scope: 'all', sortBy: 'metaShare' },
		});
	});

	it('sends the conversion target with archetype breakdown and detail queries', async () => {
		const client = useMetagameClient();
		await client.loadArchetypeBreakdown(1, { scope: 'all' }, { conversionMetric: 'topN', conversionThreshold: 8 });
		await client.loadArchetypeDetail(1, 2, { scope: 'all' }, { conversionMetric: 'minPoints', conversionThreshold: 12 });

		expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/events/1/metagame/archetypes', {
			query: { scope: 'all', sortBy: 'metaShare', conversionMetric: 'topN', conversionThreshold: 8 },
		});
		expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/events/1/metagame/archetypes/2', {
			query: { scope: 'all', conversionMetric: 'minPoints', conversionThreshold: 12 },
		});
	});

	it('omits half-specified conversion targets', async () => {
		const client = useMetagameClient();
		await client.loadArchetypeBreakdown(1, { scope: 'all' }, { conversionMetric: 'topN' });

		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/metagame/archetypes', {
			query: { scope: 'all', sortBy: 'metaShare' },
		});
	});

	it('fetches card breakdown with sort, limit, board, and archetype filters', async () => {
		const client = useMetagameClient();
		await client.loadCardBreakdown(
			1,
			{ scope: 'playerList', playerListId: 5 },
			{ sortBy: 'totalCopies', limit: 100, board: 'sideboard', archetypeId: 9, archetype: ' Mono Red ' },
		);

		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/metagame/cards', {
			query: {
				scope: 'playerList',
				playerListId: 5,
				sortBy: 'totalCopies',
				limit: 100,
				board: 'sideboard',
				archetypeId: 9,
				archetype: 'Mono Red',
			},
		});
	});

	it('omits blank archetype filters from card breakdown queries', async () => {
		const client = useMetagameClient();
		await client.loadCardBreakdown(1, { scope: 'all' }, { archetype: '  ' });

		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/metagame/cards', {
			query: {
				scope: 'all',
				sortBy: 'inclusionRate',
				limit: 50,
			},
		});
	});

	it('fetches archetype and card details with shared scope query handling', async () => {
		const client = useMetagameClient();
		await client.loadArchetypeDetail(1, 2, { scope: 'topN', topN: 16 }, { board: 'mainboard' });
		await client.loadCardDetail(1, 3, { scope: 'topN', topN: 16 });

		expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/events/1/metagame/archetypes/2', {
			query: { scope: 'topN', topN: 16, board: 'mainboard' },
		});
		expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/events/1/metagame/cards/3', {
			query: { scope: 'topN', topN: 16 },
		});
	});
});
