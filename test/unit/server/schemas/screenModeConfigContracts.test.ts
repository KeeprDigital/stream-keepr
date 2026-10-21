import type { ScreenMode } from '~~/shared/types/enums';
import { describe, expect, it } from 'vitest';
import {
	modeConfigPatchSchemaMap,
	modeConfigSchemaMap,
	modeConfigsMapSchema,
	parseModeConfigPatchResult,
} from '~~/server/schemas/api/screen';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { getDefaultConfigForMode, resolveScreenModeConfig } from '~~/shared/types/screenConfig';

/**
 * One config contract per Screen Mode (#587 → #588 → #589).
 *
 * A mode on its contract has its config type, defaults, and PATCH form from one
 * source. A mode still on the old form is pending: it is named here, so the list
 * shrinks as each one migrates, and moving a mode onto its contract without
 * taking it off this list fails the first test below.
 */
const PENDING_MODES: readonly ScreenMode[] = [
	'background',
	'card',
	'deck',
	'standings',
	'topCut',
	'feature-match',
	'feature-match-overlay',
	'broadcast-graphics',
	'top-cards',
	'player-history',
];

const contractModes = SCREEN_MODE_VALUES.filter(mode => screenModeConfigContract(mode) !== undefined);

it('names every Screen Mode exactly once, as on its config contract or pending', () => {
	expect([...contractModes, ...PENDING_MODES].toSorted()).toEqual([...SCREEN_MODE_VALUES].toSorted());
});

describe.each(contractModes)('the %s config contract', (mode) => {
	const contract = screenModeConfigContract(mode)!;
	const patchSchema = modeConfigPatchSchemaMap[mode];

	it('is where the mode\'s defaults come from', () => {
		expect(getDefaultConfigForMode(mode)).toBe(contract.defaults);
	});

	it('parses its defaults unchanged against its schema and both write paths', () => {
		expect(contract.schema.parse(contract.defaults)).toEqual(contract.defaults);
		expect(modeConfigSchemaMap[mode].parse(contract.defaults)).toEqual(contract.defaults);
		expect(modeConfigsMapSchema.parse({ [mode]: contract.defaults })).toEqual({ [mode]: contract.defaults });
	});

	it('round-trips its defaults through a PATCH onto a new Screen', () => {
		const patch = patchSchema.parse(contract.defaults) as Record<string, unknown>;
		const stored = parseModeConfigPatchResult({}, mode, patch);

		expect(patch).toEqual(contract.defaults);
		expect(resolveScreenModeConfig(stored, mode)).toEqual(contract.defaults);
	});

	it('injects nothing a PATCH leaves out', () => {
		expect(patchSchema.parse({})).toEqual({});
	});

	it.each(Object.entries(contract.defaults))('takes %s on its own, and null puts its default back', (key, value) => {
		expect(patchSchema.parse({ [key]: value })).toEqual({ [key]: value });

		const cleared = parseModeConfigPatchResult({}, mode, patchSchema.parse({ [key]: null }) as Record<string, unknown>);
		expect(Object.keys(cleared[mode] ?? {})).not.toContain(key);
		expect(resolveScreenModeConfig(cleared, mode)).toEqual(contract.defaults);
	});
});

describe('modes pending a config contract', () => {
	it.each(PENDING_MODES)('%s', (mode) => {
		expect(screenModeConfigContract(mode)).toBeUndefined();
	});
	for (const mode of PENDING_MODES)
		it.todo(`${mode}: move onto its config contract (#588, #589)`);
});
