import type { ComputedRef } from 'vue';
import type { PageRotationConfig } from '~~/shared/screenModeConfigs/subShapes';
import type { PageRotationMode } from '~~/shared/screenModes';
import type { ModeConfigTypeMap, ScreenModeConfigPatch } from '~~/shared/types/screenConfig';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { computed } from 'vue';
import { msUntilNextRotationFlip, projectRotationPage, rotationAnchorForPage, rotationPageCount, rotationPageSize } from '~~/shared/modules/page-rotation';
import { screenModePageRotation } from '~~/shared/screenModes';

export interface ScreenModePaginationOptions<TRow> {
	rows: ComputedRef<TRow[]>;
	/** How many rows a page holds; undefined is Auto, one page of every row. */
	pageSize: ComputedRef<number | undefined>;
	/** The manually selected page — authoritative only while auto-page is off. */
	currentPage: ComputedRef<number>;
	autoPageEnabled: ComputedRef<boolean>;
	autoPageIntervalMs: ComputedRef<number>;
	/** The Page Rotation's epoch; missing projects from epoch zero. */
	rotationAnchor: ComputedRef<number | undefined>;
	/** Persist a manual page selection (auto-page off). */
	persistPage: (page: number) => void;
	/**
	 * Persist a Rotation Anchor (manual selection while auto-page is on).
	 * Only operator surfaces provide the write; a rendering without one
	 * simply cannot re-anchor.
	 */
	persistRotationAnchor?: (anchor: number) => void;
}

export interface ProjectedRotationPageOptions {
	autoPageEnabled: ComputedRef<boolean>;
	autoPageIntervalMs: ComputedRef<number>;
	rotationAnchor: ComputedRef<number | undefined>;
	totalPages: ComputedRef<number>;
}

/**
 * The live Page Rotation projection: the page every rendering of this
 * configuration currently shows, re-evaluated exactly at each flip boundary.
 * Null while auto-page is off; the first page while server time is unsynced,
 * rather than projecting on an unknown clock.
 */
export function useProjectedRotationPage(options: ProjectedRotationPageOptions): ComputedRef<number | null> {
	return useClockProjection<number | null>((serverTime) => {
		if (!options.autoPageEnabled.value)
			return { value: null, nextChangeInMs: null };
		const rotation = {
			rotationAnchor: options.rotationAnchor.value,
			pageDurationMs: options.autoPageIntervalMs.value,
			totalPages: options.totalPages.value,
			now: serverTime,
		};
		return {
			value: projectRotationPage(rotation),
			nextChangeInMs: msUntilNextRotationFlip(rotation),
		};
	}, {
		whileServerTimeUnknown: {
			show: () => options.autoPageEnabled.value
				? 1
				: null,
		},
	});
}

/**
 * Shared Screen Mode runtime for paginated modes.
 *
 * With auto-page on, the current page is a Page Rotation: a projection of
 * (Rotation Anchor, page duration, page count, server time) that every
 * rendering computes identically. Nothing is written as the rotation runs.
 */
export function useScreenModePagination<TRow>(options: ScreenModePaginationOptions<TRow>) {
	const { getServerTime } = useServerTime();

	const totalPages = computed(() => rotationPageCount(options.rows.value.length, options.pageSize.value));
	/** An Auto page holds every row. */
	const pageSize = computed(() => options.pageSize.value ?? options.rows.value.length);

	const rotationPage = useProjectedRotationPage({
		autoPageEnabled: options.autoPageEnabled,
		autoPageIntervalMs: options.autoPageIntervalMs,
		rotationAnchor: options.rotationAnchor,
		totalPages,
	});

	const currentPage = computed(() => {
		const page = rotationPage.value ?? options.currentPage.value;
		return Math.max(1, Math.min(page, totalPages.value));
	});

	const pageData = computed(() => {
		const start = (currentPage.value - 1) * pageSize.value;
		return options.rows.value.slice(start, start + pageSize.value);
	});

	function setPage(page: number) {
		const target = Math.max(1, Math.min(page, totalPages.value));
		if (options.autoPageEnabled.value) {
			options.persistRotationAnchor?.(rotationAnchorForPage({
				page: target,
				pageDurationMs: options.autoPageIntervalMs.value,
				now: getServerTime(),
			}));
		}
		else {
			options.persistPage(target);
		}
	}

	function nextPage() {
		setPage(currentPage.value < totalPages.value
			? currentPage.value + 1
			: 1);
	}

	function prevPage() {
		setPage(currentPage.value > 1
			? currentPage.value - 1
			: totalPages.value);
	}

	return {
		/** How many rows the rotation pages over, which its page count follows. */
		rowCount: computed(() => options.rows.value.length),
		/** How many rows a page holds, which a rendering lays its rows out for. */
		pageSize,
		pageData,
		totalPages,
		currentPage,
		setPage,
		nextPage,
		prevPage,
	};
}

export interface PaginatedScreenModeOptions<M extends PageRotationMode, TRow> {
	/** The paginated mode, whose Screen Mode Definition declares its Page Rotation. */
	mode: M;
	config: ComputedRef<ModeConfigTypeMap[M]>;
	rows: ComputedRef<TRow[]>;
}

/**
 * A paginated Screen Mode's paging as its rendering reads it: the mode's Page
 * Rotation over `rows`, a page holding as many rows as the field the mode
 * declares (`pageRotation.pageSize`). Its `pageSize` is that field's value,
 * or every row while the field is Auto, so a rendering never names the field
 * itself.
 *
 * A page selection is written only from an interactive surface, such as the
 * Program monitor; a Screen Output never writes, so it cannot move the
 * Rotation Anchor (ADR-0009).
 */
export function usePaginatedScreenMode<M extends PageRotationMode, TRow>(context: ScreenContext, options: PaginatedScreenModeOptions<M, TRow>) {
	const { screen, eventId, interactive } = context;
	const screenStore = useScreenStore();
	const declaration = screenModePageRotation(options.mode);
	const rotation = computed<PageRotationConfig>(() => options.config.value);

	function persist(patch: Partial<PageRotationConfig>) {
		if (interactive.value && screen.value && eventId.value) {
			void Promise.resolve(
				// Every paginated mode's config carries the rotation fields, so a patch of them is a patch of it.
				screenStore.updateModeConfig(eventId.value, screen.value.id, options.mode, patch as ScreenModeConfigPatch<M>),
			).catch(() => {});
		}
	}

	return useScreenModePagination({
		rows: options.rows,
		pageSize: computed(() => rotationPageSize(declaration, options.config.value)),
		currentPage: computed(() => rotation.value.currentPage ?? 1),
		autoPageEnabled: computed(() => rotation.value.autoPageEnabled),
		autoPageIntervalMs: computed(() => rotation.value.autoPageIntervalMs),
		rotationAnchor: computed(() => rotation.value.rotationAnchor),
		persistPage: page => persist({ currentPage: page }),
		persistRotationAnchor: anchor => persist({ rotationAnchor: anchor }),
	});
}
