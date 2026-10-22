import type {
	FeatureMatchLayoutFrameConfig,
	FeatureMatchOverlayModeConfig,
	FeatureMatchSourceFramingStyle,
	FeatureMatchSourceItemConfig,
} from '~~/shared/types/screenConfig';
import * as layoutWriter from '~/modules/feature-match-overlay/layout';

export type FeatureMatchOverlayConfigUpdater = (partial: Partial<FeatureMatchOverlayModeConfig>) => void;

interface FeatureMatchOverlayConfigEditorOptions {
	config: Ref<FeatureMatchOverlayModeConfig>;
	updateConfig: FeatureMatchOverlayConfigUpdater;
}

/**
 * Vue binding for the host-owned Feature Match Layout writer: each verb applies
 * the pure, id-addressed mutation and submits the whole updated layout through
 * `updateConfig` — the single write path for the Frame and the Source Items. A
 * mutation that could not apply (unknown id) submits nothing. Geometry arrives
 * already in canonical pixels: the geometry fields control owns display and
 * parsing.
 *
 * The shared item tree is written through the compositor's own authoring module,
 * not through here.
 */
export function useFeatureMatchOverlayConfigEditor(options: FeatureMatchOverlayConfigEditorOptions) {
	const { config, updateConfig } = options;

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

	/** Duplicate a Source Item. Returns the copy's id, or an empty one when nothing was copied. */
	function duplicateSource(id: string): string {
		const { layout: next, id: copyId } = layoutWriter.duplicateSource(layout(), id);
		submit(next);
		return copyId;
	}

	return {
		duplicateSource,
		updateLayout,
		patchFrame,
		updateSource,
		updateSourceFramingStyle,
		removeSource,
		moveSourceOrder,
		sendSourceToBack,
		bringSourceToFront,
		createSourceItem,
	};
}
