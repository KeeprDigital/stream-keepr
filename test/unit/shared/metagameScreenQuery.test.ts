import type { ModeConfigsMap } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { metagameArchetypesQuerySchema } from '~~/server/schemas/api/metagame';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { metagameScreenQuery } from '~~/shared/utils/metagameQuery';

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

	it('leaves the card breakdown without a conversion target', () => {
		expect(screenQuery({ viewMode: 'cards' }).query).not.toHaveProperty('conversionMetric');
	});
});
