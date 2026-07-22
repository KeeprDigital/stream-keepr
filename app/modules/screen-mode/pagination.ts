import type { ComputedRef, Ref } from 'vue';
import { computed, onUnmounted, watch } from 'vue';

export interface ScreenModePaginationOptions<TRow> {
	rows: ComputedRef<TRow[]>;
	pageSize: ComputedRef<number>;
	currentPage: ComputedRef<number>;
	autoPageEnabled: ComputedRef<boolean>;
	autoPageIntervalMs: ComputedRef<number>;
	interactive: Ref<boolean>;
	persistPage: (page: number) => void;
}

/**
 * Shared Screen Mode runtime for paginated modes.
 *
 * Owns page clamping, previous/next wrapping, non-interactive auto-page timers,
 * and cleanup. Mode composables provide rows and page persistence only.
 */
export function useScreenModePagination<TRow>(options: ScreenModePaginationOptions<TRow>) {
	const totalPages = computed(() => Math.max(1, Math.ceil(options.rows.value.length / options.pageSize.value)));
	const pageData = computed(() => {
		const page = Math.min(options.currentPage.value, totalPages.value);
		const start = (page - 1) * options.pageSize.value;
		return options.rows.value.slice(start, start + options.pageSize.value);
	});

	function setPage(page: number) {
		options.persistPage(Math.max(1, Math.min(page, totalPages.value)));
	}

	function nextPage() {
		setPage(options.currentPage.value < totalPages.value ? options.currentPage.value + 1 : 1);
	}

	function prevPage() {
		setPage(options.currentPage.value > 1 ? options.currentPage.value - 1 : totalPages.value);
	}

	let autoPageTimer: ReturnType<typeof setInterval> | null = null;

	function stopAutoPage() {
		if (autoPageTimer) {
			clearInterval(autoPageTimer);
			autoPageTimer = null;
		}
	}

	function startAutoPage() {
		stopAutoPage();
		if (!options.interactive.value && options.autoPageEnabled.value && totalPages.value > 1) {
			autoPageTimer = setInterval(nextPage, options.autoPageIntervalMs.value);
		}
	}

	watch(
		() => [options.autoPageEnabled.value, options.autoPageIntervalMs.value, totalPages.value, options.interactive.value],
		() => {
			if (options.autoPageEnabled.value && !options.interactive.value)
				startAutoPage();
			else stopAutoPage();
		},
	);

	onUnmounted(() => stopAutoPage());

	return {
		pageData,
		totalPages,
		setPage,
		nextPage,
		prevPage,
		startAutoPage,
		stopAutoPage,
	};
}
