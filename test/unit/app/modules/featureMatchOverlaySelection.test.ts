import type { FeatureMatchLayoutConfig, FeatureMatchSourceItemConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	featureMatchOverlaySelectionKey,
	isFeatureMatchOverlaySelectionTarget,
	resolveFeatureMatchOverlaySelection,
} from '~~/app/modules/feature-match-overlay/selection';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

function layoutOf(sources: FeatureMatchSourceItemConfig[]): FeatureMatchLayoutConfig {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	return { ...base.layout, sources };
}

const sourceItem: FeatureMatchSourceItemConfig = { id: 's1', label: 'Source', visible: true, x: 0, y: 0, width: 100, height: 100, sourceRole: 'main', frameCutout: true };

describe('feature-match-overlay selection', () => {
	describe('resolveFeatureMatchOverlaySelection', () => {
		const layout = layoutOf([sourceItem]);

		it('resolves canvas', () => {
			expect(resolveFeatureMatchOverlaySelection(layout, { type: 'canvas' })).toEqual({ kind: 'canvas' });
		});

		it('resolves a source target to its Source Item', () => {
			expect(resolveFeatureMatchOverlaySelection(layout, { type: 'source', itemId: 's1' }))
				.toMatchObject({ kind: 'source', item: { id: 's1' } });
		});

		it('resolves missing ids to the missing kind', () => {
			expect(resolveFeatureMatchOverlaySelection(layout, { type: 'source', itemId: 'nope' })).toEqual({ kind: 'missing' });
		});

		it('never resolves a shared Graphic Item, which the compositor selects instead', () => {
			const compositionItemId = layout.composition.items[0]!.id;

			expect(resolveFeatureMatchOverlaySelection(layout, { type: 'source', itemId: compositionItemId }))
				.toEqual({ kind: 'missing' });
		});
	});

	describe('featureMatchOverlaySelectionKey', () => {
		it('produces distinct stable keys per variant', () => {
			expect(featureMatchOverlaySelectionKey({ type: 'canvas' })).toBe('canvas');
			expect(featureMatchOverlaySelectionKey({ type: 'source', itemId: 'a' })).toBe('source:a');
		});
	});

	describe('isFeatureMatchOverlaySelectionTarget', () => {
		it('accepts each well-formed variant', () => {
			expect(isFeatureMatchOverlaySelectionTarget({ type: 'canvas' })).toBe(true);
			expect(isFeatureMatchOverlaySelectionTarget({ type: 'source', itemId: 'a' })).toBe(true);
		});

		it('rejects malformed values', () => {
			expect(isFeatureMatchOverlaySelectionTarget(null)).toBe(false);
			expect(isFeatureMatchOverlaySelectionTarget({ type: 'source' })).toBe(false);
			expect(isFeatureMatchOverlaySelectionTarget({ type: 'layer', itemId: 'a' })).toBe(false);
			expect(isFeatureMatchOverlaySelectionTarget({ type: 'other' })).toBe(false);
		});
	});
});
