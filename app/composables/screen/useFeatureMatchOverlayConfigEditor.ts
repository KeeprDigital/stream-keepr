import type {
	FeatureMatchLayoutFrameConfig,
	FeatureMatchOverlayModeConfig,
	FeatureMatchSourceFramingStyle,
	FeatureMatchSourceItemConfig,
} from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayGeometryField } from '~/modules/feature-match-overlay/layout';
import type { FeatureMatchOverlayGeometryUnit } from '~/utils/featureMatchOverlayGeometry';
import * as layoutWriter from '~/modules/feature-match-overlay/layout';
import { parseGeometryInput } from '~/utils/featureMatchOverlayGeometry';

export type { FeatureMatchOverlayGeometryField };
export type FeatureMatchOverlayConfigUpdater = (partial: Partial<FeatureMatchOverlayModeConfig>) => void;

interface FeatureMatchOverlayConfigEditorOptions {
	config: Ref<FeatureMatchOverlayModeConfig>;
	updateConfig: FeatureMatchOverlayConfigUpdater;
	screenWidth: Ref<number>;
	screenHeight: Ref<number>;
}

/**
 * Vue binding for the host-owned Feature Match Layout writer: each verb applies
 * the pure, id-addressed mutation and submits the whole updated layout through
 * `updateConfig` — the single write path for the Frame and the Source Items. A
 * mutation that could not apply (unknown id) submits nothing.
 *
 * The shared item tree is written through the compositor's own authoring module,
 * not through here.
 */
export function useFeatureMatchOverlayConfigEditor(options: FeatureMatchOverlayConfigEditorOptions) {
	const { config, updateConfig, screenWidth, screenHeight } = options;

	function layout() {
		return config.value.layout;
	}

	function submit(next: ReturnType<typeof layout>) {
		if (next !== layout())
			updateConfig({ layout: next });
	}

	function updateLayout(layoutUpdates: Partial<FeatureMatchOverlayModeConfig['layout']>) {
		updateConfig({ layout: { ...layout(), ...layoutUpdates } });
	}

	function geometryTotal(field: FeatureMatchOverlayGeometryField) {
		return field === 'x' || field === 'width' ? screenWidth.value : screenHeight.value;
	}

	function geometryValue(value: string | number, field: FeatureMatchOverlayGeometryField, unit: FeatureMatchOverlayGeometryUnit) {
		return parseGeometryInput(value, geometryTotal(field), unit, field === 'x' || field === 'y');
	}

	function patchFrame(updates: Partial<FeatureMatchLayoutFrameConfig>) {
		submit(layoutWriter.patchFrame(layout(), updates));
	}

	function updateSource(id: string, updates: Partial<FeatureMatchSourceItemConfig>) {
		submit(layoutWriter.patchSource(layout(), id, updates));
	}

	function updateSourceFramingStyle(id: string, updates: Partial<FeatureMatchSourceFramingStyle>) {
		submit(layoutWriter.patchSourceFramingStyle(layout(), id, updates));
	}

	function removeSource(id: string) {
		submit(layoutWriter.removeSource(layout(), id));
	}

	/** Anchored geometry edit: parse the input, then resize/move around the Source Item's anchor. */
	function updateSourceRectFromAnchor(id: string, field: FeatureMatchOverlayGeometryField, value: string | number, unit: FeatureMatchOverlayGeometryUnit) {
		submit(layoutWriter.patchSourceRectFromAnchor(layout(), id, field, geometryValue(value, field, unit)));
	}

	function moveSourceOrder(id: string, direction: -1 | 1) {
		submit(layoutWriter.moveSourceOrder(layout(), id, direction));
	}

	function sendSourceToBack(id: string) {
		submit(layoutWriter.sendSourceToBack(layout(), id));
	}

	function bringSourceToFront(id: string) {
		submit(layoutWriter.bringSourceToFront(layout(), id));
	}

	/** Create a new Source Item. Returns the new item's id. */
	function createSourceItem(): string {
		const { layout: next, id } = layoutWriter.createSourceItem(layout());
		submit(next);
		return id;
	}

	return {
		updateLayout,
		geometryValue,
		patchFrame,
		updateSource,
		updateSourceFramingStyle,
		removeSource,
		updateSourceRectFromAnchor,
		moveSourceOrder,
		sendSourceToBack,
		bringSourceToFront,
		createSourceItem,
	};
}
