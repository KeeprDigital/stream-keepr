import type {
	FeatureMatchGraphicGroupChildConfig,
	FeatureMatchGraphicGroupGraphicItemDefinitionConfig,
	FeatureMatchGraphicGroupItemConfig,
	FeatureMatchGraphicItemDefinitionConfig,
	FeatureMatchLayoutConfig,
	FeatureMatchLayoutFrameConfig,
	FeatureMatchLayoutItemConfig,
	FeatureMatchOverlayBoxStyle,
} from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayAnchorValue } from '~/utils/featureMatchOverlayGeometry';
import { featureMatchOverlayGraphicItemDefinition } from '~/modules/feature-match-overlay/graphicItemDefinitions';
import { updateFeatureMatchOverlayRectFromAnchor } from '~/utils/featureMatchOverlayGeometry';

/**
 * The Feature Match Layout writer: every mutation of a Feature Match Layout
 * goes through these pure, id-addressed functions. A mutation that cannot
 * apply (unknown id, wrong item kind, wrong layout mode) returns the SAME
 * layout reference — callers submit only when the reference changed.
 */

export type FeatureMatchOverlayGeometryField = 'x' | 'y' | 'width' | 'height';
export type FeatureMatchOverlayLayerKind = 'source' | 'media' | 'graphic-group' | 'text-graphic-item' | 'clock-graphic-item' | 'life-graphic-item' | 'wins-graphic-item';
export type FeatureMatchGraphicGroupChildKind = FeatureMatchGraphicItemDefinitionConfig['type'] | 'media';

