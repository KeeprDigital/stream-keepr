import type { ModeConfigsMap } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { metagameArchetypeDetailQuerySchema, metagameArchetypesQuerySchema } from '~~/server/schemas/api/metagame';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { archetypeSpotlightScreenQuery, metagameScreenQuery } from '~~/shared/utils/metagameQuery';

function screenQuery(stored: ModeConfigsMap['metagame']) {
	return metagameScreenQuery(resolveScreenModeConfig({ metagame: stored }, 'metagame'));
}

describe('metagameScreenQuery', () => {
	it('asks the archetype breakdown for the Conversion Rate the Metagame page asks for by default', () => {
		expect(screenQuery({}).query).toEqual({
			scope: 'all',
			sortBy: 'metaShare',
			conversionMetric: 'topN',
			conversionThreshold: 8,
		});
	});

	it('asks for the Screen\'s own conversion target, inside its scope', () => {
		const { query } = screenQuery({ scope: 'topN', topN: 32, conversionMetric: 'minPoints', conversionThreshold: 15 });

		expect(query).toMatchObject({ scope: 'topN', topN: 32, conversionMetric: 'minPoints', conversionThreshold: 15 });
		expect(metagameArchetypesQuerySchema.parse(query)).toMatchObject({ conversionMetric: 'minPoints', conversionThreshold: 15 });
	});

	it('sends every conversion threshold the Screen can hold within the archetype read\'s bounds', () => {
		const { min, max } = screenModeConfigContract('metagame').fields.conversionThreshold;

		for (const conversionThreshold of [min!, max!])
			expect(() => metagameArchetypesQuerySchema.parse(screenQuery({ conversionThreshold }).query)).not.toThrow();
	});

	it('leaves the card breakdown without a conversion target', () => {
		expect(screenQuery({ viewMode: 'cards' }).query).not.toHaveProperty('conversionMetric');
	});
});

describe('archetypeSpotlightScreenQuery', () => {
	function spotlightQuery(stored: ModeConfigsMap['archetype-spotlight']) {
		return archetypeSpotlightScreenQuery(resolveScreenModeConfig({ 'archetype-spotlight': stored }, 'archetype-spotlight'));
	}

	it('asks nothing while no Archetype is picked', () => {
		expect(spotlightQuery({})).toBeNull();
	});

	it('asks the archetype detail read for what the archetype page asks for by default', () => {
		expect(spotlightQuery({ archetypeId: 7 })).toEqual({
			archetypeId: 7,
			query: { scope: 'all', board: 'full', conversionMetric: 'topN', conversionThreshold: 8 },
		});
	});

	it('asks for the Screen\'s own scope, board and conversion target', () => {
		const request = spotlightQuery({
			archetypeId: 7,
			scope: 'minPoints',
			minPoints: 12,
			board: 'mainboard',
			conversionMetric: 'minPoints',
			conversionThreshold: 18,
		});

		expect(request?.query).toEqual({ scope: 'minPoints', minPoints: 12, board: 'mainboard', conversionMetric: 'minPoints', conversionThreshold: 18 });
		expect(metagameArchetypeDetailQuerySchema.parse(request!.query)).toMatchObject({ scope: 'minPoints', minPoints: 12, conversionThreshold: 18 });
	});

	it('scopes to its Player List only while the scope names one', () => {
		expect(spotlightQuery({ archetypeId: 7, scope: 'playerList', playerListId: 3 })?.query).toMatchObject({ scope: 'playerList', playerListId: 3 });
		expect(spotlightQuery({ archetypeId: 7, scope: 'all', playerListId: 3 })?.query).not.toHaveProperty('playerListId');
	});
});
