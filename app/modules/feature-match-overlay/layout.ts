import type {
	FeatureMatchLayoutConfig,
	FeatureMatchLayoutFrameConfig,
	FeatureMatchSourceFramingStyle,
	FeatureMatchSourceItemConfig,
} from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayAnchorValue } from '~/utils/featureMatchOverlayGeometry';
import { createFeatureMatchSourceItem } from '~~/shared/featureMatchSourceItems';
import { updateFeatureMatchOverlayRectFromAnchor } from '~/utils/featureMatchOverlayGeometry';

/**
 * The host-owned Feature Match Layout writer: every mutation of the Frame or of
 * a Source Item goes through these pure, id-addressed functions. A mutation that
 * cannot apply (unknown id) returns the SAME layout reference — callers submit
 * only when the reference changed.
 *
 * The shared item tree has its own writer, in the shared compositor's authoring
 * module. This one is deliberately small now: the legacy widget, widget-group,
 * and numeric z-index model it used to write is gone.
 */

export type FeatureMatchOverlayGeometryField = 'x' | 'y' | 'width' | 'height';

function nextId(prefix: string) {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function withSources(layout: FeatureMatchLayoutConfig, sources: FeatureMatchSourceItemConfig[]): FeatureMatchLayoutConfig {
	return { ...layout, sources };
}

function mapSource(
	layout: FeatureMatchLayoutConfig,
	id: string,
	updater: (item: FeatureMatchSourceItemConfig) => FeatureMatchSourceItemConfig,
): FeatureMatchLayoutConfig {
	const index = layout.sources.findIndex(item => item.id === id);
	const item = index >= 0 ? layout.sources[index]! : undefined;
	if (!item)
		return layout;
	const updated = updater(item);
	if (updated === item)
		return layout;
	const sources = [...layout.sources];
	sources[index] = updated;
	return withSources(layout, sources);
}

// ──────────────── Frame ────────────────

export function patchFrame(layout: FeatureMatchLayoutConfig, updates: Partial<FeatureMatchLayoutFrameConfig>): FeatureMatchLayoutConfig {
	return { ...layout, frame: { ...layout.frame, ...updates } };
}

// ──────────────── Source Items ────────────────

export function patchSource(layout: FeatureMatchLayoutConfig, id: string, updates: Partial<FeatureMatchSourceItemConfig>): FeatureMatchLayoutConfig {
	return mapSource(layout, id, item => ({ ...item, ...updates }));
}

export function patchSourceFramingStyle(layout: FeatureMatchLayoutConfig, id: string, updates: Partial<FeatureMatchSourceFramingStyle>): FeatureMatchLayoutConfig {
	return mapSource(layout, id, item => ({ ...item, framingStyle: { ...(item.framingStyle ?? {}), ...updates } }));
}

export function removeSource(layout: FeatureMatchLayoutConfig, id: string): FeatureMatchLayoutConfig {
	const sources = layout.sources.filter(item => item.id !== id);
	return sources.length === layout.sources.length ? layout : withSources(layout, sources);
}

/** Anchored geometry edit: resize/move around the Source Item's anchor with an already-parsed value. */
export function patchSourceRectFromAnchor(layout: FeatureMatchLayoutConfig, id: string, field: FeatureMatchOverlayGeometryField, nextValue: number): FeatureMatchLayoutConfig {
	return mapSource(layout, id, (item) => {
		const updates = updateFeatureMatchOverlayRectFromAnchor(item, field, nextValue, item.anchor ?? 'top-left' as FeatureMatchOverlayAnchorValue);
		return { ...item, ...updates };
	});
}

// ──────────────── Graphic Layer Order ────────────────

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

export function setSourceOrder(layout: FeatureMatchLayoutConfig, id: string, order: number): FeatureMatchLayoutConfig {
	const currentIndex = layout.sources.findIndex(item => item.id === id);
	if (currentIndex < 0 || layout.sources.length === 0)
		return layout;
	const targetIndex = Math.max(0, Math.min(layout.sources.length - 1, Math.trunc(order)));
	const sources = moveArrayEntry(layout.sources, currentIndex, targetIndex);
	return sources === layout.sources ? layout : withSources(layout, sources);
}

export function moveSourceOrder(layout: FeatureMatchLayoutConfig, id: string, direction: -1 | 1): FeatureMatchLayoutConfig {
	const currentIndex = layout.sources.findIndex(item => item.id === id);
	if (currentIndex < 0)
		return layout;
	return setSourceOrder(layout, id, currentIndex + direction);
}

export function sendSourceToBack(layout: FeatureMatchLayoutConfig, id: string): FeatureMatchLayoutConfig {
	return setSourceOrder(layout, id, 0);
}

export function bringSourceToFront(layout: FeatureMatchLayoutConfig, id: string): FeatureMatchLayoutConfig {
	return setSourceOrder(layout, id, layout.sources.length - 1);
}

// ──────────────── Creation ────────────────

/** Create a new Source Item. Returns the new layout and the item's id. */
export function createSourceItem(layout: FeatureMatchLayoutConfig): { layout: FeatureMatchLayoutConfig; id: string } {
	const id = nextId('source');
	return { layout: withSources(layout, [...layout.sources, createFeatureMatchSourceItem(id)]), id };
}
