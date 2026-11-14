import type { EffectScope } from 'vue';
import type { PageRotationMode } from '~~/shared/screenModes';
import type { ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageRotationEdit, rotationAnchorForPage } from '~~/shared/modules/page-rotation';
import { DEFAULT_PAGE_ROTATION } from '~~/shared/screenModeConfigs/subShapes';
import { SCREEN_MODES, screenModePageRotation } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { screenContextOf } from '~~/test/nuxt/helpers/screenContext';
import { usePaginatedScreenMode, useScreenModePagination } from '~/modules/screen-mode/pagination';
import { useRotationConfigWrites } from '~/modules/screen-mode/rotationWrites';

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

const screenContext = screenContextOf();

const { screenStore } = vi.hoisted(() => ({
	screenStore: {
		updateModeConfig: vi.fn(),
	},
}));
mockNuxtImport('useScreenStore', () => () => screenStore);

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
	return {
		pagination,
		persistPage,
		persistRotationAnchor,
		state,
	};
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

	it.each([
		[
			'wraps past the last page to the first',
			3,
			(p: ReturnType<typeof harness>['pagination']) => p.nextPage(),
			1,
		],
		[
			'wraps back from the first page to the last',
			1,
			(p: ReturnType<typeof harness>['pagination']) => p.prevPage(),
			3,
		],
		[
			'clamps a selection below the first page',
			2,
			(p: ReturnType<typeof harness>['pagination']) => p.setPage(0),
			1,
		],
		[
			'clamps a selection past the last page',
			2,
			(p: ReturnType<typeof harness>['pagination']) => p.setPage(100),
			3,
		],
	])('manual selection %s', (_, currentPage, select, expected) => {
		const { pagination, persistPage } = harness({ autoPageEnabled: false, currentPage });

		select(pagination);

		expect(persistPage).toHaveBeenCalledWith(expected);
	});

	it('shows one page with no rows', () => {
		expect(harness({ autoPageEnabled: false, rowCount: 0 }).pagination.totalPages.value).toBe(1);
	});

	it('with auto-page off the persisted page drives the slice, clamped to the data', () => {
		const { pagination } = harness({ autoPageEnabled: false, currentPage: 9, rowCount: 6 });
		expect(pagination.currentPage.value).toBe(3);
		expect(pagination.pageData.value).toEqual([4, 5]);
	});
});

