import type { ComputedRef, Ref } from 'vue';
import type { PageRotationConfig } from '~~/shared/screenModeConfigs/subShapes';
import type { PageRotationMode } from '~~/shared/screenModes';
import type { ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import { computed } from 'vue';
import { pageRotationEdit, rotationAnchorForPage, rotationPageSize } from '~~/shared/modules/page-rotation';
import { screenModePageRotation } from '~~/shared/screenModes';
import { useProjectedRotationPage } from './pagination';

export interface RotationConfigWritesOptions<M extends PageRotationMode> {
	/** The paginated mode, whose Screen Mode Definition declares its Page Rotation. */
	mode: M;
	config: ComputedRef<ModeConfigTypeMap[M]>;
	/** How many rows the mode would show, from which its page count follows. */
	rowCount: Readonly<Ref<number>>;
	/** Saves a patch of the mode's config, as `useModeConfigUpdate` does. */
	saveConfig: (patch: Partial<ModeConfigTypeMap[M]>) => void;
}

/**
 * The operator-surface half of a Page Rotation: the live page projection for
 * the settings indicator, and the only writes a rotation ever gets — the
 * Rotation Anchor, minted on exactly three occasions (enabling auto-page,
 * an edit changing the rotation's shape, and a manual page selection while
 * rotating). Anchors are minted through `rotationAnchorForPage`, so they are
 * integer timestamps even though the clock estimate is a float.
 *
 * Every edit of the mode's config goes through `updateConfig`, which applies
 * the one rule for shape changes (`pageRotationEdit`) to whatever it writes,
 * so a settings editor cannot leave the rule out.
 */
export function useRotationConfigWrites<M extends PageRotationMode>(
	options: RotationConfigWritesOptions<M>,
) {
	const { getServerTime } = useServerTime();
	const declaration = screenModePageRotation(options.mode);
	const rotation = computed<PageRotationConfig>(() => options.config.value);
	const save = (patch: Partial<PageRotationConfig> | Record<string, unknown>) =>
		options.saveConfig(patch as Partial<ModeConfigTypeMap[M]>);

	const totalPages = computed(() =>
		Math.max(1, Math.ceil(options.rowCount.value / rotationPageSize(declaration, options.config.value))),
	);

	const rotationPage = useProjectedRotationPage({
		autoPageEnabled: computed(() => rotation.value.autoPageEnabled),
		autoPageIntervalMs: computed(() => rotation.value.autoPageIntervalMs),
		rotationAnchor: computed(() => rotation.value.rotationAnchor),
		totalPages,
	});

	const currentPage = computed(() =>
		Math.min(rotationPage.value ?? rotation.value.currentPage ?? 1, totalPages.value),
	);

	/** Writes an edit of the mode's config; an edit changing the rotation's shape restarts it from page 1. */
	function updateConfig(patch: Partial<ModeConfigTypeMap[M]>) {
		save(pageRotationEdit(declaration, rotation.value, patch as Record<string, unknown>, getServerTime()));
	}

	function setAutoPageEnabled(enabled: boolean) {
		save(enabled
			? { autoPageEnabled: true, rotationAnchor: rotationAnchorForPage({ page: 1, pageDurationMs: rotation.value.autoPageIntervalMs, now: getServerTime() }) }
			: { autoPageEnabled: false });
	}

	// A manual selection while the rotation runs re-anchors it — the chosen
	// page becomes current everywhere and holds a full duration. With
	// auto-page off it persists the page exactly as before.
	function adminSetPage(page: number) {
		if (rotation.value.autoPageEnabled) {
			save({ rotationAnchor: rotationAnchorForPage({
				page,
				pageDurationMs: rotation.value.autoPageIntervalMs,
				now: getServerTime(),
			}) });
		}
		else {
			save({ currentPage: page });
		}
	}

	function adminNextPage() {
		adminSetPage(currentPage.value < totalPages.value ? currentPage.value + 1 : 1);
	}

	function adminPrevPage() {
		adminSetPage(currentPage.value > 1 ? currentPage.value - 1 : totalPages.value);
	}

	return {
		currentPage,
		totalPages,
		updateConfig,
		setAutoPageEnabled,
		adminSetPage,
		adminNextPage,
		adminPrevPage,
	};
}
