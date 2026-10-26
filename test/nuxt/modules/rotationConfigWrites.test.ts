import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { useRotationConfigWrites } from '~/modules/screen-mode/rotationWrites';

/**
 * Operator surfaces write the Rotation Anchor on exactly three occasions:
 * enabling auto-page, an edit that changes the rotation's shape, and a manual
 * page selection while the rotation runs. Every minted anchor is an integer,
 * because the synchronized clock estimate is an RTT-averaged float while the
 * config schema stores an integer timestamp.
 */

const mockIsSynced = ref(true);
let mockServerNow = 1_000_000.25; // deliberately fractional, like a real sync

mockNuxtImport('useServerTime', () => () => ({
	isSynced: mockIsSynced,
	serverTimeOffset: ref(0),
	getServerTime: () => mockServerNow,
}));

function harness(overrides: { autoPageEnabled?: boolean; rotationAnchor?: number; currentPage?: number } = {}) {
	const saveConfig = vi.fn();
	const rowCount = ref(20); // 4 pages of 5
	const state = reactive({
		...getDefaultConfigForMode('standings'),
		autoPageEnabled: overrides.autoPageEnabled ?? true,
		autoPageIntervalMs: 10_000,
		currentPage: overrides.currentPage ?? 1,
		rotationAnchor: overrides.rotationAnchor,
		rowsPerPage: 5,
	});
	const writes = useRotationConfigWrites({
		mode: 'standings',
		config: computed(() => state),
		rowCount,
		saveConfig,
	});
	return { writes, saveConfig, state, rowCount };
}

describe('useRotationConfigWrites', () => {
	beforeEach(() => {
		mockIsSynced.value = true;
		mockServerNow = 1_000_000.25;
	});

	it('occasion 1 — enabling auto-page restarts the rotation with an integer anchor now', () => {
		const { writes, saveConfig } = harness({ autoPageEnabled: false });

		writes.setAutoPageEnabled(true);

		expect(saveConfig).toHaveBeenCalledWith({ autoPageEnabled: true, rotationAnchor: 1_000_000 });
	});

	it('disabling auto-page writes no anchor', () => {
		const { writes, saveConfig } = harness();

		writes.setAutoPageEnabled(false);

		expect(saveConfig).toHaveBeenCalledWith({ autoPageEnabled: false });
	});

	it('occasion 2 — a rotation-shape edit re-anchors while rotating, and not otherwise', () => {
		const rotating = harness({ currentPage: 3 });
		rotating.writes.updateConfig({ autoPageIntervalMs: 5_000 });
		expect(rotating.saveConfig).toHaveBeenCalledWith({ autoPageIntervalMs: 5_000, rotationAnchor: 1_000_000 });

		const manual = harness({ autoPageEnabled: false, currentPage: 3 });
		manual.writes.updateConfig({ autoPageIntervalMs: 5_000 });
		expect(manual.saveConfig).toHaveBeenCalledWith({ autoPageIntervalMs: 5_000 });
	});

	it('a Standings page size edit resets the selected page to 1, as Metagame\'s does', () => {
		const { writes, saveConfig } = harness({ autoPageEnabled: false, currentPage: 3 });

		writes.updateConfig({ rowsPerPage: 8 });

		expect(saveConfig).toHaveBeenCalledWith({ rowsPerPage: 8, currentPage: 1 });
	});

	it('writes an edit that leaves the rotation\'s shape alone as it is', () => {
		const { writes, saveConfig } = harness({ currentPage: 3 });

		writes.updateConfig({ headerText: 'Top 8' });

		expect(saveConfig).toHaveBeenCalledWith({ headerText: 'Top 8' });
	});

	it('occasion 3 — manual selection while rotating re-anchors so the page holds a full duration', () => {
		const { writes, saveConfig } = harness({ rotationAnchor: 1_000_000 });

		writes.adminSetPage(3);

		expect(saveConfig).toHaveBeenCalledWith({ rotationAnchor: 1_000_000 - 20_000 });
	});

	it('manual selection with auto-page off persists the page number as before', () => {
		const { writes, saveConfig } = harness({ autoPageEnabled: false, currentPage: 2 });

		writes.adminNextPage();

		expect(saveConfig).toHaveBeenCalledWith({ currentPage: 3 });
	});

	it('currentPage tracks the live projection while rotating', () => {
		// Anchor 15s ago of 10s pages → page 2 of 4.
		const { writes } = harness({ rotationAnchor: mockServerNow - 15_000 });
		expect(writes.currentPage.value).toBe(2);
	});

	it('counts pages by the page size field the mode declares', () => {
		const { writes, state } = harness();
		expect(writes.totalPages.value).toBe(4);

		state.rowsPerPage = 8;
		expect(writes.totalPages.value).toBe(3);
	});

	it('a manual selection never picks a page beyond the real last page', () => {
		const { writes, saveConfig } = harness({ autoPageEnabled: false });

		writes.adminSetPage(9);
		writes.adminSetPage(0);

		expect(saveConfig.mock.calls).toEqual([
			[
				{ currentPage: 4 },
			],
			[
				{ currentPage: 1 },
			],
		]);
	});

	it('a manual selection while rotating anchors at most the real last page', () => {
		const { writes, saveConfig } = harness({ rotationAnchor: 1_000_000 });

		writes.adminSetPage(9);

		// Page 4 of 10 s pages: current from 30 s after the anchor.
		expect(saveConfig).toHaveBeenCalledWith({ rotationAnchor: 1_000_000 - 30_000 });
	});

	it('pages from the rows it is given, following them as they change', () => {
		const { writes, saveConfig, rowCount } = harness({ autoPageEnabled: false, currentPage: 4 });

		rowCount.value = 7;
		expect(writes.totalPages.value).toBe(2);
		expect(writes.currentPage.value).toBe(2);

		writes.adminNextPage();
		expect(saveConfig).toHaveBeenCalledWith({ currentPage: 1 });
	});
});
