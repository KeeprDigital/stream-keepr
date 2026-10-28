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
			'cardSize',
			'statBadgeSize',
			'dynamicCardSize',
			'rowsPerPage',
			'badgeSize',
			'showCardNames',
		],
		former: {
			rankBadgeTextColor: '#ffffff',
			rankBadgeBgColor: '#7c3aed',
			statBadgeTextColor: '#111827',
			statBadgeBgColor: '#ffffff',
			cardSize: 'large',
			statBadgeSize: 'small',
			dynamicCardSize: true,
			rowsPerPage: 2,
			badgeSize: 14,
			showCardNames: true,
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

/**
 * A look field that became a Mode Token (#824, #844), top-level or inside a
 * nested block, reads, saves and leaves storage like any former field.
 */
describe.each([
	{
		mode: 'card',
		stored: {
			scale: 1.5,
			animationEnabled: true,
			animationSpeed: 'fast',
			featureMatchId: 3,
		},
		reads: { featureMatchId: 3 },
		patch: { featureMatchId: 4 },
		patched: { featureMatchId: 4 },
	},
	{
		mode: 'deck',
		stored: {
			quantityBgColor: '#7c3aed',
			quantitySize: 'large',
			highlanderPointsSize: 'small',
			deckMetaPillSize: 'large',
			highlanderPointedCardsSize: 'small',
			mainboard: {
				view: 'grid',
				columns: 6,
				cardSize: 'large',
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
	// `cardSizing` replaced it (ADR-0054); 0014 migrated stored values, so a straggler reads as the default.
	{
		mode: 'deck',
		stored: {
			mainboard: { view: 'grid', dynamicCardSize: true },
			sideboard: { view: 'stack', dynamicCardSize: false },
		},
		reads: {
			mainboard: { view: 'grid' },
			sideboard: { view: 'stack' },
		},
		patch: { showDeckName: false },
		patched: {
			mainboard: { view: 'grid' },
			sideboard: { view: 'stack' },
			showDeckName: false,
		},
	},
	{
		mode: 'standings',
		stored: { maxTableWidth: 1200, animateEntries: false, topNCount: 8 },
		reads: { topNCount: 8 },
		patch: { topNCount: 16 },
		patched: { topNCount: 16 },
	},
	{
		mode: 'metagame',
		stored: { maxTableWidth: 1200, animateEntries: false, limit: 20 },
		reads: { limit: 20 },
		patch: { limit: 30 },
		patched: { limit: 30 },
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
