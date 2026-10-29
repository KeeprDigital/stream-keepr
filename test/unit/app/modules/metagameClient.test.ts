import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildMetagameScopeQuery,
	useMetagameClient,
} from '~~/app/modules/metagame/client';

const mockFetch = vi.fn();
vi.stubGlobal('$fetch', mockFetch);

describe('metagame client module', () => {
	beforeEach(() => {
		mockFetch.mockResolvedValue({});
	});

	it.each([
		[
			{ scope: 'all', topN: 16, playerListId: 5 },
			{ scope: 'all' },
		],
		[
			{ scope: 'all', minPoints: 9 },
			{ scope: 'all' },
		],
		[
			{ scope: 'topN', topN: 16 },
			{ scope: 'topN', topN: 16 },
		],
		[
			{ scope: 'minPoints', minPoints: 9 },
			{ scope: 'minPoints', minPoints: 9 },
		],
		[
			{ scope: 'minPoints' },
			{ scope: 'minPoints' },
		],
		[
			{ scope: 'playerList', playerListId: 5 },
			{ scope: 'playerList', playerListId: 5 },
		],
		[
			{ scope: 'playerList' },
			{ scope: 'playerList' },
		],
	] as const)('sends only the parameters scope %j uses', (options, query) => {
		expect(buildMetagameScopeQuery(options)).toEqual(query);
	});

	it('defaults archetype sorting and sends a conversion target only when it is whole', async () => {
		const client = useMetagameClient();
		await client.loadArchetypeBreakdown(1, { scope: 'all' }, { conversionMetric: 'topN', conversionThreshold: 8 });
		await client.loadArchetypeBreakdown(1, { scope: 'all' }, { conversionMetric: 'topN' });
		await client.loadArchetypeDetail(1, 2, { scope: 'topN', topN: 16 }, { board: 'mainboard', conversionMetric: 'minPoints', conversionThreshold: 12 });

		expect(mockFetch.mock.calls).toEqual([
			[
				'/api/events/1/metagame/archetypes',
				{
					query: {
						scope: 'all',
						sortBy: 'metaShare',
						conversionMetric: 'topN',
						conversionThreshold: 8,
					},
				},
			],
			[
				'/api/events/1/metagame/archetypes',
				{
					query: { scope: 'all', sortBy: 'metaShare' },
				},
			],
			[
				'/api/events/1/metagame/archetypes/2',
				{
					query: {
						scope: 'topN',
						topN: 16,
						board: 'mainboard',
						conversionMetric: 'minPoints',
						conversionThreshold: 12,
					},
				},
			],
		]);
	});

	it('defaults card sorting and limit, trims the archetype filter, and drops a blank one or an unset pointedOnly', async () => {
		const client = useMetagameClient();
		await client.loadCardBreakdown(1, { scope: 'playerList', playerListId: 5 }, {
			sortBy: 'totalCopies',
			limit: 100,
			board: 'sideboard',
			archetypeId: 9,
			archetype: ' Mono Red ',
			pointedOnly: true,
		});
		await client.loadCardBreakdown(1, { scope: 'all' }, { archetype: '  ', pointedOnly: false });

		expect(mockFetch.mock.calls).toEqual([
			[
				'/api/events/1/metagame/cards',
				{
					query: {
						scope: 'playerList',
						playerListId: 5,
						sortBy: 'totalCopies',
						limit: 100,
						board: 'sideboard',
						archetypeId: 9,
						archetype: 'Mono Red',
						pointedOnly: 'true',
					},
				},
			],
			[
				'/api/events/1/metagame/cards',
				{
					query: { scope: 'all', sortBy: 'inclusionRate', limit: 50 },
				},
			],
		]);
	});

	it('sends the summary and card detail through the same scope query', async () => {
		const client = useMetagameClient();
		await client.loadSummary(1, { scope: 'topN', topN: 8 });
		await client.loadCardDetail(1, 3, { scope: 'minPoints', minPoints: 9 });

		expect(mockFetch.mock.calls).toEqual([
			[
				'/api/events/1/metagame',
				{
					query: { scope: 'topN', topN: 8 },
				},
			],
			[
				'/api/events/1/metagame/cards/3',
				{
					query: { scope: 'minPoints', minPoints: 9 },
				},
			],
		]);
	});
});
