import type { FeatureMatchLayoutConfig, FeatureMatchSourceItemConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	bringSourceToFront,
	createSourceItem,
	duplicateSource,
	moveSourceOrder,
	patchFrame,
	patchSource,
	patchSourceFramingStyle,
	removeSource,
	sendSourceToBack,
} from '~~/app/modules/feature-match-overlay/layout';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

/**
 * The host-owned Feature Match Layout writer.
 *
 * It writes the Frame and the Source Items and nothing else — the shared item
 * tree has its own writer — and every mutation that cannot apply returns the same
 * layout reference so callers know not to submit.
 */

function source(overrides: Partial<FeatureMatchSourceItemConfig> = {}): FeatureMatchSourceItemConfig {
	return {
		id: 's1',
		label: 'Source',
		visible: true,
		x: 100,
		y: 50,
		width: 200,
		height: 100,
		sourceRole: 'main',
		frameCutout: true,
		...overrides,
	};
}

function layoutOf(sources: FeatureMatchSourceItemConfig[]): FeatureMatchLayoutConfig {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	return { ...base.layout, sources };
}

describe('feature match layout writer', () => {
	it('patches the Frame without touching the Source Items or the composition', () => {
		const layout = layoutOf([source()]);

		const next = patchFrame(layout, { backgroundColor: '#123456' });

		expect(next.frame.backgroundColor).toBe('#123456');
		expect(next.sources).toBe(layout.sources);
		expect(next.composition).toBe(layout.composition);
	});

	it('patches a Source Item by id', () => {
		const layout = layoutOf([source(), source({ id: 's2' })]);

		const next = patchSource(layout, 's2', { label: 'Renamed' });

		expect(next.sources[1]!.label).toBe('Renamed');
		expect(next.sources[0]).toBe(layout.sources[0]);
	});

	it('merges a Source Item surface style rather than replacing it', () => {
		const layout = layoutOf([source({ framingStyle: { borderVisible: true, borderColor: '#ffffff' } })]);

		const next = patchSourceFramingStyle(layout, 's1', { borderWidth: 6 });

		expect(next.sources[0]!.framingStyle).toEqual({ borderVisible: true, borderColor: '#ffffff', borderWidth: 6 });
	});

	it('returns the same layout when an id names nothing', () => {
		const layout = layoutOf([source()]);

		expect(patchSource(layout, 'missing', { label: 'x' })).toBe(layout);
		expect(patchSourceFramingStyle(layout, 'missing', { borderWidth: 1 })).toBe(layout);
		expect(removeSource(layout, 'missing')).toBe(layout);
		expect(moveSourceOrder(layout, 'missing', 1)).toBe(layout);
	});

	it('orders Source Items back to front by list order', () => {
		const layout = layoutOf([source(), source({ id: 's2' }), source({ id: 's3' })]);

		expect(sendSourceToBack(layout, 's3').sources.map(item => item.id)).toEqual(['s3', 's1', 's2']);
		expect(bringSourceToFront(layout, 's1').sources.map(item => item.id)).toEqual(['s2', 's3', 's1']);
		expect(moveSourceOrder(layout, 's1', 1).sources.map(item => item.id)).toEqual(['s2', 's1', 's3']);
	});

	it('does not reorder past either end', () => {
		const layout = layoutOf([source(), source({ id: 's2' })]);

		expect(moveSourceOrder(layout, 's1', -1)).toBe(layout);
		expect(moveSourceOrder(layout, 's2', 1)).toBe(layout);
	});

	it('creates a Source Item that cuts through the Frame by default', () => {
		const layout = layoutOf([]);

		const { layout: next, id } = createSourceItem(layout);

		expect(next.sources).toHaveLength(1);
		expect(next.sources[0]).toMatchObject({ id, frameCutout: true, sourceRole: 'main' });
	});

	it('removes a Source Item by id', () => {
		const layout = layoutOf([source(), source({ id: 's2' })]);

		expect(removeSource(layout, 's1').sources.map(item => item.id)).toEqual(['s2']);
	});

	it('duplicates a Source Item in front of itself, offset and uniquely named', () => {
		const layout = layoutOf([source(), source({ id: 's2', label: 'Other' })]);

		const { layout: next, id } = duplicateSource(layout, 's1');

		expect(next.sources.map(item => item.id)).toEqual(['s1', id, 's2']);
		expect(next.sources[1]).toMatchObject({ label: 'Source copy', x: 120, y: 70, width: 200, height: 100, sourceRole: 'main' });
		expect(id).not.toBe('s1');

		const again = duplicateSource(next, 's1');
		expect(again.layout.sources[1]!.label).toBe('Source copy 2');
	});

	it('duplicates nothing for an unknown Source Item', () => {
		const layout = layoutOf([source()]);

		expect(duplicateSource(layout, 'missing')).toEqual({ layout, id: '' });
	});
});
