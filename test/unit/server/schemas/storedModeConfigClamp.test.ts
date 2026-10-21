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
	const stored = { standings: { topNCount: 900, rowsPerPage: 0, showHeader: false } };

	it('reads clamped into range, keeping everything else it stored', () => {
		const config = resolveScreenModeConfig(stored, 'standings');

		expect(config.topNCount).toBe(500);
		expect(config.rowsPerPage).toBe(1);
		expect(config.showHeader).toBe(false);
	});

	it('reaches every client clamped, so what an editor sends back is in range', () => {
		const screen = mapScreenToResponse(createMockScreen({ modeConfigs: stored }));

		expect(screen.modeConfigs).toEqual({ standings: { topNCount: 500, rowsPerPage: 1, showHeader: false } });
	});

	it('is still refused as a write', () => {
		expect(modeConfigPatchSchemaMap.standings.safeParse({ topNCount: 900 }).success).toBe(false);
	});
});
