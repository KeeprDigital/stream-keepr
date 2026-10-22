import { describe, expect, it } from 'vitest';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { modeConfigPatchSchemaMap, modeConfigsMapSchema, parseModeConfigPatchResult } from '~~/server/schemas/api/screen';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { getDisplayDefaultsForMode, resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { createMockScreen } from '~~/test/helpers/fixtures';

/**
 * A field a mode's config contract dropped, such as Top Cut's placeholder
 * `bracketSize` (#752), may still be in storage. A Screen storing one still
 * loads and saves: no reader sees the field, a write naming it is accepted
 * without storing it, and the next write of the mode's config removes it.
 */
describe('a Top Cut Screen storing the dropped bracketSize', () => {
	const stored = { topCut: { bracketSize: 16, phaseId: 4 } };

	it('declares bracketSize a former field of the Top Cut contract', () => {
		expect(screenModeConfigContract('topCut').formerFields).toEqual(['bracketSize']);
		expect(getDisplayDefaultsForMode('topCut')).not.toHaveProperty('bracketSize');
	});

	it('reads without it, everywhere it is read', () => {
		expect(resolveScreenModeConfig(stored, 'topCut')).not.toHaveProperty('bracketSize');
		expect(resolveScreenModeConfig(stored, 'topCut').phaseId).toBe(4);
		expect(mapScreenToResponse(createMockScreen({ modeConfigs: stored })).modeConfigs).toEqual({ topCut: { phaseId: 4 } });
	});

	it('saves through a full write that still names it, as a client that read it before sends it, without storing it', () => {
		expect(JSON.parse(JSON.stringify(modeConfigsMapSchema.parse(stored)))).toEqual({ topCut: { phaseId: 4 } });
	});

	it('loses it on the next PATCH of Top Cut config, whether or not the PATCH names it', () => {
		const phasePatch = modeConfigPatchSchemaMap.topCut.parse({ phaseId: 5 }) as Record<string, unknown>;
		const resetPatch = modeConfigPatchSchemaMap.topCut.parse({ bracketSize: 8 }) as Record<string, unknown>;

		expect(parseModeConfigPatchResult(stored, 'topCut', phasePatch)).toEqual({ topCut: { phaseId: 5 } });
		expect(parseModeConfigPatchResult(stored, 'topCut', resetPatch)).toEqual({ topCut: { phaseId: 4 } });
	});

	it('is still refused as a field of any other mode', () => {
		expect(modeConfigPatchSchemaMap.standings.safeParse({ bracketSize: 8 }).success).toBe(false);
	});
});
