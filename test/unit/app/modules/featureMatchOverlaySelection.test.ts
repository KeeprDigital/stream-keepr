import type { FeatureMatchLayoutConfig, FeatureMatchLayoutItemConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	featureMatchOverlaySelectionKey,
	isFeatureMatchOverlaySelectionTarget,
	resolveFeatureMatchOverlaySelection,
} from '~~/app/modules/feature-match-overlay/selection';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

function layoutOf(items: FeatureMatchLayoutItemConfig[]): FeatureMatchLayoutConfig {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	return { ...base.layout, items };
}

const sourceItem: FeatureMatchLayoutItemConfig = { id: 's1', type: 'source', label: 'Source', visible: true, x: 0, y: 0, width: 100, height: 100, sourceRole: 'main', frameCutout: true };
const graphicItemItem: FeatureMatchLayoutItemConfig = { id: 'w1', type: 'graphic-item', label: 'Graphic Item', visible: true, x: 0, y: 0, width: 100, height: 40, graphicItem: { type: 'clock' } };
const groupItem: FeatureMatchLayoutItemConfig = {
	id: 'g1',
	type: 'graphic-group',
	label: 'Group',
	visible: true,
	x: 0,
	y: 0,
	width: 500,
	height: 100,
	arrangement: { mode: 'row', padding: 0, gap: 8, align: 'stretch', justify: 'start' },
	children: [{ id: 'c1', label: 'Child', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'stack', sizing: { mode: 'fixed', size: 120 } } }],
};

describe('feature-match-overlay selection', () => {
	describe('resolveFeatureMatchOverlaySelection', () => {
		const layout = layoutOf([sourceItem, graphicItemItem, groupItem]);

		it('resolves canvas', () => {
			expect(resolveFeatureMatchOverlaySelection(layout, { type: 'canvas' })).toEqual({ kind: 'canvas' });
		});

		it('resolves a layer target to its item kind', () => {
			expect(resolveFeatureMatchOverlaySelection(layout, { type: 'layer', itemId: 's1' })).toMatchObject({ kind: 'source', item: { id: 's1' } });
			expect(resolveFeatureMatchOverlaySelection(layout, { type: 'layer', itemId: 'w1' })).toMatchObject({ kind: 'graphic-item', item: { id: 'w1' } });
			expect(resolveFeatureMatchOverlaySelection(layout, { type: 'layer', itemId: 'g1' })).toMatchObject({ kind: 'graphic-group', item: { id: 'g1' } });
		});

		it('resolves a graphicItem target to the group child', () => {
			expect(resolveFeatureMatchOverlaySelection(layout, { type: 'graphic-item', itemId: 'g1', childId: 'c1' }))
				.toMatchObject({ kind: 'child', group: { id: 'g1' }, child: { id: 'c1' } });
		});

		it('resolves missing ids to the missing kind', () => {
			expect(resolveFeatureMatchOverlaySelection(layout, { type: 'layer', itemId: 'nope' })).toEqual({ kind: 'missing' });
			expect(resolveFeatureMatchOverlaySelection(layout, { type: 'graphic-item', itemId: 'g1', childId: 'nope' })).toEqual({ kind: 'missing' });
			expect(resolveFeatureMatchOverlaySelection(layout, { type: 'graphic-item', itemId: 'w1', childId: 'c1' })).toEqual({ kind: 'missing' });
		});
	});

	describe('featureMatchOverlaySelectionKey', () => {
		it('produces distinct stable keys per variant', () => {
			expect(featureMatchOverlaySelectionKey({ type: 'canvas' })).toBe('canvas');
			expect(featureMatchOverlaySelectionKey({ type: 'layer', itemId: 'a' })).toBe('layer:a');
			expect(featureMatchOverlaySelectionKey({ type: 'graphic-item', itemId: 'a', childId: 'b' })).toBe('graphicItem:a:b');
		});
	});

	describe('isFeatureMatchOverlaySelectionTarget', () => {
		it('accepts each well-formed variant', () => {
			expect(isFeatureMatchOverlaySelectionTarget({ type: 'canvas' })).toBe(true);
			expect(isFeatureMatchOverlaySelectionTarget({ type: 'layer', itemId: 'a' })).toBe(true);
			expect(isFeatureMatchOverlaySelectionTarget({ type: 'graphic-item', itemId: 'a', childId: 'b' })).toBe(true);
		});

		it('rejects malformed values', () => {
			expect(isFeatureMatchOverlaySelectionTarget(null)).toBe(false);
			expect(isFeatureMatchOverlaySelectionTarget({ type: 'layer' })).toBe(false);
			expect(isFeatureMatchOverlaySelectionTarget({ type: 'graphic-item', itemId: 'a' })).toBe(false);
			expect(isFeatureMatchOverlaySelectionTarget({ type: 'other' })).toBe(false);
		});
	});
});
