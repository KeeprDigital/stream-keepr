import type {
	FeatureMatchLayoutFrameConfig,
	FeatureMatchLayoutItemConfig,
	FeatureMatchOverlayBoxStyle,
	FeatureMatchOverlayModeConfig,
	FeatureMatchWidgetConfig,
	FeatureMatchWidgetGroupChildConfig,
	FeatureMatchWidgetGroupItemConfig,
} from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayGeometryField, FeatureMatchOverlayLayerKind } from '~/modules/feature-match-overlay/layout';
import type { FeatureMatchOverlayGeometryUnit } from '~/utils/featureMatchOverlayGeometry';
import * as layoutWriter from '~/modules/feature-match-overlay/layout';
import { parseGeometryInput } from '~/utils/featureMatchOverlayGeometry';

export type { FeatureMatchOverlayGeometryField, FeatureMatchOverlayLayerKind };
export type FeatureMatchOverlayConfigUpdater = (partial: Partial<FeatureMatchOverlayModeConfig>) => void;

interface FeatureMatchOverlayConfigEditorOptions {
	config: Ref<FeatureMatchOverlayModeConfig>;
	updateConfig: FeatureMatchOverlayConfigUpdater;
	screenWidth: Ref<number>;
	screenHeight: Ref<number>;
}

/**
 * Vue binding for the Feature Match Layout writer: each verb applies the
 * pure, id-addressed layout mutation and submits the whole updated layout
 * through `updateConfig` — the single write path for layout state. A
 * mutation that could not apply (unknown id, wrong item kind) submits
 * nothing.
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

	function updateItem(id: string, updates: Partial<FeatureMatchLayoutItemConfig>) {
		submit(layoutWriter.patchItem(layout(), id, updates));
	}

	function updateItemSurfaceStyle(id: string, updates: Partial<FeatureMatchOverlayBoxStyle>) {
		submit(layoutWriter.patchItemSurfaceStyle(layout(), id, updates));
	}

	function addItem(item: FeatureMatchLayoutItemConfig) {
		submit(layoutWriter.addItem(layout(), item));
	}

	function removeItem(id: string) {
		submit(layoutWriter.removeItem(layout(), id));
	}

	function updateGroup(id: string, updates: Partial<FeatureMatchWidgetGroupItemConfig>) {
		submit(layoutWriter.patchGroup(layout(), id, updates));
	}

	function updateGroupDefaultChildSurfaceStyle(id: string, updates: Partial<FeatureMatchOverlayBoxStyle>) {
		submit(layoutWriter.patchGroupDefaultChildSurfaceStyle(layout(), id, updates));
	}

	function updateGroupChild(groupId: string, childId: string, updates: Partial<FeatureMatchWidgetGroupChildConfig>) {
		submit(layoutWriter.patchGroupChild(layout(), groupId, childId, updates));
	}

	function updateGroupChildWidget(groupId: string, childId: string, updates: Partial<FeatureMatchWidgetConfig>) {
		submit(layoutWriter.patchGroupChildWidget(layout(), groupId, childId, updates));
	}

	function updateGroupChildSurfaceStyle(groupId: string, childId: string, updates: Partial<FeatureMatchOverlayBoxStyle>) {
		submit(layoutWriter.patchGroupChildSurfaceStyle(layout(), groupId, childId, updates));
	}

	function addGroupChild(groupId: string, child: FeatureMatchWidgetGroupChildConfig) {
		submit(layoutWriter.addGroupChild(layout(), groupId, child));
	}

	function removeGroupChild(groupId: string, childId: string) {
		submit(layoutWriter.removeGroupChild(layout(), groupId, childId));
	}

	/** Anchored geometry edit: parse the input, then resize/move around the item's anchor. */
	function updateItemRectFromAnchor(id: string, field: FeatureMatchOverlayGeometryField, value: string | number, unit: FeatureMatchOverlayGeometryUnit) {
		submit(layoutWriter.patchItemRectFromAnchor(layout(), id, field, geometryValue(value, field, unit)));
	}

	/** Anchored geometry edit for a canvas-positioned Widget Group child. */
	function updateGroupChildRectFromAnchor(groupId: string, childId: string, field: FeatureMatchOverlayGeometryField, value: string | number, unit: FeatureMatchOverlayGeometryUnit) {
		submit(layoutWriter.patchGroupChildRectFromAnchor(layout(), groupId, childId, field, geometryValue(value, field, unit)));
	}

	function convertGroupArrangement(id: string, mode: 'row' | 'column' | 'canvas') {
		submit(layoutWriter.convertGroupArrangement(layout(), id, mode));
	}

	function moveItemOrder(id: string, direction: -1 | 1) {
		submit(layoutWriter.moveItemOrder(layout(), id, direction));
	}

	function sendItemToBack(id: string) {
		submit(layoutWriter.sendItemToBack(layout(), id));
	}

	function bringItemToFront(id: string) {
		submit(layoutWriter.bringItemToFront(layout(), id));
	}

	function moveGroupChildOrder(groupId: string, childId: string, direction: -1 | 1) {
		submit(layoutWriter.moveGroupChildOrder(layout(), groupId, childId, direction));
	}

	function sendGroupChildToBack(groupId: string, childId: string) {
		submit(layoutWriter.sendGroupChildToBack(layout(), groupId, childId));
	}

	function bringGroupChildToFront(groupId: string, childId: string) {
		submit(layoutWriter.bringGroupChildToFront(layout(), groupId, childId));
	}

	/** Create a new Layout Item of the given kind. Returns the new item's id. */
	function createLayoutItem(kind: FeatureMatchOverlayLayerKind): string {
		const { layout: next, id } = layoutWriter.createLayoutItem(layout(), kind);
		submit(next);
		return id;
	}

	/** Create a new child in a Widget Group, matching its arrangement mode. Returns the child id, or null when the item is not a group. */
	function createGroupChild(groupId: string, type: FeatureMatchWidgetConfig['type']): string | null {
		const { layout: next, id } = layoutWriter.createGroupChild(layout(), groupId, type);
		submit(next);
		return id;
	}

	return {
		updateLayout,
		geometryValue,
		patchFrame,
		updateItem,
		updateItemSurfaceStyle,
		addItem,
		removeItem,
		updateGroup,
		updateGroupDefaultChildSurfaceStyle,
		updateGroupChild,
		updateGroupChildWidget,
		updateGroupChildSurfaceStyle,
		addGroupChild,
		removeGroupChild,
		updateItemRectFromAnchor,
		updateGroupChildRectFromAnchor,
		convertGroupArrangement,
		moveItemOrder,
		sendItemToBack,
		bringItemToFront,
		moveGroupChildOrder,
		sendGroupChildToBack,
		bringGroupChildToFront,
		createLayoutItem,
		createGroupChild,
	};
}
