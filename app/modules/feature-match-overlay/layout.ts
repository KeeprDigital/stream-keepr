import type {
	FeatureMatchLayoutConfig,
	FeatureMatchLayoutFrameConfig,
	FeatureMatchLayoutItemConfig,
	FeatureMatchOverlayBoxStyle,
	FeatureMatchWidgetConfig,
	FeatureMatchWidgetGroupChildConfig,
	FeatureMatchWidgetGroupItemConfig,
} from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayAnchorValue } from '~/utils/featureMatchOverlayGeometry';
import { featureMatchOverlayWidgetDefinition } from '~/modules/feature-match-overlay/widgetDefinitions';
import { updateFeatureMatchOverlayRectFromAnchor } from '~/utils/featureMatchOverlayGeometry';

/**
 * The Feature Match Layout writer: every mutation of a Feature Match Layout
 * goes through these pure, id-addressed functions. A mutation that cannot
 * apply (unknown id, wrong item kind, wrong layout mode) returns the SAME
 * layout reference — callers submit only when the reference changed.
 */

export type FeatureMatchOverlayGeometryField = 'x' | 'y' | 'width' | 'height';
export type FeatureMatchOverlayLayerKind = 'source' | 'widget-group' | 'text-widget' | 'image-widget' | 'clock-widget' | 'life-widget' | 'wins-widget';

