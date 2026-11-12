import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import type { ScreenMode } from '~~/shared/types/enums';
import { describe, expect, it } from 'vitest';
import { SCREEN_MODES, screenModeConfigContract } from '~~/shared/screenModes';

/** Every sort and limit field of a paged mode, by `mode.key`. */
const SORT_AND_LIMIT_FIELDS = (Object.keys(SCREEN_MODES) as ScreenMode[])
	.filter(mode => SCREEN_MODES[mode].pageRotation !== undefined)
	.flatMap(mode => Object.values(screenModeConfigContract(mode).fields as Record<string, ScreenModeConfigField>)
		.filter(field => /sort|limit/i.test(field.key))
		.map(field => ({ name: `${mode}.${field.key}`, field })));

// A sort or limit reorders or recounts the rows a Page Rotation pages, so the page shown would no longer be the one chosen.
describe('a paged Screen Mode\'s sort and limit fields', () => {
	it.each(SORT_AND_LIMIT_FIELDS)('$name returns to page 1 when edited', ({ field }) => {
		const context = { config: {}, event: null, hasPlayerLists: false };
		const writesFirstPage = field.card === 'source'
			|| field.writesWith?.(undefined, context)?.currentPage === 1;

		expect(writesFirstPage).toBe(true);
	});

	it('covers the modes that sort or limit', () => {
		expect(SORT_AND_LIMIT_FIELDS.map(entry => entry.name)).toEqual(expect.arrayContaining([
			'metagame.sortBy',
			'metagame.limit',
			'top-cards.sortBy',
			'top-cards.limit',
		]));
	});
});
