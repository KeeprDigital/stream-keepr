import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	modeConfigPatchSchemaMap,
	modeConfigSchemaMap,
	modeConfigSchemasWithObjectLevelChecks,
	modeConfigsMapSchema,
	parseModeConfigPatchResult,
} from '~~/server/schemas/api/screen';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';

/**
 * The mode-configuration byte total, enforced on both write paths.
 *
 * `MAX_MODE_CONFIGS_BYTES` is the only object-level rule the Screen schemas carry,
 * and it was the exact victim of #85: the patch schema is rebuilt from the full
 * schema's shape, which silently dropped it, so the total held on Screen create and
 * full update and not on the path the editors write through.
 */
const MAX_MODE_CONFIGS_BYTES = 512 * 1024;

/**
 * The most expensive Graphic Item the current vocabulary accepts: a maximal Graphic
 * Text Template, a four-stop gradient, an outline, a glow, and the four Graphic
 * Placeholder Styles a Text Graphic Item may define.
 */
function fatGraphicItem(id: string) {
	return {
		type: 'text' as const,
		id,
		label: 'L'.repeat(100),
		visible: true,
		anchor: 'bottom-right' as const,
		rotation: -359.99,
		x: -9999.5,
		y: -9999.5,
		width: 9999.5,
		height: 9999.5,
		text: 'T'.repeat(1000),
		typography: {
			font: { kind: 'application', fontId: 'inter' } as const,
			fontSize: 599.5,
			fontWeight: 900,
			fontStyle: 'italic' as const,
			textTransform: 'uppercase' as const,
			letterSpacing: -19.5,
			lineHeight: 1.15,
			textAlign: 'center' as const,
			color: '#0077a3',
		},
		overflowPolicy: 'shrink' as const,
		minFontSize: 24.5,
		surfaceStyle: {
			fill: {
				type: 'linear-gradient' as const,
				angle: -359.99,
				stops: Array.from({ length: 4 }, (_, index) => ({
					color: '#0077a3',
					position: index / 3,
					opacity: 0.85,
				})),
			},
			fillOpacity: 0.85,
			outline: { color: '#ffffff', width: 12.5 },
			glow: { color: '#00d9ff', size: 48.5, opacity: 0.75 },
		},
		placeholderStyles: Object.fromEntries(
			Array.from({ length: 4 }, (_, index) => [
				`placeholder${index}`,
				{
					font: { kind: 'application', fontId: 'inter' } as const,
					fontSize: 599.5,
					fontWeight: 900,
					fontStyle: 'italic' as const,
					textTransform: 'uppercase' as const,
					letterSpacing: -19.5,
					color: '#0077a3',
				},
			]),
		),
	};
}

/**
 * A Graphic Input declaration at its own maxima. Inputs carry the other large axis
 * of the whole-Screen budget, and are capped per Screen rather than per graphic.
 */
function fatGraphicInput(key: string) {
	return {
		key,
		label: 'L'.repeat(60),
		required: true,
		updatePolicy: 'staged' as const,
		type: 'text' as const,
		default: 'D'.repeat(1000),
		maxLength: 1000,
	};
}

/**
 * A Broadcast Graphics stack built to the current named caps rather than to a byte
 * figure, so it stays the pathological case as the vocabulary changes: the Graphic
 * Item axis and the whole-Screen Graphic Input budget are both filled to their limits.
 */
function graphicsStack(totalItems: number, graphics: number, totalInputs = 0) {
	const perGraphic = Math.ceil(totalItems / graphics);
	const perGraphicInputs = Math.ceil(totalInputs / graphics);
	let items = 0;
	let inputs = 0;

	return Array.from({ length: graphics }, (_, g) => {
		const take = Math.max(0, Math.min(perGraphic, totalItems - items));
		const takeInputs = Math.max(0, Math.min(perGraphicInputs, totalInputs - inputs));
		items += take;
		inputs += takeInputs;

		return {
			id: `graphic-${g}`,
			name: 'N'.repeat(100),
			items: Array.from({ length: take }, (_, i) => fatGraphicItem(`item-${g}-${i}`)),
			...(takeInputs > 0
				? { inputs: Array.from({ length: takeInputs }, (_, i) => fatGraphicInput(`g${g}input${i}`)) }
				: {}),
		};
	});
}

