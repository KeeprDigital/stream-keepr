import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenModePagination } from '~/modules/screen-mode/pagination';

/**
 * The Page Rotation contract: with auto-page on, the current page is a
 * projection of (Rotation Anchor, page duration, page count, server time).
 * No rendering writes as the rotation runs; only explicit manual selection
 * persists anything.
 */

const mockIsSynced = ref(true);
let mockServerNow = 1_000_000;

mockNuxtImport('useServerTime', () => () => ({
	isSynced: mockIsSynced,
	serverTimeOffset: ref(0),
	getServerTime: () => mockServerNow,
}));

function rows(count: number) {
	return computed(() => Array.from({ length: count }, (_, i) => i));
}

interface HarnessOverrides {
	autoPageEnabled?: boolean;
	rotationAnchor?: number;
	currentPage?: number;
	rowCount?: number;
}

function harness(overrides: HarnessOverrides = {}) {
	const persistPage = vi.fn();
	const persistRotationAnchor = vi.fn();
	const state = reactive({
		autoPageEnabled: overrides.autoPageEnabled ?? true,
		rotationAnchor: overrides.rotationAnchor,
		currentPage: overrides.currentPage ?? 1,
	});
	const pagination = useScreenModePagination({
		rows: rows(overrides.rowCount ?? 6),
		pageSize: computed(() => 2),
		currentPage: computed(() => state.currentPage),
		autoPageEnabled: computed(() => state.autoPageEnabled),
		autoPageIntervalMs: computed(() => 10_000),
		rotationAnchor: computed(() => state.rotationAnchor),
		persistPage,
		persistRotationAnchor,
	});
	return { pagination, persistPage, persistRotationAnchor, state };
}

async function advance(ms: number) {
	mockServerNow += ms;
	vi.advanceTimersByTime(ms);
	await nextTick();
}

describe('useScreenModePagination (page rotation)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockIsSynced.value = true;
		mockServerNow = 1_000_000;
	});
	afterEach(() => vi.useRealTimers());

	it('projects the page from the anchor and server time, flipping at boundaries with zero writes', async () => {
		// Anchor 15s ago with 10s pages → 5s into page 2 of 3.
		const { pagination, persistPage, persistRotationAnchor } = harness({ rotationAnchor: mockServerNow - 15_000 });

		expect(pagination.currentPage.value).toBe(2);
		expect(pagination.pageData.value).toEqual([2, 3]);

		await advance(5_000); // boundary: 20s elapsed → page 3
		expect(pagination.currentPage.value).toBe(3);

		await advance(10_000); // wraps → page 1
		expect(pagination.currentPage.value).toBe(1);

		expect(persistPage).not.toHaveBeenCalled();
		expect(persistRotationAnchor).not.toHaveBeenCalled();
	});

	it('two renderings of the same config always agree on the page', async () => {
		const anchor = mockServerNow - 3_000;
		const a = harness({ rotationAnchor: anchor });
		const b = harness({ rotationAnchor: anchor });

		for (let i = 0; i < 4; i++) {
			expect(a.pagination.currentPage.value).toBe(b.pagination.currentPage.value);
			await advance(10_000);
		}
	});

	it('rotates deterministically from epoch zero when no anchor is stored', () => {
		// mockServerNow = 1,000,000 → 100 pages elapsed → 100 % 3 = 1 → page 2.
		const { pagination } = harness({ rotationAnchor: undefined });
		expect(pagination.currentPage.value).toBe(2);
	});

	it('shows the first page statically while server time is unsynced', async () => {
		mockIsSynced.value = false;
		const { pagination } = harness({ rotationAnchor: mockServerNow - 15_000 });

		expect(pagination.currentPage.value).toBe(1);
		await advance(25_000);
		expect(pagination.currentPage.value).toBe(1);

		// Sync completing joins the rotation in phase.
		mockIsSynced.value = true;
		await nextTick();
		expect(pagination.currentPage.value).toBe(2); // 40s elapsed → 4 % 3 = 1 → page 2
	});

	it('manual selection while rotating persists a re-anchor so the page holds a full duration', () => {
		const { pagination, persistPage, persistRotationAnchor } = harness({ rotationAnchor: mockServerNow });

		pagination.setPage(3);

		// anchorForPage(3): now - 2 × 10s.
		expect(persistRotationAnchor).toHaveBeenCalledWith(mockServerNow - 20_000);
		expect(persistPage).not.toHaveBeenCalled();
	});

	it('manual selection with auto-page off persists the page exactly as before', () => {
		const { pagination, persistPage, persistRotationAnchor } = harness({ autoPageEnabled: false, currentPage: 1 });

		pagination.nextPage();

		expect(persistPage).toHaveBeenCalledWith(2);
		expect(persistRotationAnchor).not.toHaveBeenCalled();
	});

	it('with auto-page off the persisted page drives the slice, clamped to the data', () => {
		const { pagination } = harness({ autoPageEnabled: false, currentPage: 9, rowCount: 6 });
		expect(pagination.currentPage.value).toBe(3);
		expect(pagination.pageData.value).toEqual([4, 5]);
	});
});
