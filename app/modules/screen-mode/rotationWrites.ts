import type { ComputedRef, Ref } from 'vue';
import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import type { PageRotationConfig } from '~~/shared/screenModeConfigs/subShapes';
import type { PageRotationMode } from '~~/shared/screenModes';
import type { ModeConfigTypeMap, ScreenModeConfigPatch } from '~~/shared/types/screenConfig';
import { computed } from 'vue';
import { pageRotationEdit, restartedRotationAnchor, rotationAnchorForPage, rotationPageSize } from '~~/shared/modules/page-rotation';
import { screenModeConfigContract, screenModePageRotation } from '~~/shared/screenModes';
import { useProjectedRotationPage } from './pagination';

export interface RotationConfigWritesOptions<M extends PageRotationMode> {
	/** The paginated mode, whose Screen Mode Definition declares its Page Rotation. */
	mode: M;
	config: ComputedRef<ModeConfigTypeMap[M]>;
	/** How many rows the mode would show, from which its page count follows. */
	rowCount: Readonly<Ref<number>>;
	/** Saves a patch of the mode's config, as `useModeConfigUpdate` does. */
	saveConfig: (patch: ScreenModeConfigPatch<M>) => void;
}

/** A paginated mode's contract fields for its rotation: the declared page size field, and the shared ones. */
export interface PageRotationFields {
	readonly pageSize: ScreenModeConfigField;
	readonly autoPageEnabled: ScreenModeConfigField;
	readonly autoPageIntervalMs: ScreenModeConfigField;
}

/**
 * What the shared Pagination settings card reads and writes of a paginated
 * mode's Page Rotation: the same for every mode, whatever it names its page
 * size field. The page count arrives through `totalPages`, counted from the
 * `rowCount` its editor passes `useRotationConfigWrites`.
 */
export interface PageRotationControls {
	/** The contract fields the card edits, labelling and bounding its controls (#498). */
	readonly fields: PageRotationFields;
	/** The rotation's own fields, as the mode's config holds them. */
	readonly rotationConfig: ComputedRef<PageRotationConfig>;
	/** How many rows a page holds, read from the field the mode declares. */
	readonly pageSize: ComputedRef<number>;
	readonly currentPage: ComputedRef<number>;
	readonly totalPages: ComputedRef<number>;
	/** Writes the declared page size field; a shape change, so the rotation restarts from page 1. */
	setPageSize: (size: number) => void;
	/** Writes the page duration; a shape change, so a running rotation restarts from page 1. */
	setPageDurationMs: (ms: number) => void;
	setAutoPageEnabled: (enabled: boolean) => void;
	adminNextPage: () => void;
	adminPrevPage: () => void;
}

/** A paginated mode's settings editor's Page Rotation: the card's controls, and the editor's own write path. */
export interface RotationConfigWrites<M extends PageRotationMode> extends PageRotationControls {
	/** Writes an edit of the mode's config; an edit changing the rotation's shape restarts it from page 1. */
	updateConfig: (patch: ScreenModeConfigPatch<M>) => void;
	adminSetPage: (page: number) => void;
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
): RotationConfigWrites<M> {
	const { getServerTime } = useServerTime();
	const declaration = screenModePageRotation(options.mode);
	const contractFields = screenModeConfigContract(options.mode).fields as Record<string, ScreenModeConfigField>;
	const fields: PageRotationFields = {
		pageSize: contractFields[declaration.pageSize]!,
		autoPageEnabled: contractFields.autoPageEnabled!,
		autoPageIntervalMs: contractFields.autoPageIntervalMs!,
	};
	const rotation = computed<PageRotationConfig>(() => options.config.value);
	// Every paginated mode's config carries the rotation fields (the Screen Mode
	// Definitions fail to compile otherwise), so a patch of them is a patch of it.
	const saveRotation = (patch: Partial<PageRotationConfig>) =>
		options.saveConfig(patch as ScreenModeConfigPatch<M>);

	const pageSize = computed(() => rotationPageSize(declaration, options.config.value));

	const totalPages = computed(() => Math.max(1, Math.ceil(options.rowCount.value / pageSize.value)));

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
	function updateConfig(patch: ScreenModeConfigPatch<M>) {
		options.saveConfig(pageRotationEdit(declaration, rotation.value, patch, getServerTime()));
	}

	// Each a patch of the mode's config, by the field names its declaration and
	// the shared rotation fields give it.
	function setPageSize(size: number) {
		updateConfig({ [declaration.pageSize]: size } as ScreenModeConfigPatch<M>);
	}

	function setPageDurationMs(ms: number) {
		updateConfig({ autoPageIntervalMs: ms } as ScreenModeConfigPatch<M>);
	}

	function setAutoPageEnabled(enabled: boolean) {
		saveRotation(enabled
			? { autoPageEnabled: true, rotationAnchor: restartedRotationAnchor(getServerTime()) }
			: { autoPageEnabled: false });
	}

	// A manual selection while the rotation runs re-anchors it — the chosen
	// page becomes current everywhere and holds a full duration. With
	// auto-page off it persists the page exactly as before.
	function adminSetPage(page: number) {
		if (rotation.value.autoPageEnabled) {
			saveRotation({ rotationAnchor: rotationAnchorForPage({
				page,
				pageDurationMs: rotation.value.autoPageIntervalMs,
				now: getServerTime(),
			}) });
		}
		else {
			saveRotation({ currentPage: page });
		}
	}

	function adminNextPage() {
		adminSetPage(currentPage.value < totalPages.value ? currentPage.value + 1 : 1);
	}

	function adminPrevPage() {
		adminSetPage(currentPage.value > 1 ? currentPage.value - 1 : totalPages.value);
	}

	return {
		fields,
		rotationConfig: rotation,
		pageSize,
		currentPage,
		totalPages,
		updateConfig,
		setPageSize,
		setPageDurationMs,
		setAutoPageEnabled,
		adminSetPage,
		adminNextPage,
		adminPrevPage,
	};
}