/** A rendering reads its page size through the field its mode declares (ADR-0039). */
describe('usePaginatedScreenMode', () => {
	const paginated = SCREEN_MODE_VALUES.flatMap((mode) => {
		const pageRotation = SCREEN_MODES[mode].pageRotation;
		return pageRotation
			? [
					{ mode: mode as PageRotationMode, field: pageRotation.pageSize },
				]
			: [];
	});

	it.each(paginated)('exposes $mode\'s page size from $field', ({ mode, field }) => {
		const config = computed(() => ({ ...DEFAULT_PAGE_ROTATION, autoPageEnabled: false, [field]: 3 }) as never);

		const { pageSize, pageData } = usePaginatedScreenMode(screenContext, {
			mode,
			config,
			rows: rows(7),
		});

		expect(pageSize.value).toBe(3);
		expect(pageData.value).toEqual([0, 1, 2]);
	});

	// A page size is Auto while absent: one page of every row, in the editor as on the Screen Output.
	it.each([
		{
			cardsPerPage: undefined,
			rowCount: 12,
			pages: 1,
			firstPage: 12,
		},
		{
			cardsPerPage: undefined,
			rowCount: 0,
			pages: 1,
			firstPage: 0,
		},
		{
			cardsPerPage: 4,
			rowCount: 12,
			pages: 3,
			firstPage: 4,
		},
		{
			cardsPerPage: 5,
			rowCount: 12,
			pages: 3,
			firstPage: 5,
		},
		{
			cardsPerPage: 60,
			rowCount: 12,
			pages: 1,
			firstPage: 12,
		},
	])('a Screen Output and its editor page $rowCount cards at $cardsPerPage a page into $pages', ({ cardsPerPage, rowCount, pages, firstPage }) => {
		const config = computed(() => ({ ...DEFAULT_PAGE_ROTATION, autoPageEnabled: false, cardsPerPage }) as never);

		const output = usePaginatedScreenMode(screenContext, {
			mode: 'top-cards',
			config,
			rows: rows(rowCount),
		});
		const editor = useRotationConfigWrites({
			mode: 'top-cards',
			config,
			rowCount: output.rowCount,
			saveConfig: vi.fn(),
		});

		expect(output.totalPages.value).toBe(pages);
		expect(editor.totalPages.value).toBe(pages);
		expect(output.pageData.value).toHaveLength(firstPage);
		expect(editor.pageSize.value).toBe(cardsPerPage);
	});

	/**
	 * A mode's rendering rotates by its config alone: the Rotation Anchor and
	 * page duration it holds, over the page size its mode declares (ADR-0039).
	 */
	describe('a Standings rendering\'s Page Rotation', () => {
		const EVENT_ID = 4;
		const SCREEN_ID = 9;
		const PAGE_MS = 10_000;
		type Config = ModeConfigTypeMap['standings'];
		const scopes: EffectScope[] = [];

		/** Six rows at two a page, rotating every ten seconds, 25 seconds in: page 3 of 3. */
		function rendering({ config: held = {}, interactive = false, screen = true }: { config?: Partial<Config>; interactive?: boolean; screen?: boolean } = {}) {
			const config = ref<Config>({
				...getDefaultConfigForMode('standings'),
				rowsPerPage: 2,
				autoPageEnabled: true,
				autoPageIntervalMs: PAGE_MS,
				rotationAnchor: mockServerNow - 25_000,
				...held,
			});
			const rowCount = ref(6);
			const scope = effectScope();
			scopes.push(scope);
			const paging = scope.run(() => usePaginatedScreenMode(
				screenContextOf({
					screen: ref(screen
						? { id: SCREEN_ID }
						: null),
					eventId: computed(() => EVENT_ID),
					interactive: ref(interactive),
				}),
				{
					mode: 'standings',
					config: computed(() => config.value),
					rows: computed(() => Array.from({ length: rowCount.value }, (_, index) => index)),
				},
			))!;
			/** Writes an edit as a settings editor does, through the one rule for shape changes. */
			function edit(patch: Partial<Config>) {
				config.value = {
					...config.value,
					...pageRotationEdit(screenModePageRotation('standings'), config.value, patch, mockServerNow),
				};
			}
			return { paging, config, rowCount, edit };
		}
		type Rendering = ReturnType<typeof rendering>;

		const shown = ({ paging }: Rendering) => ({
			page: paging.currentPage.value,
			of: paging.totalPages.value,
			rows: paging.pageData.value,
		});

		beforeEach(() => {
			vi.useFakeTimers();
			mockIsSynced.value = true;
			mockServerNow = 1_000_000;
			screenStore.updateModeConfig.mockReset();
		});
		afterEach(() => {
			scopes.splice(0).forEach(scope => scope.stop());
			vi.useRealTimers();
		});

		it('turns its page at a boundary, and writes nothing as it runs, even where it could', async () => {
			const held = rendering({ interactive: true });
			expect(shown(held)).toEqual({
				page: 3,
				of: 3,
				rows: [4, 5],
			});

			await advance(5_000);
			expect(shown(held)).toEqual({
				page: 1,
				of: 3,
				rows: [0, 1],
			});

			expect(screenStore.updateModeConfig).not.toHaveBeenCalled();
		});

		// Each change arrives as its Screen's config does; the rendering follows it with no state of its own.
		it.each<{ change: string; arrive: (held: Rendering) => void; shows: { page: number; of: number }; afterMs: number; then: number }>([
			{
				change: 'a page size edit restarts it over the new page count',
				arrive: ({ edit }) => edit({ rowsPerPage: 3 }),
				shows: { page: 1, of: 2 },
				afterMs: PAGE_MS,
				then: 2,
			},
			{
				change: 'a page duration edit restarts it at the new duration',
				arrive: ({ edit }) => edit({ autoPageIntervalMs: 4_000 }),
				shows: { page: 1, of: 3 },
				afterMs: 4_000,
				then: 2,
			},
			{
				change: 'a page selected elsewhere is shown, and the rotation runs on from it',
				arrive: ({ config }) => {
					config.value = {
						...config.value,
						rotationAnchor: rotationAnchorForPage({ page: 2, pageDurationMs: PAGE_MS, now: mockServerNow }),
					};
				},
				shows: { page: 2, of: 3 },
				afterMs: PAGE_MS,
				then: 3,
			},
			{
				change: 'auto-page turned off holds the selected page',
				arrive: ({ edit }) => edit({ autoPageEnabled: false, currentPage: 2 }),
				shows: { page: 2, of: 3 },
				afterMs: PAGE_MS,
				then: 2,
			},
			{
				change: 'rows shrinking to one page leave nothing to rotate',
				arrive: ({ rowCount }) => {
					rowCount.value = 2;
				},
				shows: { page: 1, of: 1 },
				afterMs: PAGE_MS,
				then: 1,
			},
		])('$change', async ({ arrive, shows, afterMs, then }) => {
			const held = rendering();
			expect(shown(held)).toMatchObject({ page: 3, of: 3 });

			arrive(held);
			await nextTick();
			expect(shown(held)).toMatchObject(shows);

			await advance(afterMs);
			expect(held.paging.currentPage.value).toBe(then);
		});

		// Only an interactive surface writes a page selection; a Screen Output cannot move the Rotation Anchor (ADR-0009).
		it.each<{ surface: string; interactive: boolean; screen?: boolean; autoPageEnabled: boolean; writes: string; written: Partial<Config>[] }>([
			{
				surface: 'an interactive surface with auto-page off',
				interactive: true,
				autoPageEnabled: false,
				writes: 'the page',
				written: [
					{ currentPage: 2 },
				],
			},
			{
				surface: 'an interactive surface while rotating',
				interactive: true,
				autoPageEnabled: true,
				writes: 'a Rotation Anchor holding it a whole page duration',
				written: [
					{ rotationAnchor: 1_000_000 - PAGE_MS },
				],
			},
			{
				surface: 'a Screen Output with auto-page off',
				interactive: false,
				autoPageEnabled: false,
				writes: 'nothing',
				written: [],
			},
			{
				surface: 'a Screen Output while rotating',
				interactive: false,
				autoPageEnabled: true,
				writes: 'nothing',
				written: [],
			},
			{
				surface: 'an interactive surface with no Screen loaded',
				interactive: true,
				screen: false,
				autoPageEnabled: false,
				writes: 'nothing',
				written: [],
			},
		])('selecting page 2 on $surface writes $writes', ({ interactive, screen, autoPageEnabled, written }) => {
			const { paging } = rendering({
				interactive,
				screen,
				config: { autoPageEnabled, currentPage: 1 },
			});

			paging.setPage(2);

			expect(screenStore.updateModeConfig.mock.calls).toEqual(written.map(patch => [
				EVENT_ID,
				SCREEN_ID,
				'standings',
				patch,
			]));
		});
	});
});