/** A ~129 KiB Feature Match Overlay layout whose every field is within its own bound. */
function fatOverlayLayout() {
	const gradient = 'G'.repeat(1000);
	return {
		frame: { backgroundColor: '#000000', opacity: 1, gradient },
		items: Array.from({ length: 100 }, (_, index) => ({
			id: `overlay-${index}`,
			type: 'source' as const,
			label: 'L'.repeat(100),
			visible: true,
			sourceRole: 'main' as const,
			frameCutout: true,
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			surfaceStyle: {
				backgroundColor: '#000000',
				backgroundOpacity: 0,
				backgroundGradient: gradient,
				borderVisible: true,
				borderTopVisible: true,
				borderRightVisible: true,
				borderBottomVisible: true,
				borderLeftVisible: true,
				borderColor: '#0077a3',
				borderWidth: 4,
				borderRadius: 8,
				borderRadiusTopLeft: 8,
				borderRadiusTopRight: 8,
				borderRadiusBottomRight: 8,
				borderRadiusBottomLeft: 8,
				padding: 12,
				textColor: '#ffffff',
				fontSize: 32,
			},
		})),
	};
}

function bytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

describe('parseModeConfigPatchResult', () => {
	it('refuses a patch whose merged result exceeds the mode configuration byte total', () => {
		// Neither write is unreasonable on its own; the accumulated configuration is
		// what breaches the limit, which is why only the merged result can catch it.
		const stored = { 'broadcast-graphics': { graphics: graphicsStack(110, 50, 60) } };
		const layout = fatOverlayLayout();

		// Both halves measured, so it stays visible that neither alone is the problem
		// and that the fixtures still straddle the limit if a vocabulary grows.
		// Both halves measured, so it stays visible that neither alone is the problem.
		//
		// Worth knowing if this fails: with both modes built to their named caps, the
		// largest reachable two-mode configuration is 544,846 bytes against a 524,288
		// limit — it clears the total by 3.9%. A vocabulary change that made either
		// half cheaper could drop the pathological case *under* the limit and leave
		// nothing for this test to catch. It fails here rather than passing vacuously,
		// which is the whole point of measuring instead of asserting a round envelope.
		//
		// It cleared by 0.8% until a Graphic Font Selection replaced a bare `fontId`
		// (#141). Naming a Graphics Asset Library font takes a tagged union, and its
		// application arm spells the same choice at 46 bytes instead of 16 — 30 bytes
		// on every typography and every Graphic Placeholder Style, 150 on a maximal
		// Text Graphic Item carrying four of them.
		expect(bytes(stored)).toBeGreaterThan(373_000);
		expect(bytes(stored)).toBeLessThan(383_000);
		expect(bytes({ layout })).toBeGreaterThan(165_000);
		expect(bytes({ layout })).toBeLessThan(170_000);
		expect(bytes(stored) + bytes({ layout })).toBeGreaterThan(MAX_MODE_CONFIGS_BYTES);

		expect(() => parseModeConfigPatchResult(stored, 'feature-match-overlay', { layout }))
			.toThrow(/Mode configuration must not exceed/);
	});

	it('names the limit, so an operator reads what they reached', () => {
		const stored = { 'broadcast-graphics': { graphics: graphicsStack(110, 50, 60) } };

		expect(() => parseModeConfigPatchResult(stored, 'feature-match-overlay', { layout: fatOverlayLayout() }))
			.toThrow(new RegExp(`must not exceed ${MAX_MODE_CONFIGS_BYTES} bytes`));
	});

	it('enforces the same rule the full-config write path enforces', () => {
		// The pairing that makes this a parity statement rather than a byte assertion:
		// one payload, both paths, same answer. Before #85 was fixed the second of
		// these accepted what the first refused.
		const oversized = {
			'broadcast-graphics': { graphics: graphicsStack(110, 50, 60) },
			'feature-match-overlay': {
				featureMatchId: null,
				presetId: 'full-table' as const,
				layout: fatOverlayLayout(),
			},
		};

		expect(bytes(oversized)).toBeGreaterThan(MAX_MODE_CONFIGS_BYTES);
		expect(modeConfigsMapSchema.safeParse(oversized).success).toBe(false);
		expect(() => parseModeConfigPatchResult(
			{ 'broadcast-graphics': oversized['broadcast-graphics'] },
			'feature-match-overlay',
			oversized['feature-match-overlay'],
		)).toThrow(/Mode configuration must not exceed/);
	});

	it('accepts a realistic configuration, which is nowhere near the limit', () => {
		const merged = parseModeConfigPatchResult(
			{ metagame: getDefaultConfigForMode('metagame') },
			'broadcast-graphics',
			{ graphics: graphicsStack(20, 5, 6) },
		);

		// A measured figure with a stated margin, not a round envelope. A loose
		// assertion here is exactly what let two tickets each believe they had
		// measured the shared budget: anything under a generous ceiling passed, so a
		// vocabulary that grew the per-item cost never showed up.
		expect(bytes(merged)).toBeGreaterThan(61_000);
		expect(bytes(merged)).toBeLessThan(65_000);
		expect(merged['broadcast-graphics']).toBeDefined();
		// Other modes are carried through untouched.
		expect(merged.metagame).toEqual(getDefaultConfigForMode('metagame'));
	});

	it('accepts a partial mode configuration, because storage holds fragments', () => {
		// A PATCH writes a fragment and readers complete it from the mode's defaults,
		// so a stored config with required fields absent is entirely valid. Re-checking
		// each mode against its full schema here would reject ordinary editing — this
		// pins that it does not.
		const patch = { layout: { frame: { backgroundColor: '#000000', opacity: 1 }, items: [] } };

		expect(modeConfigSchemaMap['feature-match-overlay'].safeParse(patch).success).toBe(false);
		expect(() => parseModeConfigPatchResult({}, 'feature-match-overlay', patch)).not.toThrow();
	});

	it('starts from an empty map when a Screen has no stored mode configuration', () => {
		for (const stored of [null, undefined, {}]) {
			const merged = parseModeConfigPatchResult(stored, 'metagame', { topN: 12 });
			expect(merged.metagame).toMatchObject({ topN: 12 });
		}
	});

	it('merges onto the stored configuration rather than replacing it', () => {
		const merged = parseModeConfigPatchResult(
			{ metagame: { topN: 5, autoPaging: true } as never },
			'metagame',
			{ topN: 12 },
		);

		expect(merged.metagame).toMatchObject({ topN: 12, autoPaging: true });
	});

	it('honours null as the delete-this-key sentinel, exactly as the write does', () => {
		// The merge is the shared one the repository uses, so validation cannot judge a
		// configuration different from the one that gets stored.
		const merged = parseModeConfigPatchResult(
			{ metagame: { topN: 5, archetypeFilter: 'aggro' } as never },
			'metagame',
			{ archetypeFilter: null },
		);

		expect(merged.metagame).toMatchObject({ topN: 5 });
		expect(Object.keys(merged.metagame!)).not.toContain('archetypeFilter');
	});
});

