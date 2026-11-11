import { describe, expect, it } from 'vitest';
import { modeConfigPatchSchemaMap, parseModeConfigPatchResult } from '~~/server/schemas/api/screen';
import { getDisplayDefaultsForMode, resolveScreenModeConfig, toModeConfigPatch } from '~~/shared/types/screenConfig';

// A card badge's size is Auto, stored as absent, or a text size in px from 8 to 48.
// A size stored before Auto existed, the former default included, stays that px.
const BADGE_SIZES = [
	{ mode: 'top-cards', field: 'rankBadgeTextSize' },
	{ mode: 'top-cards', field: 'statBadgeTextSize' },
	{ mode: 'top-cards', field: 'pointsBadgeTextSize' },
	{ mode: 'deck', field: 'quantityBadgeSize' },
	{ mode: 'deck', field: 'pointsBadgeSize' },
] as const;

describe.each(BADGE_SIZES)('the $mode $field', ({ mode, field }) => {
	it.each([
		{ value: 7, accepted: false },
		{ value: 8, accepted: true },
		{ value: 48, accepted: true },
		{ value: 49, accepted: false },
		{ value: null, accepted: true },
	])('takes $value: $accepted', ({ value, accepted }) => {
		expect(modeConfigPatchSchemaMap[mode].safeParse({ [field]: value }).success).toBe(accepted);
	});

	it.each([
		{ name: 'storing none', stored: {}, reads: undefined },
		{
			name: 'storing the former default',
			stored: { [field]: 14 },
			reads: 14,
		},
		{
			name: 'storing a size',
			stored: { [field]: 30 },
			reads: 30,
		},
	])('reads a Screen $name as $reads', ({ stored, reads }) => {
		expect(resolveScreenModeConfig({ [mode]: stored }, mode)[field as never]).toBe(reads);
	});

	it('is Auto again once cleared, by its field or a display reset', () => {
		const stored = {
			[mode]: { [field]: 30 },
		};
		const cleared = parseModeConfigPatchResult(stored, mode, modeConfigPatchSchemaMap[mode].parse({ [field]: null }) as Record<string, unknown>);
		const reset = parseModeConfigPatchResult(stored, mode, modeConfigPatchSchemaMap[mode].parse(toModeConfigPatch(mode, getDisplayDefaultsForMode(mode))) as Record<string, unknown>);

		expect(resolveScreenModeConfig(cleared, mode)[field as never]).toBeUndefined();
		expect(resolveScreenModeConfig(reset, mode)[field as never]).toBeUndefined();
	});
});
