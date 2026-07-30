import { describe, expect, it } from 'vitest';
import {
	modeConfigPatchSchemaMap,
	modeConfigSchemaMap,
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

const SQUARE = { treatment: 'square' as const, size: 0 };
const GEOMETRY = {
	topLeft: SQUARE,
	topRight: SQUARE,
	bottomRight: SQUARE,
	bottomLeft: SQUARE,
	leftSlant: 0,
	rightSlant: 0,
};

function fatGraphicItem(id: string) {
	return {
		type: 'text' as const,
		id,
		label: 'L'.repeat(100),
		visible: true,
		anchor: 'bottom-right' as const,
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		text: 'T'.repeat(1000),
		typography: {
			fontId: 'inter' as const,
			fontSize: 64,
			fontWeight: 700,
			fontStyle: 'normal' as const,
			textTransform: 'none' as const,
			letterSpacing: 0,
			lineHeight: 1.15,
			textAlign: 'left' as const,
			color: '#ffffff',
		},
		overflowPolicy: 'ellipsis' as const,
		minFontSize: 24,
		surfaceStyle: {
			fill: {
				type: 'linear-gradient' as const,
				angle: 90,
				stops: Array.from({ length: 4 }, (_, index) => ({
					color: '#0077a3',
					position: index / 3,
					opacity: 0.85,
				})),
			},
			fillOpacity: 1,
			outline: { color: '#ffffff', width: 4 },
			glow: { color: '#00d9ff', size: 24, opacity: 0.8 },
		},
	};
}

function graphicsStack(totalItems: number, graphics: number) {
	const perGraphic = totalItems / graphics;
	return Array.from({ length: graphics }, (_, g) => ({
		id: `graphic-${g}`,
		name: 'N'.repeat(100),
		items: Array.from({ length: perGraphic }, (_, i) => fatGraphicItem(`item-${g}-${i}`)),
	}));
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
		const stored = { 'broadcast-graphics': { graphics: graphicsStack(200, 50) } };

		expect(bytes(stored)).toBeLessThan(MAX_MODE_CONFIGS_BYTES);

		expect(() => parseModeConfigPatchResult(stored, 'feature-match-overlay', { layout: fatOverlayLayout() }))
			.toThrow(/Mode configuration must not exceed/);
	});

	it('names the limit, so an operator reads what they reached', () => {
		const stored = { 'broadcast-graphics': { graphics: graphicsStack(200, 50) } };

		expect(() => parseModeConfigPatchResult(stored, 'feature-match-overlay', { layout: fatOverlayLayout() }))
			.toThrow(new RegExp(`must not exceed ${MAX_MODE_CONFIGS_BYTES} bytes`));
	});

	it('enforces the same rule the full-config write path enforces', () => {
		// The pairing that makes this a parity statement rather than a byte assertion:
		// one payload, both paths, same answer. Before #85 was fixed the second of
		// these accepted what the first refused.
		const oversized = {
			'broadcast-graphics': { graphics: graphicsStack(200, 50) },
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
			{ graphics: graphicsStack(20, 5) },
		);

		expect(bytes(merged)).toBeLessThan(MAX_MODE_CONFIGS_BYTES / 4);
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
	it('keeps every per-mode schema free of object-level checks', () => {
		// The patch path can enforce rules on the *map* — it validates a merged result
		// — but not rules on one mode's own object, because the stored configuration
		// such a rule would judge is legitimately partial. So a per-mode object-level
		// check is unenforceable here, and the schema module refuses to load with one
		// rather than dropping it silently, which is the defect #85 reports.
		//
		// This asserts the same property that guard checks, so the reason is visible in
		// a test rather than only in a module-load throw. Every current cross-field
		// constraint deliberately lives on an array field, which survives the patch
		// derivation — the Graphic Item caps are the worked example.
		for (const [mode, schema] of Object.entries(modeConfigSchemaMap)) {
			const checks = (schema as unknown as { _zod?: { def?: { checks?: unknown[] } } })
				._zod?.def?.checks ?? [];

			expect(checks, `${mode} carries an object-level check the PATCH path cannot enforce`)
				.toHaveLength(0);
		}
	});

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
