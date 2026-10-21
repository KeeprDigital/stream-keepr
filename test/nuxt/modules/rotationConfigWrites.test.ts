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
		rowCount: computed(() => 20), // 4 pages of 5
		saveConfig,
	});
	return { writes, updateConfig: saveConfig, state };
}

describe('useRotationConfigWrites', () => {
	beforeEach(() => {
		mockIsSynced.value = true;
		mockServerNow = 1_000_000.25;
	});

	it('occasion 1 — enabling auto-page restarts the rotation with an integer anchor now', () => {
		const { writes, updateConfig } = harness({ autoPageEnabled: false });

		writes.setAutoPageEnabled(true);

		expect(updateConfig).toHaveBeenCalledWith({ autoPageEnabled: true, rotationAnchor: 1_000_000 });
	});

	it('disabling auto-page writes no anchor', () => {
		const { writes, updateConfig } = harness();

		writes.setAutoPageEnabled(false);

		expect(updateConfig).toHaveBeenCalledWith({ autoPageEnabled: false });
	});

	it('occasion 2 — a rotation-shape edit restarts from page 1, re-anchoring while rotating and not otherwise', () => {
		const rotating = harness({ currentPage: 3 });
		rotating.writes.updateConfig({ rowsPerPage: 8 });
		expect(rotating.updateConfig).toHaveBeenCalledWith({ rowsPerPage: 8, currentPage: 1, rotationAnchor: 1_000_000 });

		const manual = harness({ autoPageEnabled: false, currentPage: 3 });
		manual.writes.updateConfig({ autoPageIntervalMs: 5_000 });
		expect(manual.updateConfig).toHaveBeenCalledWith({ autoPageIntervalMs: 5_000, currentPage: 1 });
	});

	it('writes an edit that leaves the rotation\'s shape alone as it is', () => {
		const { writes, updateConfig } = harness({ currentPage: 3 });

		writes.updateConfig({ headerText: 'Top 8' });

		expect(updateConfig).toHaveBeenCalledWith({ headerText: 'Top 8' });
	});

	it('occasion 3 — manual selection while rotating re-anchors so the page holds a full duration', () => {
		const { writes, updateConfig } = harness({ rotationAnchor: 1_000_000 });

		writes.adminSetPage(3);

		expect(updateConfig).toHaveBeenCalledWith({ rotationAnchor: 1_000_000 - 20_000 });
	});

	it('manual selection with auto-page off persists the page number as before', () => {
		const { writes, updateConfig } = harness({ autoPageEnabled: false, currentPage: 2 });

		writes.adminNextPage();

		expect(updateConfig).toHaveBeenCalledWith({ currentPage: 3 });
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
});