function nextId(prefix: string) {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function graphicItemTypeFromLayerKind(kind: FeatureMatchOverlayLayerKind): FeatureMatchGraphicItemDefinitionConfig['type'] {
	switch (kind) {
		case 'clock-graphic-item':
			return 'clock';
		case 'life-graphic-item':
			return 'player-life';
		case 'wins-graphic-item':
			return 'game-wins';
		case 'text-graphic-item':
		default:
			return 'text';
	}
}

function newLayerLabel(type: FeatureMatchGraphicItemDefinitionConfig['type']) {
	return `${featureMatchOverlayGraphicItemDefinition(type).label} Graphic Item`;
}

function itemAnchorValue(item: FeatureMatchLayoutItemConfig): FeatureMatchOverlayAnchorValue {
	return item.anchor ?? 'top-left';
}

function stackArrangement(mode: 'row' | 'column', current: FeatureMatchGraphicGroupItemConfig) {
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
	updater: (group: FeatureMatchGraphicGroupItemConfig) => FeatureMatchGraphicGroupItemConfig,
): FeatureMatchLayoutConfig {
	return mapItem(layout, id, item => item.type === 'graphic-group' ? updater(item) : item);
}

function mapGroupChild(
	layout: FeatureMatchLayoutConfig,
	groupId: string,
	childId: string,
	updater: (child: FeatureMatchGraphicGroupChildConfig, group: FeatureMatchGraphicGroupItemConfig) => FeatureMatchGraphicGroupChildConfig,
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
	return mapItem(layout, id, item =>
		item.type === 'media'
			? item
			: { ...item, surfaceStyle: { ...(item.surfaceStyle ?? {}), ...updates } });
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

// ──────────────── Graphic Groups ────────────────

export function patchGroup(layout: FeatureMatchLayoutConfig, id: string, updates: Partial<FeatureMatchGraphicGroupItemConfig>): FeatureMatchLayoutConfig {
	return mapGroup(layout, id, group => ({ ...group, ...updates }));
}

export function patchGroupDefaultChildSurfaceStyle(layout: FeatureMatchLayoutConfig, id: string, updates: Partial<FeatureMatchOverlayBoxStyle>): FeatureMatchLayoutConfig {
	return mapGroup(layout, id, group => ({
		...group,
		defaultChildSurfaceStyle: { ...(group.defaultChildSurfaceStyle ?? {}), ...updates },
	}));
}

export function patchGroupChild(layout: FeatureMatchLayoutConfig, groupId: string, childId: string, updates: Partial<FeatureMatchGraphicGroupChildConfig>): FeatureMatchLayoutConfig {
	return mapGroupChild(layout, groupId, childId, child => ({ ...child, ...updates }) as FeatureMatchGraphicGroupChildConfig);
}

export function patchGroupChildGraphicItem(layout: FeatureMatchLayoutConfig, groupId: string, childId: string, updates: Partial<FeatureMatchGraphicGroupGraphicItemDefinitionConfig>): FeatureMatchLayoutConfig {
	return mapGroupChild(layout, groupId, childId, child => child.type === 'media'
		? child
		: {
				...child,
				graphicItem: { ...child.graphicItem, ...updates } as FeatureMatchGraphicGroupGraphicItemDefinitionConfig,
			});
}

export function patchGroupChildSurfaceStyle(layout: FeatureMatchLayoutConfig, groupId: string, childId: string, updates: Partial<FeatureMatchOverlayBoxStyle>): FeatureMatchLayoutConfig {
	return mapGroupChild(layout, groupId, childId, child => child.type === 'media'
		? child
		: { ...child, surfaceStyle: { ...(child.surfaceStyle ?? {}), ...updates } });
}

export function addGroupChild(layout: FeatureMatchLayoutConfig, groupId: string, child: FeatureMatchGraphicGroupChildConfig): FeatureMatchLayoutConfig {
	return mapGroup(layout, groupId, group => ({ ...group, children: [...group.children, child] }));
}

export function removeGroupChild(layout: FeatureMatchLayoutConfig, groupId: string, childId: string): FeatureMatchLayoutConfig {
	return mapGroup(layout, groupId, (group) => {
		const children = group.children.filter(child => child.id !== childId);
		return children.length === group.children.length ? group : { ...group, children };
	});
}

function moveArrayEntry<T>(items: readonly T[], currentIndex: number, targetIndex: number): T[] {
	if (
		currentIndex < 0
		|| targetIndex < 0
		|| targetIndex >= items.length
		|| currentIndex === targetIndex
	) {
		return items as T[];
	}
	const next = [...items];
	const [item] = next.splice(currentIndex, 1);
	next.splice(targetIndex, 0, item!);
	return next;
}

export function moveGroupChildOrder(
	layout: FeatureMatchLayoutConfig,
	groupId: string,
	childId: string,
	direction: -1 | 1,
): FeatureMatchLayoutConfig {
	return mapGroup(layout, groupId, (group) => {
		const currentIndex = group.children.findIndex(child => child.id === childId);
		const targetIndex = Math.max(0, Math.min(group.children.length - 1, currentIndex + direction));
		const children = moveArrayEntry(group.children, currentIndex, targetIndex);
		return children === group.children ? group : { ...group, children };
	});
}

export function sendGroupChildToBack(layout: FeatureMatchLayoutConfig, groupId: string, childId: string): FeatureMatchLayoutConfig {
	return mapGroup(layout, groupId, (group) => {
		const children = moveArrayEntry(
			group.children,
			group.children.findIndex(child => child.id === childId),
			0,
		);
		return children === group.children ? group : { ...group, children };
	});
}

export function bringGroupChildToFront(layout: FeatureMatchLayoutConfig, groupId: string, childId: string): FeatureMatchLayoutConfig {
	return mapGroup(layout, groupId, (group) => {
		const children = moveArrayEntry(
			group.children,
			group.children.findIndex(child => child.id === childId),
			group.children.length - 1,
		);
		return children === group.children ? group : { ...group, children };
	});
}

/** Anchored geometry edit for a canvas-positioned Graphic Group child. */
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
 * Convert a Graphic Group's arrangement, rewriting each child's layout into
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

// ──────────────── Graphic Layer Order ────────────────

export function setItemOrder(layout: FeatureMatchLayoutConfig, id: string, order: number): FeatureMatchLayoutConfig {
	const currentIndex = layout.items.findIndex(item => item.id === id);
	if (currentIndex < 0 || layout.items.length === 0)
		return layout;
	const targetIndex = Math.max(0, Math.min(layout.items.length - 1, Math.trunc(order)));
	const items = moveArrayEntry(layout.items, currentIndex, targetIndex);
	return items === layout.items ? layout : withItems(layout, items);
}

export function moveItemOrder(layout: FeatureMatchLayoutConfig, id: string, direction: -1 | 1): FeatureMatchLayoutConfig {
	const currentIndex = layout.items.findIndex(item => item.id === id);
	if (currentIndex < 0)
		return layout;
	return setItemOrder(layout, id, currentIndex + direction);
}

export function sendItemToBack(layout: FeatureMatchLayoutConfig, id: string): FeatureMatchLayoutConfig {
	return setItemOrder(layout, id, 0);
}

export function bringItemToFront(layout: FeatureMatchLayoutConfig, id: string): FeatureMatchLayoutConfig {
	return setItemOrder(layout, id, layout.items.length - 1);
}

// ──────────────── Creation ────────────────

/** Create a new Layout Item of the given kind. Returns the new layout and the item's id. */
export function createLayoutItem(layout: FeatureMatchLayoutConfig, kind: FeatureMatchOverlayLayerKind): { layout: FeatureMatchLayoutConfig; id: string } {
	const id = nextId('layer');
	const base = { id, label: 'New Layer', visible: true, x: 80, y: 80, width: 280, height: 80, surfaceStyle: { textColor: '#ffffff', fontSize: 24, fontWeight: 700, backgroundOpacity: 0 } };
	let item: FeatureMatchLayoutItemConfig;

	if (kind === 'source') {
		item = {
			...base,
			...featureMatchOverlayGraphicItemDefinition('source').defaultConfig(),
			type: 'source',
			label: 'New Source',
			width: 420,
			height: 240,
		};
	}
	else if (kind === 'media') {
		const { surfaceStyle: _surfaceStyle, ...mediaBase } = base;
		item = {
			...mediaBase,
			...featureMatchOverlayGraphicItemDefinition('media').defaultConfig(),
			type: 'media',
			label: 'New Media',
			width: 420,
			height: 240,
		};
	}
	else if (kind === 'graphic-group') {
		item = {
			...base,
			...featureMatchOverlayGraphicItemDefinition('graphic-group').defaultConfig(),
			type: 'graphic-group',
			label: 'New Group',
			width: 520,
			height: 90,
			defaultChildSurfaceStyle: base.surfaceStyle,
		};
	}
	else {
		const graphicItemType = graphicItemTypeFromLayerKind(kind);
		item = { ...base, type: 'graphic-item', label: newLayerLabel(graphicItemType), graphicItem: featureMatchOverlayGraphicItemDefinition(graphicItemType).defaultConfig() };
	}

	return { layout: addItem(layout, item), id };
}

/** Create a new child in a Graphic Group, matching its arrangement mode. Returns a null id when the item is not a group. */
export function createGroupChild(layout: FeatureMatchLayoutConfig, groupId: string, type: FeatureMatchGraphicGroupChildKind): { layout: FeatureMatchLayoutConfig; id: string | null } {
	const group = layout.items.find(item => item.id === groupId);
	if (group?.type !== 'graphic-group')
		return { layout, id: null };

	const id = nextId(type === 'media' ? 'media' : 'graphic-item');
	const childLayout = group.arrangement.mode === 'canvas'
		? { mode: 'canvas' as const, x: 0, y: 0, width: 180, height: 64 }
		: { mode: 'stack' as const, sizing: { mode: 'fixed' as const, size: 180 } };
	const next = addGroupChild(layout, groupId, {
		id,
		...(type === 'media'
			? {
					...featureMatchOverlayGraphicItemDefinition('media').defaultConfig(),
					type: 'media' as const,
					label: 'Media Graphic Item',
				}
			: {
					type: 'graphic-item' as const,
					label: newLayerLabel(type),
					graphicItem: featureMatchOverlayGraphicItemDefinition(type).defaultConfig(),
				}),
		visible: true,
		layout: childLayout,
	});
	return { layout: next, id };
}
