import { describe, expect, it } from 'vitest';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { modeConfigPatchSchemaMap, modeConfigsMapSchema, parseModeConfigPatchResult } from '~~/server/schemas/api/screen';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { getDisplayDefaultsForMode, resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { createMockScreen } from '~~/test/helpers/fixtures';

/**
 * A field a mode's config contract dropped may still be in storage. A Screen
 * storing one still loads and saves: no reader sees the field, a write naming
 * it is accepted without storing it, and the next write of the mode's config removes it.
 */
describe.each([
	{
		mode: 'top-cut' as const,
		formerFields: ['bracketSize'],
		former: { bracketSize: 16 },
		kept: { phaseId: 4 },
		patch: { phaseId: 5 },
	},
	{
		mode: 'top-cards' as const,
		formerFields: [
			'rankBadgeTextColor',
			'rankBadgeBgColor',
			'statBadgeTextColor',
			'statBadgeBgColor',
		],
		former: {
			rankBadgeTextColor: '#ffffff',
			rankBadgeBgColor: '#7c3aed',
			statBadgeTextColor: '#111827',
			statBadgeBgColor: '#ffffff',
		},
		kept: { limit: 12 },
		patch: { limit: 15 },
	},
])('a $mode Screen storing its dropped $formerFields', ({ mode, formerFields, former, kept, patch }) => {
	const stored = {
		[mode]: {
			...former,
			...kept,
		},
	};

	it('declares them former fields of its contract', () => {
		expect(screenModeConfigContract(mode).formerFields).toEqual(formerFields);
		for (const field of formerFields)
			expect(getDisplayDefaultsForMode(mode)).not.toHaveProperty(field);
	});

	it('reads without them, everywhere it is read', () => {
		expect(resolveScreenModeConfig(stored, mode)).toMatchObject(kept);
		for (const field of formerFields)
			expect(resolveScreenModeConfig(stored, mode)).not.toHaveProperty(field);
		expect(mapScreenToResponse(createMockScreen({ modeConfigs: stored })).modeConfigs).toEqual({
			[mode]: kept,
		});
	});

	it('saves through a full write that still names them, as a client that read it before sends it, without storing them', () => {
		expect(JSON.parse(JSON.stringify(modeConfigsMapSchema.parse(stored)))).toEqual({
			[mode]: kept,
		});
	});

	it('loses them on the next PATCH of its config, whether or not the PATCH names them', () => {
		const changePatch = modeConfigPatchSchemaMap[mode].parse(patch) as Record<string, unknown>;
		const resetPatch = modeConfigPatchSchemaMap[mode].parse(former) as Record<string, unknown>;

		expect(parseModeConfigPatchResult(stored, mode, changePatch)).toEqual({
			[mode]: patch,
		});
		expect(parseModeConfigPatchResult(stored, mode, resetPatch)).toEqual({
			[mode]: kept,
		});
	});

	it('is still refused as a field of any other mode', () => {
		expect(modeConfigPatchSchemaMap.standings.safeParse(former).success).toBe(false);
	});
});
