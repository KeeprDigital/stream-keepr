import { describe, expect, it } from 'vitest';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { modeConfigPatchSchemaMap, modeConfigsMapSchema, parseModeConfigPatchResult } from '~~/server/schemas/api/screen';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { getDisplayDefaultsForMode, resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { createMockScreen } from '~~/test/helpers/fixtures';

/**
 * A field a mode's config contract dropped, such as Top Cut Bracket's placeholder
 * `bracketSize` (#752), may still be in storage. A Screen storing one still
 * loads and saves: no reader sees the field, a write naming it is accepted
 * without storing it, and the next write of the mode's config removes it.
 */
describe('a Top Cut Bracket Screen storing the dropped bracketSize', () => {
	const stored = {
		'top-cut': { bracketSize: 16, phaseId: 4 },
	};

	it('declares bracketSize a former field of the Top Cut Bracket contract', () => {
		expect(screenModeConfigContract('top-cut').formerFields).toEqual(['bracketSize']);
		expect(getDisplayDefaultsForMode('top-cut')).not.toHaveProperty('bracketSize');
	});

	it('reads without it, everywhere it is read', () => {
		expect(resolveScreenModeConfig(stored, 'top-cut')).not.toHaveProperty('bracketSize');
		expect(resolveScreenModeConfig(stored, 'top-cut').phaseId).toBe(4);
		expect(mapScreenToResponse(createMockScreen({ modeConfigs: stored })).modeConfigs).toEqual({
			'top-cut': { phaseId: 4 },
		});
	});

	it('saves through a full write that still names it, as a client that read it before sends it, without storing it', () => {
		expect(JSON.parse(JSON.stringify(modeConfigsMapSchema.parse(stored)))).toEqual({
			'top-cut': { phaseId: 4 },
		});
	});

	it('loses it on the next PATCH of Top Cut Bracket config, whether or not the PATCH names it', () => {
		const phasePatch = modeConfigPatchSchemaMap['top-cut'].parse({ phaseId: 5 }) as Record<string, unknown>;
		const resetPatch = modeConfigPatchSchemaMap['top-cut'].parse({ bracketSize: 8 }) as Record<string, unknown>;

		expect(parseModeConfigPatchResult(stored, 'top-cut', phasePatch)).toEqual({
			'top-cut': { phaseId: 5 },
		});
		expect(parseModeConfigPatchResult(stored, 'top-cut', resetPatch)).toEqual({
			'top-cut': { phaseId: 4 },
		});
	});

	it('is still refused as a field of any other mode', () => {
		expect(modeConfigPatchSchemaMap.standings.safeParse({ bracketSize: 8 }).success).toBe(false);
	});
});

/**
 * A look field that became a Mode Token (#824), top-level or inside a nested
 * block, reads, saves and leaves storage like any former field.
 */
describe.each([
	{
		mode: 'card',
		stored: { scale: 1.5, animationSpeed: 'fast' },
		reads: { animationSpeed: 'fast' },
		patch: { animationEnabled: false },
		patched: { animationSpeed: 'fast', animationEnabled: false },
	},
	{
		mode: 'deck',
		stored: {
			quantityBgColor: '#7c3aed',
			mainboard: {
				view: 'grid',
				columns: 6,
				cardSize: 'large',
				cardGap: 12,
			},
			sideboard: { stackOverlap: 20 },
		},
		reads: {
			mainboard: { view: 'grid', columns: 6 },
			sideboard: {},
		},
		patch: { showDeckName: false },
		patched: {
			mainboard: { view: 'grid', columns: 6 },
			sideboard: {},
			showDeckName: false,
		},
	},
] as const)('a $mode Screen storing a look field that is now a Mode Token', ({ mode, stored, reads, patch, patched }) => {
	it('reads without it, everywhere it is read', () => {
		expect(screenModeConfigContract(mode).readStored(stored)).toEqual(reads);
		expect(mapScreenToResponse(createMockScreen({
			modeConfigs: { [mode]: stored },
		})).modeConfigs).toEqual({ [mode]: reads });
	});

	it('saves through a full write and a PATCH that still name it, and loses it on that PATCH', () => {
		expect(JSON.parse(JSON.stringify(modeConfigsMapSchema.parse({ [mode]: stored })))).toEqual({ [mode]: reads });
		const echoed = modeConfigPatchSchemaMap[mode].parse({
			...stored,
			...patch,
		}) as Record<string, unknown>;
		expect(parseModeConfigPatchResult({ [mode]: stored }, mode, echoed)).toEqual({ [mode]: patched });
	});
});
