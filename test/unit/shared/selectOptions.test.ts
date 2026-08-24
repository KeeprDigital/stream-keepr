import { describe, expect, it } from 'vitest';
import { SCREEN_MODES } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import {
	CARD_ANIMATION_SPEED_SELECT_OPTIONS,
	DECK_BOARD_VIEW_SELECT_OPTIONS,
	DECK_CARD_SIZE_SELECT_OPTIONS,
	FEATURE_MATCH_ORIENTATION_SELECT_OPTIONS,
	GAME_SELECT_OPTIONS,
	HORIZONTAL_ALIGN_SELECT_OPTIONS,
	POSITION_FORMAT_SELECT_OPTIONS,
	QUANTITY_POSITION_SELECT_OPTIONS,
	QUANTITY_SIZE_SELECT_OPTIONS,
	RECORD_SEPARATOR_SELECT_OPTIONS,
	SCREEN_COLOR_MODE_SELECT_OPTIONS,
	SCREEN_MODE_SELECT_OPTIONS,
	SIDEBOARD_PLACEMENT_SELECT_OPTIONS,
	VERTICAL_ALIGN_SELECT_OPTIONS,
} from '~~/shared/utils/selectOptions';

describe('selectOptions', () => {
	it('gAME_SELECT_OPTIONS has mtg and op', () => {
		const values = GAME_SELECT_OPTIONS.map(o => o.value);
		expect(values).toContain('mtg');
		expect(values).toContain('op');
	});

	it('fEATURE_MATCH_ORIENTATION_SELECT_OPTIONS has horizontal and vertical', () => {
		const values = FEATURE_MATCH_ORIENTATION_SELECT_OPTIONS.map(o => o.value);
		expect(values).toContain('horizontal');
		expect(values).toContain('vertical');
	});

	it('rECORD_SEPARATOR_SELECT_OPTIONS has all separators', () => {
		expect(RECORD_SEPARATOR_SELECT_OPTIONS).toHaveLength(4);
	});

	it('pOSITION_FORMAT_SELECT_OPTIONS has ordinal and number', () => {
		const values = POSITION_FORMAT_SELECT_OPTIONS.map(o => o.value);
		expect(values).toContain('ordinal');
		expect(values).toContain('number');
	});

	it('sCREEN_COLOR_MODE_SELECT_OPTIONS has light, dark, system', () => {
		const values = SCREEN_COLOR_MODE_SELECT_OPTIONS.map(o => o.value);
		expect(values).toEqual(expect.arrayContaining(['light', 'dark', 'system']));
	});

	it('sCREEN_MODE_SELECT_OPTIONS contains all modes', () => {
		expect(SCREEN_MODE_SELECT_OPTIONS).toEqual(
			SCREEN_MODE_VALUES.map(value => ({
				label: SCREEN_MODES[value].label,
				value,
			})),
		);
	});

	it('dECK_CARD_SIZE_SELECT_OPTIONS has small, medium, large', () => {
		const values = DECK_CARD_SIZE_SELECT_OPTIONS.map(o => o.value);
		expect(values).toEqual(['small', 'medium', 'large']);
	});

	it('qUANTITY_POSITION_SELECT_OPTIONS has 8 positions', () => {
		expect(QUANTITY_POSITION_SELECT_OPTIONS).toHaveLength(8);
		const values = QUANTITY_POSITION_SELECT_OPTIONS.map(o => o.value);
		expect(values).toContain('top-left');
		expect(values).toContain('bottom-right');
	});

	it('qUANTITY_SIZE_SELECT_OPTIONS has small, medium, large', () => {
		const values = QUANTITY_SIZE_SELECT_OPTIONS.map(o => o.value);
		expect(values).toEqual(['small', 'medium', 'large']);
	});

	it('dECK_BOARD_VIEW_SELECT_OPTIONS has grid, stack, and list', () => {
		const values = DECK_BOARD_VIEW_SELECT_OPTIONS.map(o => o.value);
		expect(values).toEqual(['grid', 'stack', 'list']);
	});

	it('sIDEBOARD_PLACEMENT_SELECT_OPTIONS has beside and below', () => {
		const values = SIDEBOARD_PLACEMENT_SELECT_OPTIONS.map(o => o.value);
		expect(values).toEqual(['beside', 'below']);
	});

	it('hORIZONTAL_ALIGN_SELECT_OPTIONS has left, center, right', () => {
		const values = HORIZONTAL_ALIGN_SELECT_OPTIONS.map(o => o.value);
		expect(values).toEqual(['left', 'center', 'right']);
	});

	it('vERTICAL_ALIGN_SELECT_OPTIONS has top, center, bottom', () => {
		const values = VERTICAL_ALIGN_SELECT_OPTIONS.map(o => o.value);
		expect(values).toEqual(['top', 'center', 'bottom']);
	});

	it('all options have label and value', () => {
		const allOptions = [
			...GAME_SELECT_OPTIONS,
			...FEATURE_MATCH_ORIENTATION_SELECT_OPTIONS,
			...RECORD_SEPARATOR_SELECT_OPTIONS,
			...POSITION_FORMAT_SELECT_OPTIONS,
			...SCREEN_COLOR_MODE_SELECT_OPTIONS,
			...SCREEN_MODE_SELECT_OPTIONS,
			...CARD_ANIMATION_SPEED_SELECT_OPTIONS,
			...DECK_CARD_SIZE_SELECT_OPTIONS,
			...QUANTITY_POSITION_SELECT_OPTIONS,
			...QUANTITY_SIZE_SELECT_OPTIONS,
			...DECK_BOARD_VIEW_SELECT_OPTIONS,
			...SIDEBOARD_PLACEMENT_SELECT_OPTIONS,
			...HORIZONTAL_ALIGN_SELECT_OPTIONS,
			...VERTICAL_ALIGN_SELECT_OPTIONS,
		];
		for (const opt of allOptions) {
			expect(opt).toHaveProperty('label');
			expect(opt).toHaveProperty('value');
			expect(typeof opt.label).toBe('string');
		}
	});
});
