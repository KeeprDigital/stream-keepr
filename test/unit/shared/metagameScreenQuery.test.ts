import type { ModeConfigsMap } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { metagameArchetypeDetailQuerySchema, metagameArchetypesQuerySchema, metagameCardsQuerySchema } from '~~/server/schemas/api/metagame';
import { CONVERSION_THRESHOLD_BOUNDS, DEFAULT_CONVERSION_TARGET } from '~~/shared/conversionTarget';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { archetypeSpotlightScreenQuery, metagameScreenQuery, topCardsScreenQuery } from '~~/shared/utils/metagameQuery';

function screenQuery(stored: ModeConfigsMap['metagame'], target = DEFAULT_CONVERSION_TARGET) {
	return metagameScreenQuery(resolveScreenModeConfig({ metagame: stored }, 'metagame'), target);
}

describe('metagameScreenQuery', () => {
	it('asks the archetype breakdown for the Conversion Rate against its Event\'s Conversion Target, inside the Screen\'s scope', () => {
		const { query } = screenQuery({ scope: 'topN', topN: 32 }, { conversionMetric: 'minPoints', conversionThreshold: 15 });

		expect(query).toEqual({
			scope: 'topN',
			topN: 32,
			sortBy: 'metaShare',
			conversionMetric: 'minPoints',
			conversionThreshold: 15,
		});
	});

	// A stored per-Screen target is a former field: the Event's target wins over it.
	it('ignores a Screen\'s former conversion target', () => {
		const stored = { conversionMetric: 'minPoints', conversionThreshold: 15 } as ModeConfigsMap['metagame'];

		expect(screenQuery(stored).query).toMatchObject({ conversionMetric: 'topN', conversionThreshold: 8 });
	});

	it.each([
		{ conversionMetric: 'topN', conversionThreshold: CONVERSION_THRESHOLD_BOUNDS.topN.min },
		{ conversionMetric: 'minPoints', conversionThreshold: CONVERSION_THRESHOLD_BOUNDS.minPoints.min },
		{ conversionMetric: 'minPoints', conversionThreshold: CONVERSION_THRESHOLD_BOUNDS.minPoints.max },
	] as const)('sends every Conversion Target an Event can hold within the archetype read\'s bounds: $conversionMetric $conversionThreshold', (target) => {
		expect(() => metagameArchetypesQuerySchema.parse(screenQuery({}, target).query)).not.toThrow();
	});

	it('leaves the card breakdown without a conversion target', () => {
		expect(screenQuery({ viewMode: 'cards' }).query).not.toHaveProperty('conversionMetric');
	});
});

describe('archetypeSpotlightScreenQuery', () => {
	function spotlightQuery(stored: ModeConfigsMap['archetype-spotlight'], target = DEFAULT_CONVERSION_TARGET) {
		return archetypeSpotlightScreenQuery(resolveScreenModeConfig({ 'archetype-spotlight': stored }, 'archetype-spotlight'), target);
	}

	it('asks nothing while no Archetype is picked', () => {
		expect(spotlightQuery({})).toBeNull();
	});

	it('asks the archetype detail read for what the archetype page asks for by default', () => {
		expect(spotlightQuery({ archetypeId: 7 })).toEqual({
			archetypeId: 7,
			query: {
				scope: 'all',
				board: 'full',
				conversionMetric: 'topN',
				conversionThreshold: 8,
			},
		});
	});

	it('asks for the Screen\'s own scope and board, against its Event\'s Conversion Target', () => {
		const request = spotlightQuery({
			archetypeId: 7,
			scope: 'minPoints',
			minPoints: 12,
			board: 'mainboard',
		}, { conversionMetric: 'minPoints', conversionThreshold: 18 });

		expect(request?.query).toEqual({
			scope: 'minPoints',
			minPoints: 12,
			board: 'mainboard',
			conversionMetric: 'minPoints',
			conversionThreshold: 18,
		});
		expect(metagameArchetypeDetailQuerySchema.parse(request!.query)).toMatchObject({ scope: 'minPoints', minPoints: 12, conversionThreshold: 18 });
	});

	it('scopes to its Player List only while the scope names one', () => {
		expect(spotlightQuery({ archetypeId: 7, scope: 'playerList', playerListId: 3 })?.query).toMatchObject({ scope: 'playerList', playerListId: 3 });
		expect(spotlightQuery({ archetypeId: 7, scope: 'all', playerListId: 3 })?.query).not.toHaveProperty('playerListId');
	});
});

describe('topCardsScreenQuery', () => {
	function topCardsQuery(stored: ModeConfigsMap['top-cards']) {
		return topCardsScreenQuery(resolveScreenModeConfig({ 'top-cards': stored }, 'top-cards'));
	}

	it('asks the card breakdown for every Player by default', () => {
		expect(topCardsQuery({})).toEqual({
			scope: 'all',
			sortBy: 'inclusionRate',
			limit: 10,
			board: 'mainboard',
			excludeTypes: 'Land',
		});
	});

	it('asks for the Screen\'s own scope, and its Player List only while the scope names one', () => {
		expect(topCardsQuery({ scope: 'topN', topN: 16 })).toMatchObject({ scope: 'topN', topN: 16 });
		expect(topCardsQuery({ scope: 'playerList', playerListId: 3 })).toMatchObject({ scope: 'playerList', playerListId: 3 });
		expect(topCardsQuery({ scope: 'all', playerListId: 3 })).not.toHaveProperty('playerListId');
	});

	it('scopes the same way the Metagame card breakdown does', () => {
		const stored = { scope: 'playerList', playerListId: 3, archetypeFilter: 'Rakdos Midrange' } as const;
		const { scope, playerListId, archetype } = screenQuery({ ...stored, viewMode: 'cards' }).query as Record<string, unknown>;

		expect(topCardsQuery(stored)).toMatchObject({ scope, playerListId, archetype });
	});

	// A pointed land such as Strip Mine is a pointed pick, so ranking pointed cards keeps nonbasic lands in.
	it.each([
		{
			pointedOnly: true,
			asked: true,
			excludeTypes: ['Creature'],
		},
		{
			pointedOnly: false,
			asked: undefined,
			excludeTypes: ['Land', 'Creature'],
		},
	])('asks for pointed cards only while the Screen filters to them: $pointedOnly', ({ pointedOnly, asked, excludeTypes }) => {
		const query = metagameCardsQuerySchema.parse(topCardsQuery({
			pointedOnly,
			excludedCardTypes: ['Land', 'Creature'],
		}));

		expect(query.pointedOnly).toBe(asked);
		expect(query.excludeTypes).toEqual(excludeTypes);
	});

	it('reads a Minimum Points scope, which it never offered, with no minimum', () => {
		expect(topCardsQuery({ scope: 'minPoints' })).not.toHaveProperty('minPoints');
	});
});
