import type { QuantityPosition } from '~~/shared/types/enums';
import type { GraphicAnchorPoint, GraphicAnimationOrigin } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayAnchorValue } from '~~/shared/types/screenConfig';
import type { NinePoint } from '~~/shared/utils/ninePoints';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { QUANTITY_POSITION_VALUES } from '~~/shared/types/enums';
import { GRAPHIC_ANCHOR_POINT_VALUES, GRAPHIC_ANIMATION_ORIGIN_VALUES } from '~~/shared/types/graphics';
import { FEATURE_MATCH_OVERLAY_ANCHOR_VALUES } from '~~/shared/types/screenConfig';
import { NINE_POINT_VALUES, NINE_POINTS, ninePointPlacement } from '~~/shared/utils/ninePoints';

describe('nine points', () => {
	it('lays the table out in reading order across a 3×3 grid', () => {
		expect(NINE_POINTS.map(point => point.value)).toEqual([...NINE_POINT_VALUES]);
		expect(NINE_POINTS.map(point => [point.x, point.y])).toEqual([
			[0, 0],
			[0.5, 0],
			[1, 0],
			[0, 0.5],
			[0.5, 0.5],
			[1, 0.5],
			[0, 1],
			[0.5, 1],
			[1, 1],
		]);
	});

	it('is spelled exactly like every vocabulary that shares its table and control', () => {
		// Each vocabulary is its own domain concept, but its definitions are a view
		// of `NINE_POINTS`: a value one gained that the table lacks would silently
		// resolve to the first point. Checked by `pnpm typecheck` and at runtime.
		expectTypeOf<GraphicAnchorPoint>().toEqualTypeOf<NinePoint>();
		expectTypeOf<GraphicAnimationOrigin>().toEqualTypeOf<NinePoint>();
		expectTypeOf<FeatureMatchOverlayAnchorValue>().toEqualTypeOf<NinePoint>();
		for (const values of [GRAPHIC_ANCHOR_POINT_VALUES, GRAPHIC_ANIMATION_ORIGIN_VALUES, FEATURE_MATCH_OVERLAY_ANCHOR_VALUES])
			expect([...values]).toEqual([...NINE_POINT_VALUES]);
	});

	it('spells the Deck badge positions as the nine points less the centre (#543)', () => {
		// A badge on the centre would cover the card's art, so the picker disables
		// that point rather than this vocabulary inventing its own spelling.
		expectTypeOf<QuantityPosition>().toEqualTypeOf<Exclude<NinePoint, 'center'>>();
		expect([...QUANTITY_POSITION_VALUES]).toEqual(NINE_POINT_VALUES.filter(point => point !== 'center'));
	});
});

describe('ninePointPlacement', () => {
	// A point places a box at its side of each axis, or the middle.
	it.each([
		{ point: 'top-left', x: 'start', y: 'start' },
		{ point: 'center', x: 'center', y: 'center' },
		{ point: 'bottom', x: 'center', y: 'end' },
		{ point: 'right', x: 'end', y: 'center' },
	] as const)('places $point at $x across and $y down', ({ point, x, y }) => {
		expect(ninePointPlacement(point)).toEqual({ x, y });
	});
});
