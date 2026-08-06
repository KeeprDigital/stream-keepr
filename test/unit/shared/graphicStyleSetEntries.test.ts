import type { GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import { describe, expect, it } from 'vitest';
import {
	graphicStyleEntriesReferencing,
	graphicStyleEntryReferences,
	resolveGraphicStyleSet,
} from '~~/shared/modules/graphic-style-sets';
import { squareShapeGeometry } from '~~/shared/modules/graphics';

/**
 * Resolving a Graphic Style Set's entries.
 *
 * The operator-visible rule under test is the one that makes a Style Set worth
 * having: a palette entry stores one opaque colour, and every preset that uses a
 * colour *references* it. So changing one palette entry changes every preset that
 * reaches it — transitively — and a broken reference is found before anything can
 * publish, not when a template fails to render.
 */

function entry<T extends GraphicStyleSetEntry['kind']>(
	kind: T,
	id: string,
	value: Extract<GraphicStyleSetEntry, { kind: T }>['value'],
	name = id,
): GraphicStyleSetEntry {
	return { id, kind, name, schemaVersion: 1, value } as GraphicStyleSetEntry;
}

const brand = entry('palette', 'brand', { color: '#ff0044' });
const ink = entry('palette', 'ink', { color: '#101014' });

const heading = entry('typography', 'heading', {
	font: { kind: 'application', fontId: 'inter' },
	fontSize: 48,
	fontWeight: 700,
	fontStyle: 'normal',
	textTransform: 'uppercase',
	letterSpacing: 1,
	lineHeight: 1.1,
	colorEntryId: 'brand',
});

const panelFill = entry('fill', 'panel-fill', { type: 'solid', colorEntryId: 'ink' });

const panel = entry('surface-style', 'panel', {
	fillEntryId: 'panel-fill',
	fillOpacity: 0.9,
	outline: { colorEntryId: 'brand', width: 2 },
});

describe('graphicStyleEntryReferences', () => {
	it('names every entry a preset depends on, with the kind that reference demands', () => {
		expect(graphicStyleEntryReferences(heading))
			.toEqual([{ entryId: 'brand', requiredKind: 'palette' }]);
		expect(graphicStyleEntryReferences(panel)).toEqual([
			{ entryId: 'panel-fill', requiredKind: 'fill' },
			{ entryId: 'brand', requiredKind: 'palette' },
		]);
	});

	it('names every stop of a gradient Graphic Fill preset', () => {
		const gradient = entry('fill', 'sweep', {
			type: 'linear-gradient',
			angle: 90,
			stops: [
				{ colorEntryId: 'brand', position: 0, opacity: 1 },
				{ colorEntryId: 'ink', position: 1, opacity: 0 },
			],
		});

		expect(graphicStyleEntryReferences(gradient).map(reference => reference.entryId))
			.toEqual(['brand', 'ink']);
	});

	it('reports no references for the kinds that hold only values', () => {
		expect(graphicStyleEntryReferences(brand)).toEqual([]);
		expect(graphicStyleEntryReferences(entry('shape-geometry', 'square', squareShapeGeometry()))).toEqual([]);
		expect(graphicStyleEntryReferences(entry('animation-recipe', 'rise', {
			duration: 300,
			easing: 'ease-out',
			fade: { opacity: 0 },
		}))).toEqual([]);
	});
});

describe('resolveGraphicStyleSet', () => {
	it('resolves a palette-linked typography preset to a concrete colour', () => {
		const resolution = resolveGraphicStyleSet([brand, heading]);

		expect(resolution.issues).toEqual([]);
		expect(resolution.resolved.get('heading')).toEqual({
			kind: 'typography',
			value: {
				font: { kind: 'application', fontId: 'inter' },
				fontSize: 48,
				fontWeight: 700,
				fontStyle: 'normal',
				textTransform: 'uppercase',
				letterSpacing: 1,
				lineHeight: 1.1,
				color: '#ff0044',
			},
		});
	});

	it('carries a palette change through every preset that transitively reaches it', () => {
		const before = resolveGraphicStyleSet([brand, ink, panelFill, panel]);
		const after = resolveGraphicStyleSet([
			brand,
			entry('palette', 'ink', { color: '#000000' }),
			panelFill,
			panel,
		]);

		// The Graphic Surface Style preset never names `ink`; it names the Graphic Fill
		// preset that does. That indirection is exactly what a transitive dependency is.
		expect(before.resolved.get('panel')).toMatchObject({
			value: { fill: { type: 'solid', color: '#101014' } },
		});
		expect(after.resolved.get('panel')).toMatchObject({
			value: { fill: { type: 'solid', color: '#000000' } },
		});
	});

	it('resolves a Graphic Surface Style preset that references no Graphic Fill preset', () => {
		const outlineOnly = entry('surface-style', 'edge', {
			fillOpacity: 1,
			outline: { colorEntryId: 'brand', width: 4 },
		});

		const resolution = resolveGraphicStyleSet([brand, outlineOnly]);

		expect(resolution.issues).toEqual([]);
		// No fill at all, rather than a fill of nothing: the consuming property keeps
		// the one it already has, because a Graphic Surface Style always has a fill.
		expect(resolution.resolved.get('edge')).toEqual({
			kind: 'surface-style',
			value: { fillOpacity: 1, outline: { color: '#ff0044', width: 4 } },
		});
	});

	it('resolves a media treatment preset\'s clipping through a Shape Geometry preset', () => {
		const rounded = entry('shape-geometry', 'rounded', {
			...squareShapeGeometry(),
			topLeft: { treatment: 'rounded', size: 12 },
		});
		const treatment = entry('media-treatment', 'portrait', {
			fit: 'cover',
			focalPosition: { horizontal: 0.5, vertical: 0.25 },
			opacity: 1,
			clipGeometryEntryId: 'rounded',
		});

		const resolution = resolveGraphicStyleSet([rounded, treatment]);

		expect(resolution.resolved.get('portrait')).toMatchObject({
			kind: 'media-treatment',
			value: { clipGeometry: { topLeft: { treatment: 'rounded', size: 12 } } },
		});
	});

	it('gives an animation preset a delay of zero when its author set none', () => {
		const resolution = resolveGraphicStyleSet([entry('animation-recipe', 'rise', {
			duration: 300,
			easing: 'ease-out',
			slide: { direction: 'north', distanceMode: 'fixed', distance: 40 },
		})]);

		expect(resolution.resolved.get('rise')).toMatchObject({ value: { delay: 0 } });
	});

	it('reports a reference to an entry that does not exist', () => {
		const resolution = resolveGraphicStyleSet([heading]);

		expect(resolution.issues).toEqual([expect.objectContaining({
			code: 'entry-reference-missing',
			entryId: 'heading',
			referencedEntryId: 'brand',
		})]);
		expect(resolution.resolved.has('heading')).toBe(false);
	});

	it('reports a reference to an entry of the wrong kind', () => {
		const resolution = resolveGraphicStyleSet([
			entry('shape-geometry', 'brand', squareShapeGeometry()),
			heading,
		]);

		expect(resolution.issues).toEqual([expect.objectContaining({
			code: 'entry-reference-kind-mismatch',
			entryId: 'heading',
			referencedEntryId: 'brand',
		})]);
	});

	it('refuses a reference that would close a cycle before the cycle can form', () => {
		// A cycle is unreachable in the current vocabulary, and this is why: every
		// reference demands a *different* kind, and those kinds form a strict layering.
		// Two Graphic Fill presets pointed at each other are the closest an author can
		// get, and each one is refused for naming the wrong kind rather than for
		// looping. Resolution still carries the cycle guard, because that layering is a
		// property of today's kinds and a `.skstyle` package (#76) will one day carry
		// entries this build did not author.
		function circularFill(id: string, colorEntryId: string): GraphicStyleSetEntry {
			return {
				id,
				kind: 'fill',
				name: id,
				schemaVersion: 1,
				value: { type: 'solid', colorEntryId },
			} as GraphicStyleSetEntry;
		}

		const resolution = resolveGraphicStyleSet([
			circularFill('left', 'right'),
			circularFill('right', 'left'),
		]);

		expect(resolution.resolved.size).toBe(0);
		expect(resolution.issues.map(issue => issue.code))
			.toEqual(['entry-reference-kind-mismatch', 'entry-reference-kind-mismatch']);
	});

	it('keeps the entry-kind reference graph acyclic, which is what makes a cycle unauthorable', () => {
		// The guard above only holds while no kind may reference its own kind, directly
		// or through others. That is the invariant, so it is asserted rather than left
		// as a fact someone would have to notice they were breaking.
		const maximal: GraphicStyleSetEntry[] = [
			brand,
			heading,
			entry('fill', 'gradient', {
				type: 'linear-gradient',
				angle: 0,
				stops: [
					{ colorEntryId: 'brand', position: 0, opacity: 1 },
					{ colorEntryId: 'brand', position: 1, opacity: 1 },
				],
			}),
			panel,
			entry('media-treatment', 'treatment', {
				fit: 'cover',
				focalPosition: { horizontal: 0.5, vertical: 0.5 },
				opacity: 1,
				clipGeometryEntryId: 'square',
			}),
			entry('shape-geometry', 'square', squareShapeGeometry()),
			entry('animation-recipe', 'rise', { duration: 300, easing: 'linear' }),
		];

		const edges = new Map(maximal.map(source => [
			source.kind,
			new Set(graphicStyleEntryReferences(source).map(reference => reference.requiredKind)),
		]));

		const settled = new Set<string>();
		const visiting = new Set<string>();
		function walk(kind: string) {
			expect(visiting.has(kind)).toBe(false);
			if (settled.has(kind))
				return;
			visiting.add(kind);
			for (const next of edges.get(kind as GraphicStyleSetEntry['kind']) ?? [])
				walk(next);
			visiting.delete(kind);
			settled.add(kind);
		}
		for (const kind of edges.keys())
			walk(kind);

		expect(settled.size).toBe(edges.size);
	});

	it('refuses an entry stored in a schema version this build does not read', () => {
		const resolution = resolveGraphicStyleSet([{ ...brand, schemaVersion: 2 }]);

		expect(resolution.issues).toEqual([expect.objectContaining({
			code: 'entry-schema-unsupported',
			entryId: 'brand',
		})]);
	});

	it('refuses a typography preset naming a font this installation does not have', () => {
		const resolution = resolveGraphicStyleSet([
			brand,
			{ ...heading, value: { ...heading.value, font: { kind: 'application', fontId: 'not-a-font' } } } as unknown as GraphicStyleSetEntry,
		]);

		expect(resolution.issues).toEqual([expect.objectContaining({
			code: 'entry-font-unavailable',
			entryId: 'heading',
		})]);
	});

	it('resolves every sound entry even while another is broken', () => {
		// An editor showing a half-built palette must still show the colours that are
		// defined, and a detach must still freeze every value it can reach.
		const resolution = resolveGraphicStyleSet([brand, ink, heading, panel]);

		expect(resolution.resolved.get('brand')).toEqual({ kind: 'palette', value: '#ff0044' });
		expect(resolution.resolved.get('heading')).toBeDefined();
		// `panel` references a Graphic Fill preset that is not in this set.
		expect(resolution.resolved.has('panel')).toBe(false);
		expect(resolution.issues).toHaveLength(1);
	});

	it('does not resolve an entry whose transitive dependency is broken', () => {
		const resolution = resolveGraphicStyleSet([panelFill, panel]);

		// `panel` itself is well formed. It fails because the Graphic Fill preset it
		// names could not resolve its own palette reference.
		expect(resolution.resolved.has('panel-fill')).toBe(false);
		expect(resolution.resolved.has('panel')).toBe(false);
	});
});

describe('graphicStyleEntriesReferencing', () => {
	it('names the entries that would break if one entry disappeared', () => {
		const entries = [brand, ink, heading, panelFill, panel];

		expect(graphicStyleEntriesReferencing(entries, 'brand').map(found => found.id))
			.toEqual(['heading', 'panel']);
		expect(graphicStyleEntriesReferencing(entries, 'panel-fill').map(found => found.id))
			.toEqual(['panel']);
		expect(graphicStyleEntriesReferencing(entries, 'panel')).toEqual([]);
	});
});
