import { describe, expect, it } from 'vitest';
import {
	modeConfigCompleteSchemaMap,
	modeConfigPatchSchemaMap,
	modeConfigSchemaMap,
	modeConfigsMapSchema,
	parseModeConfigPatchResult,
} from '~~/server/schemas/api/screen';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { getDefaultConfigForMode, getDisplayDefaultsForMode, resolveScreenModeConfig } from '~~/shared/types/screenConfig';

/**
 * One config contract per Screen Mode (ADR-0037).
 *
 * Every mode's config type, defaults, and write forms come from its contract.
 * Its defaults parse against its complete schema and both write paths and
 * round-trip through a PATCH, which injects nothing it leaves out; `null` cannot
 * delete an authored stack.
 */
it('declares the Background Layer stack and the Broadcast Graphics stack authored, and nothing else', () => {
	const declared = Object.fromEntries(SCREEN_MODE_VALUES
		.map(mode => [mode, screenModeConfigContract(mode).authoredStacks] as const)
		.filter(([, stacks]) => stacks.length > 0));

	expect(declared).toEqual({
		'background': ['layers'],
		'broadcast-graphics': ['graphics'],
	});
});

describe.each(SCREEN_MODE_VALUES)('the %s config contract', (mode) => {
	const contract = screenModeConfigContract(mode);
	const defaults = getDefaultConfigForMode(mode);
	const patchSchema = modeConfigPatchSchemaMap[mode];

	it('has defaults that parse unchanged against the complete config and both write paths', () => {
		expect(modeConfigCompleteSchemaMap[mode].parse(defaults)).toEqual(defaults);
		expect(modeConfigSchemaMap[mode].parse(defaults)).toEqual(defaults);
		expect(modeConfigsMapSchema.parse({ [mode]: defaults })).toEqual({ [mode]: defaults });
	});

	it('round-trips its defaults through a PATCH onto a new Screen', () => {
		const patch = patchSchema.parse(defaults) as Record<string, unknown>;
		const stored = parseModeConfigPatchResult({}, mode, patch);

		expect(patch).toEqual(defaults);
		expect(resolveScreenModeConfig(stored, mode)).toEqual(defaults);
	});

	it('injects nothing a PATCH leaves out', () => {
		expect(patchSchema.parse({})).toEqual({});
	});

	const authoredStacks: readonly string[] = contract.authoredStacks;

	it.each(authoredStacks)('replaces its authored %s stack, but refuses to delete it with null', (key) => {
		// `null` deletes a stored key, which would empty an authored stack with no
		// way back; a display reset leaves one alone for the same reason.
		const stack = (contract.defaults as Record<string, unknown>)[key];

		expect(patchSchema.parse({ [key]: stack })).toEqual({ [key]: stack });
		expect(patchSchema.safeParse({ [key]: null }).success).toBe(false);
		expect(getDisplayDefaultsForMode(mode)).not.toHaveProperty(key);
	});

	it('saves what storage holds back through a full write unchanged, as the Edit Screen dialog sends it', () => {
		// PATCHes leave a fragment, and a display reset writes every default but the
		// preserved keys. Neither may be refused, nor completed into storage.
		for (const stored of [
			{},
			getDisplayDefaultsForMode(mode),
		])
			expect(modeConfigsMapSchema.parse({ [mode]: stored })).toEqual({ [mode]: stored });
	});
});

// The Archetype filter was stored as an Archetype's name until it became an
// Event Reference (#1153); the name is a former field of both modes (ADR-0037).
describe.each(['metagame', 'top-cards'] as const)('the %s former archetype filter name', (mode) => {
	it('is accepted in a stale client\'s full write without being stored, and is never read', () => {
		const stale = {
			[mode]: { archetypeFilter: 'Mono Red', topN: 16 },
		};

		expect(modeConfigsMapSchema.parse(stale)).toEqual({
			[mode]: { topN: 16 },
		});
		expect(resolveScreenModeConfig(stale as never, mode)).not.toHaveProperty('archetypeFilter');
	});
});

// A table mode's max width is Auto, stored as absent, or a width within the Event Canvas bounds.
describe.each(['standings', 'metagame'] as const)('the %s max width', (mode) => {
	it.each([
		[99, false],
		[100, true],
		[7680, true],
		[7681, false],
	])('takes %d px: %s', (maxWidth, accepted) => {
		expect(modeConfigPatchSchemaMap[mode].safeParse({ maxWidth }).success).toBe(accepted);
	});

	it('is Auto on a Screen storing none, and again once cleared', () => {
		const cleared = parseModeConfigPatchResult({
			[mode]: { maxWidth: 1200 },
		}, mode, modeConfigPatchSchemaMap[mode].parse({ maxWidth: null }) as Record<string, unknown>);

		expect(resolveScreenModeConfig({}, mode).maxWidth).toBeUndefined();
		expect(resolveScreenModeConfig({
			[mode]: { maxWidth: 1200 },
		}, mode).maxWidth).toBe(1200);
		expect(resolveScreenModeConfig(cleared, mode).maxWidth).toBeUndefined();
	});
});
