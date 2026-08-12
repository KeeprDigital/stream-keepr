import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
	const updateConfig = vi.fn();
	const state = reactive({
		autoPageEnabled: overrides.autoPageEnabled ?? true,
		autoPageIntervalMs: 10_000,
		currentPage: overrides.currentPage ?? 1,
		rotationAnchor: overrides.rotationAnchor,
		rowsPerPage: 5,
	});
	const writes = useRotationConfigWrites({
		config: computed(() => state),
		totalPages: computed(() => 4),
		updateConfig,
	});
	return { writes, updateConfig, state };
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

	it('occasion 2 — a rotation-shape edit re-anchors while rotating, and not otherwise', () => {
		const rotating = harness();
		rotating.writes.updateRotationShape({ autoPageIntervalMs: 5_000 });
		expect(rotating.updateConfig).toHaveBeenCalledWith({ autoPageIntervalMs: 5_000, rotationAnchor: 1_000_000 });

		const manual = harness({ autoPageEnabled: false });
		manual.writes.updateRotationShape({ autoPageIntervalMs: 5_000 });
		expect(manual.updateConfig).toHaveBeenCalledWith({ autoPageIntervalMs: 5_000 });
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
});