function nextId(prefix: string) {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function widgetTypeFromLayerKind(kind: FeatureMatchOverlayLayerKind): FeatureMatchWidgetConfig['type'] {
	switch (kind) {
		case 'image-widget':
			return 'image';
		case 'clock-widget':
			return 'clock';
		case 'life-widget':
			return 'player-life';
		case 'wins-widget':
			return 'game-wins';
		case 'text-widget':
		default:
			return 'text';
	}
}

function newLayerLabel(type: FeatureMatchWidgetConfig['type']) {
	return `${featureMatchOverlayWidgetDefinition(type).label} Widget`;
}

function itemAnchorValue(item: FeatureMatchLayoutItemConfig): FeatureMatchOverlayAnchorValue {
	return item.anchor ?? 'top-left';
}

function stackArrangement(mode: 'row' | 'column', current: FeatureMatchWidgetGroupItemConfig) {
	return {
		mode,
		padding: current.arrangement.padding ?? 0,
		gap: current.arrangement.mode === 'row' || current.arrangement.mode === 'column' ? current.arrangement.gap : 8,
		align: current.arrangement.mode === 'row' || current.arrangement.mode === 'column' ? current.arrangement.align : 'stretch',
		justify: current.arrangement.mode === 'row' || current.arrangement.mode === 'column' ? current.arrangement.justify : 'start',
	};
}

function withItems(layout: FeatureMatchLayoutConfig, items: FeatureMatchLayoutItemConfig[]): FeatureMatchLayoutConfig {
	return { ...layout, items };
}

function mapItem(
	layout: FeatureMatchLayoutConfig,
	id: string,
	updater: (item: FeatureMatchLayoutItemConfig) => FeatureMatchLayoutItemConfig,
): FeatureMatchLayoutConfig {
	const index = layout.items.findIndex(item => item.id === id);
	const item = index >= 0 ? layout.items[index]! : undefined;
	if (!item)
		return layout;
	const updated = updater(item);
	if (updated === item)
		return layout;
	const items = [...layout.items];
	items[index] = updated;
	return withItems(layout, items);
}

function mapGroup(
	layout: FeatureMatchLayoutConfig,
	id: string,
	updater: (group: FeatureMatchWidgetGroupItemConfig) => FeatureMatchWidgetGroupItemConfig,
): FeatureMatchLayoutConfig {
	return mapItem(layout, id, item => item.type === 'widget-group' ? updater(item) : item);
}

function mapGroupChild(
	layout: FeatureMatchLayoutConfig,
	groupId: string,
	childId: string,
	updater: (child: FeatureMatchWidgetGroupChildConfig, group: FeatureMatchWidgetGroupItemConfig) => FeatureMatchWidgetGroupChildConfig,
): FeatureMatchLayoutConfig {
	return mapGroup(layout, groupId, (group) => {
		const index = group.children.findIndex(child => child.id === childId);
		const child = index >= 0 ? group.children[index]! : undefined;
		if (!child)
			return group;
		const updated = updater(child, group);
		if (updated === child)
			return group;
		const children = [...group.children];
		children[index] = updated;
		return { ...group, children };
	});
}

// ──────────────── Frame ────────────────

export function patchFrame(layout: FeatureMatchLayoutConfig, updates: Partial<FeatureMatchLayoutFrameConfig>): FeatureMatchLayoutConfig {
	return { ...layout, frame: { ...layout.frame, ...updates } };
}

// ──────────────── Layout Items ────────────────

export function patchItem(layout: FeatureMatchLayoutConfig, id: string, updates: Partial<FeatureMatchLayoutItemConfig>): FeatureMatchLayoutConfig {
	return mapItem(layout, id, item => ({ ...item, ...updates }) as FeatureMatchLayoutItemConfig);
}

export function patchItemSurfaceStyle(layout: FeatureMatchLayoutConfig, id: string, updates: Partial<FeatureMatchOverlayBoxStyle>): FeatureMatchLayoutConfig {
	return mapItem(layout, id, item => ({ ...item, surfaceStyle: { ...(item.surfaceStyle ?? {}), ...updates } }) as FeatureMatchLayoutItemConfig);
}

export function addItem(layout: FeatureMatchLayoutConfig, item: FeatureMatchLayoutItemConfig): FeatureMatchLayoutConfig {
	return withItems(layout, [...layout.items, item]);
}

export function removeItem(layout: FeatureMatchLayoutConfig, id: string): FeatureMatchLayoutConfig {
	const items = layout.items.filter(item => item.id !== id);
	return items.length === layout.items.length ? layout : withItems(layout, items);
}

/** Anchored geometry edit: resize/move around the item's anchor with an already-parsed value. */
export function patchItemRectFromAnchor(layout: FeatureMatchLayoutConfig, id: string, field: FeatureMatchOverlayGeometryField, nextValue: number): FeatureMatchLayoutConfig {
	return mapItem(layout, id, (item) => {
		const updates = updateFeatureMatchOverlayRectFromAnchor(item, field, nextValue, itemAnchorValue(item));
		return { ...item, ...updates } as FeatureMatchLayoutItemConfig;
	});
}

// ──────────────── Widget Groups ────────────────

export function patchGroup(layout: FeatureMatchLayoutConfig, id: string, updates: Partial<FeatureMatchWidgetGroupItemConfig>): FeatureMatchLayoutConfig {
	return mapGroup(layout, id, group => ({ ...group, ...updates }));
}

export function patchGroupDefaultChildSurfaceStyle(layout: FeatureMatchLayoutConfig, id: string, updates: Partial<FeatureMatchOverlayBoxStyle>): FeatureMatchLayoutConfig {
	return mapGroup(layout, id, group => ({
		...group,
		defaultChildSurfaceStyle: { ...(group.defaultChildSurfaceStyle ?? {}), ...updates },
	}));
}

export function patchGroupChild(layout: FeatureMatchLayoutConfig, groupId: string, childId: string, updates: Partial<FeatureMatchWidgetGroupChildConfig>): FeatureMatchLayoutConfig {
	return mapGroupChild(layout, groupId, childId, child => ({ ...child, ...updates }));
}

export function patchGroupChildWidget(layout: FeatureMatchLayoutConfig, groupId: string, childId: string, updates: Partial<FeatureMatchWidgetConfig>): FeatureMatchLayoutConfig {
	return mapGroupChild(layout, groupId, childId, child => ({
		...child,
		widget: { ...child.widget, ...updates } as FeatureMatchWidgetConfig,
	}));
}

export function patchGroupChildSurfaceStyle(layout: FeatureMatchLayoutConfig, groupId: string, childId: string, updates: Partial<FeatureMatchOverlayBoxStyle>): FeatureMatchLayoutConfig {
	return mapGroupChild(layout, groupId, childId, child => ({ ...child, surfaceStyle: { ...(child.surfaceStyle ?? {}), ...updates } }));
}

export function addGroupChild(layout: FeatureMatchLayoutConfig, groupId: string, child: FeatureMatchWidgetGroupChildConfig): FeatureMatchLayoutConfig {
	return mapGroup(layout, groupId, group => ({ ...group, children: [...group.children, child] }));
}

export function removeGroupChild(layout: FeatureMatchLayoutConfig, groupId: string, childId: string): FeatureMatchLayoutConfig {
	return mapGroup(layout, groupId, (group) => {
		const children = group.children.filter(child => child.id !== childId);
		return children.length === group.children.length ? group : { ...group, children };
	});
}

/** Anchored geometry edit for a canvas-positioned Widget Group child. */
export function patchGroupChildRectFromAnchor(layout: FeatureMatchLayoutConfig, groupId: string, childId: string, field: FeatureMatchOverlayGeometryField, nextValue: number): FeatureMatchLayoutConfig {
	return mapGroupChild(layout, groupId, childId, (child) => {
		if (child.layout.mode !== 'canvas')
			return child;
		const anchor = child.layout.anchor ?? 'top-left';
		const updates = updateFeatureMatchOverlayRectFromAnchor(child.layout, field, nextValue, anchor);
		return { ...child, layout: { ...child.layout, ...updates } };
	});
}

/**
 * Convert a Widget Group's arrangement, rewriting each child's layout into
 * the target mode: stack children get staggered canvas rects; canvas
 * children get fixed stack sizing from their main-axis extent. Children
 * already in the target mode are untouched.
 */
export function convertGroupArrangement(layout: FeatureMatchLayoutConfig, id: string, mode: 'row' | 'column' | 'canvas'): FeatureMatchLayoutConfig {
	return mapGroup(layout, id, (group) => {
		const padding = group.arrangement.padding ?? 0;
		const children = group.children.map((child, childIndex) => {
			if (mode === 'canvas') {
				if (child.layout.mode === 'canvas')
					return child;
				const size = child.layout.sizing.size ?? child.layout.sizing.min ?? 120;
				return {
					...child,
					layout: { mode: 'canvas' as const, x: childIndex * (size + 8), y: 0, width: size, height: Math.max(40, group.height - padding * 2) },
				};
			}

			if (child.layout.mode === 'stack')
				return child;
			return {
				...child,
				layout: { mode: 'stack' as const, sizing: { mode: 'fixed' as const, size: mode === 'row' ? child.layout.width : child.layout.height }, offsetX: 0, offsetY: 0 },
			};
		});

		return {
			...group,
			arrangement: mode === 'canvas' ? { mode, padding } : stackArrangement(mode, group),
			children,
		};
	});
}

// ──────────────── Stacking order ────────────────

function layerOrders(layout: FeatureMatchLayoutConfig): number[] {
	return layout.items
		.map(item => item.zIndex ?? 0)
		.sort((a, b) => a - b);
}

export function setItemOrder(layout: FeatureMatchLayoutConfig, id: string, order: number): FeatureMatchLayoutConfig {
	return patchItem(layout, id, { zIndex: order });
}

export function moveItemOrder(layout: FeatureMatchLayoutConfig, id: string, direction: -1 | 1): FeatureMatchLayoutConfig {
	const item = layout.items.find(candidate => candidate.id === id);
	if (!item)
		return layout;

	const orders = layerOrders(layout);
	const current = item.zIndex ?? 0;
	const currentIndex = orders.findIndex(order => order >= current);
	const targetIndex = Math.max(0, Math.min(orders.length - 1, currentIndex + direction));
	const target = orders[targetIndex] ?? current;
	const next = target === current ? current + direction : target + direction;
	return setItemOrder(layout, id, next);
}

export function sendItemToBack(layout: FeatureMatchLayoutConfig, id: string): FeatureMatchLayoutConfig {
	return setItemOrder(layout, id, (layerOrders(layout)[0] ?? 0) - 1);
}

export function bringItemToFront(layout: FeatureMatchLayoutConfig, id: string): FeatureMatchLayoutConfig {
	return setItemOrder(layout, id, (layerOrders(layout).at(-1) ?? 0) + 1);
}

// ──────────────── Creation ────────────────

/** Create a new Layout Item of the given kind. Returns the new layout and the item's id. */
export function createLayoutItem(layout: FeatureMatchLayoutConfig, kind: FeatureMatchOverlayLayerKind): { layout: FeatureMatchLayoutConfig; id: string } {
	const id = nextId('layer');
	const base = { id, label: 'New Layer', visible: true, x: 80, y: 80, width: 280, height: 80, zIndex: 40, surfaceStyle: { textColor: '#ffffff', fontSize: 24, fontWeight: 700, backgroundOpacity: 0 } };
	let item: FeatureMatchLayoutItemConfig;

	if (kind === 'source') {
		item = { ...base, type: 'source', label: 'New Source', sourceRole: 'main', frameCutout: true, width: 420, height: 240, surfaceStyle: { backgroundColor: '#000000', backgroundOpacity: 0, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8 } };
	}
	else if (kind === 'widget-group') {
		item = { ...base, type: 'widget-group', label: 'New Group', width: 520, height: 90, surfaceStyle: { backgroundOpacity: 0 }, defaultChildSurfaceStyle: base.surfaceStyle, arrangement: { mode: 'canvas', padding: 0 }, overflow: 'clip', children: [] };
	}
	else {
		const widgetType = widgetTypeFromLayerKind(kind);
		item = { ...base, type: 'widget', label: newLayerLabel(widgetType), widget: featureMatchOverlayWidgetDefinition(widgetType).defaultConfig() };
	}

	return { layout: addItem(layout, item), id };
}

/** Create a new child in a Widget Group, matching its arrangement mode. Returns a null id when the item is not a group. */
export function createGroupChild(layout: FeatureMatchLayoutConfig, groupId: string, type: FeatureMatchWidgetConfig['type']): { layout: FeatureMatchLayoutConfig; id: string | null } {
	const group = layout.items.find(item => item.id === groupId);
	if (group?.type !== 'widget-group')
		return { layout, id: null };

	const id = nextId('widget');
	const next = addGroupChild(layout, groupId, {
		id,
		label: newLayerLabel(type),
		visible: true,
		widget: featureMatchOverlayWidgetDefinition(type).defaultConfig(),
		layout: group.arrangement.mode === 'canvas'
			? { mode: 'canvas', x: 0, y: 0, width: 180, height: 64 }
			: { mode: 'stack', sizing: { mode: 'fixed', size: 180 } },
	});
	return { layout: next, id };
}
