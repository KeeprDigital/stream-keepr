import type { ComputedRef } from 'vue';
import { computed, ref, watchEffect } from 'vue';
import { msUntilNextRotationFlip, projectRotationPage, rotationAnchorForPage } from '~~/shared/modules/page-rotation';

export interface ScreenModePaginationOptions<TRow> {
	rows: ComputedRef<TRow[]>;
	pageSize: ComputedRef<number>;
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
	const { isSynced, serverTimeOffset, getServerTime } = useServerTime();

	// Bumped at each projected flip boundary so the projection re-evaluates
	// exactly when the page changes, instead of polling.
	const rotationTick = ref(0);

	if (import.meta.client) {
		watchEffect((onCleanup) => {
			if (!options.autoPageEnabled.value || !isSynced.value)
				return;
			void rotationTick.value;
			void serverTimeOffset.value;
			const ms = msUntilNextRotationFlip({
				rotationAnchor: options.rotationAnchor.value,
				pageDurationMs: options.autoPageIntervalMs.value,
				totalPages: options.totalPages.value,
				now: getServerTime(),
			});
			if (ms === null)
				return;
			const timer = setTimeout(() => {
				rotationTick.value++;
			}, ms);
			onCleanup(() => clearTimeout(timer));
		});
	}

	return computed<number | null>(() => {
		if (!options.autoPageEnabled.value)
			return null;
		if (!isSynced.value)
			return 1;
		// Re-project on each boundary tick and whenever the sync estimate moves.
		void rotationTick.value;
		void serverTimeOffset.value;
		return projectRotationPage({
			rotationAnchor: options.rotationAnchor.value,
			pageDurationMs: options.autoPageIntervalMs.value,
			totalPages: options.totalPages.value,
			now: getServerTime(),
		});
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

	const totalPages = computed(() => Math.max(1, Math.ceil(options.rows.value.length / options.pageSize.value)));

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
		const start = (currentPage.value - 1) * options.pageSize.value;
		return options.rows.value.slice(start, start + options.pageSize.value);
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
		setPage(currentPage.value < totalPages.value ? currentPage.value + 1 : 1);
	}

	function prevPage() {
		setPage(currentPage.value > 1 ? currentPage.value - 1 : totalPages.value);
	}

	return {
		pageData,
		totalPages,
		currentPage,
		setPage,
		nextPage,
		prevPage,
	};
}
