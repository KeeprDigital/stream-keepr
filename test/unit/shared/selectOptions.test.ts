import { describe, expect, it } from 'vitest';
import { SCREEN_MODES } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { SCREEN_MODE_SELECT_OPTIONS } from '~~/shared/utils/selectOptions';

describe('selectOptions', () => {
	it('offers every Screen Mode, labelled from its definition', () => {
		expect(SCREEN_MODE_SELECT_OPTIONS).toEqual(
			SCREEN_MODE_VALUES.map(value => ({
				label: SCREEN_MODES[value].label,
				value,
			})),
		);
	});
});
