import type { ScreenMode } from '~~/shared/types/enums';
import { describe, expect, it } from 'vitest';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { modeConfigPatchSchemaMap } from '~~/server/schemas/api/screen';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { createMockScreen } from '~~/test/helpers/fixtures';

/**
 * A stored mode config outside its contract's bounds, as one stored before a
 * bound tightened (#498), reads clamped into range everywhere it is read: by a
 * rendering or server reader (`resolveScreenModeConfig`) and by every client,
 * which receives Screens through `mapScreenToResponse`. It is never reset to the
 * defaults and never refused on read. A write of the same value is still refused.
 */
describe('a stored mode config outside its contract\'s bounds', () => {
	const stored = {
		standings: { topNCount: 900, rowsPerPage: 0, showHeader: false },
	};

	it('reads clamped into range, keeping everything else it stored', () => {
		const config = resolveScreenModeConfig(stored, 'standings');

		expect(config.topNCount).toBe(500);
		expect(config.rowsPerPage).toBe(1);
		expect(config.showHeader).toBe(false);
	});

	it('reaches every client clamped, so what an editor sends back is in range', () => {
		const screen = mapScreenToResponse(createMockScreen({ modeConfigs: stored }));

		expect(screen.modeConfigs).toEqual({
			standings: { topNCount: 500, rowsPerPage: 1, showHeader: false },
		});
	});

	it('is still refused as a write', () => {
		expect(modeConfigPatchSchemaMap.standings.safeParse({ topNCount: 900 }).success).toBe(false);
	});
});

/**
 * Every bound #498 tightened to its editor's range: a value the former contract
 * accepted, as production may hold, reads as the nearest bound of the new range,
 * keeps the rest of its fragment, and is refused as a new write.
 */
const TIGHTENED_BOUNDS = [
	{
		mode: 'deck',
		field: 'a board\'s columns',
		stored: {
			mainboard: {
				view: 'stack',
				columns: 16,
			},
			showDeckStats: true,
		},
		reads: {
			mainboard: {
				view: 'stack',
				columns: 12,
			},
			showDeckStats: true,
		},
	},
] as const satisfies readonly { mode: ScreenMode; field: string; stored: Record<string, unknown>; reads: Record<string, unknown> }[];

describe.each(TIGHTENED_BOUNDS)('a $mode config storing $field outside its tightened bound', ({ mode, stored, reads }) => {
	it('reads clamped into the editor\'s range, keeping the rest of its fragment', () => {
		expect(resolveScreenModeConfig({ [mode]: stored }, mode)).toMatchObject(reads);
		expect(mapScreenToResponse(createMockScreen({
			modeConfigs: { [mode]: stored },
		})).modeConfigs).toEqual({ [mode]: reads });
	});

	it('is refused as a new write', () => {
		expect(modeConfigPatchSchemaMap[mode].safeParse(stored).success).toBe(false);
	});
});
