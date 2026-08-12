import type { ComputedRef } from 'vue';
import { computed } from 'vue';
import { rotationAnchorForPage } from '~~/shared/modules/page-rotation';
import { useProjectedRotationPage } from './pagination';

/** The pagination fields every paginated mode's config carries. */
export interface RotationConfigFields {
	autoPageEnabled: boolean;
	autoPageIntervalMs: number;
	currentPage?: number;
	rotationAnchor?: number;
}

export interface RotationConfigWritesOptions<TConfig extends RotationConfigFields> {
	config: ComputedRef<TConfig>;
	totalPages: ComputedRef<number>;
	updateConfig: (patch: Partial<TConfig>) => void;
}

/**
 * The operator-surface half of a Page Rotation: the live page projection for
 * the settings indicator, and the only writes a rotation ever gets — the
 * Rotation Anchor, minted on exactly three occasions (enabling auto-page,
 * an edit changing the rotation's shape, and a manual page selection while
 * rotating). Anchors are minted through `rotationAnchorForPage`, so they are
 * integer timestamps even though the clock estimate is a float.
 */
export function useRotationConfigWrites<TConfig extends RotationConfigFields>(
	options: RotationConfigWritesOptions<TConfig>,
) {
	const { getServerTime } = useServerTime();

	const rotationPage = useProjectedRotationPage({
		autoPageEnabled: computed(() => options.config.value.autoPageEnabled),
		autoPageIntervalMs: computed(() => options.config.value.autoPageIntervalMs),
		rotationAnchor: computed(() => options.config.value.rotationAnchor),
		totalPages: options.totalPages,
	});

	const currentPage = computed(() =>
		Math.min(rotationPage.value ?? options.config.value.currentPage ?? 1, options.totalPages.value),
	);

	// "Restart the rotation now" is re-anchoring to page 1.
	function anchorNow(): number {
		return rotationAnchorForPage({
			page: 1,
			pageDurationMs: options.config.value.autoPageIntervalMs,
			now: getServerTime(),
		});
	}

	function setAutoPageEnabled(enabled: boolean) {
		options.updateConfig((enabled
			? { autoPageEnabled: true, rotationAnchor: anchorNow() }
			: { autoPageEnabled: false }) as Partial<TConfig>);
	}

	/** An edit that changes the rotation's shape restarts it predictably. */
	function updateRotationShape(patch: Partial<TConfig>) {
		options.updateConfig(options.config.value.autoPageEnabled
			? { ...patch, rotationAnchor: anchorNow() }
			: patch);
	}

	// A manual selection while the rotation runs re-anchors it — the chosen
	// page becomes current everywhere and holds a full duration. With
	// auto-page off it persists the page exactly as before.
	function adminSetPage(page: number) {
		if (options.config.value.autoPageEnabled) {
			options.updateConfig({ rotationAnchor: rotationAnchorForPage({
				page,
				pageDurationMs: options.config.value.autoPageIntervalMs,
				now: getServerTime(),
			}) } as Partial<TConfig>);
		}
		else {
			options.updateConfig({ currentPage: page } as Partial<TConfig>);
		}
	}

	function adminNextPage() {
		adminSetPage(currentPage.value < options.totalPages.value ? currentPage.value + 1 : 1);
	}

	function adminPrevPage() {
		adminSetPage(currentPage.value > 1 ? currentPage.value - 1 : options.totalPages.value);
	}

	return {
		currentPage,
		setAutoPageEnabled,
		updateRotationShape,
		adminSetPage,
		adminNextPage,
		adminPrevPage,
	};
}
