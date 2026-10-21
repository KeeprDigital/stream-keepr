import { describe, expect, it } from 'vitest';
import { pageRotationEdit } from '~~/shared/modules/page-rotation';
import { DEFAULT_PAGE_ROTATION, pageRotationPageSize, pageRotationShape } from '~~/shared/screenModeConfigs/subShapes';
import { SCREEN_MODES } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

/**
 * Page Rotation is a capability a Screen Mode Definition declares (ADR-0039):
 * every declaring mode carries the one shared set of rotation fields, and one
 * rule decides which edits change the rotation's shape, for every one of them.
 */

const NOW = 1_000_000.25; // fractional, like a synchronized clock estimate

const paginated = SCREEN_MODE_VALUES.flatMap((mode) => {
	const pageRotation = SCREEN_MODES[mode].pageRotation;
	return pageRotation ? [{ mode, pageRotation, declared: `${mode}.${pageRotation.pageSize}` }] : [];
});

describe('screen Mode Page Rotation', () => {
	it('is declared by every paginated mode, naming its page size field', () => {
		expect(paginated.map(({ declared }) => declared)).toEqual([
			'standings.rowsPerPage',
			'metagame.pageSize',
			'player-history.rowsPerPage',
		]);
	});

	it('leaves every other mode without a rotation field', () => {
		const undeclared = SCREEN_MODE_VALUES.filter(mode => !SCREEN_MODES[mode].pageRotation);
		for (const mode of undeclared) {
			for (const field of Object.keys(pageRotationShape))
				expect(SCREEN_MODES[mode].config.shape, `${mode}.${field}`).not.toHaveProperty(field);
		}
	});

	describe.each(paginated)('$mode', ({ mode, pageRotation }) => {
		const contract = SCREEN_MODES[mode].config;
		const pageSizeEdit = { [pageRotation.pageSize]: 4 };
		const durationEdit = { autoPageIntervalMs: 5_000 };

		it('carries the shared rotation fields, validation and defaults', () => {
			for (const [field, schema] of Object.entries(pageRotationShape))
				expect(contract.shape[field], field).toBe(schema);
			expect(contract.shape[pageRotation.pageSize]).toBe(pageRotationPageSize);
			expect(contract.defaults).toMatchObject(DEFAULT_PAGE_ROTATION);
		});

		it('a page size edit while auto-page is on resets to page 1 and moves the Rotation Anchor', () => {
			expect(pageRotationEdit(pageRotation, { autoPageEnabled: true }, pageSizeEdit, NOW))
				.toEqual({ ...pageSizeEdit, currentPage: 1, rotationAnchor: 1_000_000 });
		});

		it('a page size edit with auto-page off resets to page 1 and writes no anchor', () => {
			expect(pageRotationEdit(pageRotation, { autoPageEnabled: false }, pageSizeEdit, NOW))
				.toEqual({ ...pageSizeEdit, currentPage: 1 });
		});

		it('a page duration edit while auto-page is on moves the Rotation Anchor, restarting from page 1', () => {
			expect(pageRotationEdit(pageRotation, { autoPageEnabled: true }, durationEdit, NOW))
				.toEqual({ ...durationEdit, rotationAnchor: 1_000_000 });
		});

		it('a page duration edit with auto-page off is written as it is', () => {
			expect(pageRotationEdit(pageRotation, { autoPageEnabled: false }, durationEdit, NOW)).toEqual(durationEdit);
		});

		it('writes any other edit as it is', () => {
			const patch = { headerText: 'Top 8' };
			expect(pageRotationEdit(pageRotation, { autoPageEnabled: true }, patch, NOW)).toEqual(patch);
		});
	});
});