describe('object-level rules cannot be silently unenforced', () => {
	it('still derives a patch schema that enforces every field bound', () => {
		// The division of labour the fix relies on: fields here, whole-object rules in
		// `parseModeConfigPatchResult`. If field bounds stopped working, moving the
		// object rules would have bought nothing.
		const patch = modeConfigPatchSchemaMap['broadcast-graphics'];

		expect(patch.safeParse({ graphics: [{ id: 'a', name: 'A', items: [] }] }).success).toBe(true);
		expect(patch.safeParse({ graphics: [{ id: '', name: 'A', items: [] }] }).success).toBe(false);
		expect(patch.safeParse({ graphics: null }).success).toBe(false);
		expect(patch.safeParse({ unknownKey: 1 }).success).toBe(false);
	});
});

describe('the object-level check detector', () => {
	// The guard is only worth having if it catches the thing #85 reports, so this
	// runs the issue's own reproduction against the detector rather than asserting
	// only that today's schemas happen to be clean.
	const plain = z.object({ topN: z.number() }).strict();

	it('finds an object-level refinement, which is what the shape rebuild loses', () => {
		const refined = plain.refine(() => false, 'never valid');

		expect(modeConfigSchemasWithObjectLevelChecks({ metagame: refined })).toEqual(['metagame']);
		// The reason it was invisible: `.refine()` returns a ZodObject, so the schema
		// still has a `.shape` and the rebuild typechecks and reads as correct.
		expect(refined).toBeInstanceOf(z.ZodObject);
		expect(Object.keys(refined.shape)).toEqual(['topN']);
	});

	it('finds a superRefine and a whole-object check too, not just refine', () => {
		expect(modeConfigSchemasWithObjectLevelChecks({
			card: plain.superRefine(() => {}),
		})).toEqual(['card']);
	});

	it('names every offender, so one boot failure reports them all', () => {
		expect(modeConfigSchemasWithObjectLevelChecks({
			card: plain.refine(() => false),
			deck: plain,
			metagame: plain.refine(() => false),
		})).toEqual(['card', 'metagame']);
	});

	it('passes a schema whose constraints live on its fields', () => {
		// The pattern every current cross-field rule uses: an array-level check, which
		// survives the rebuild because field schemas are carried over intact.
		const fieldLevel = z.object({
			graphics: z.array(z.string()).refine(value => value.length < 3, 'too many'),
		}).strict();

		expect(modeConfigSchemasWithObjectLevelChecks({ 'broadcast-graphics': fieldLevel })).toEqual([]);
	});

	it('holds for every shipped mode config schema', () => {
		// The property the module-load guard enforces. If this fails, the schema module
		// refuses to load rather than silently dropping the rule — the failure #85 is
		// about becomes a boot error instead of a validation bypass.
		expect(modeConfigSchemasWithObjectLevelChecks(modeConfigSchemaMap)).toEqual([]);
	});
});
