import { describe, expect, it } from 'vitest';
import { borderGlowFieldsValue, borderGlowStyleUpdates } from '~~/app/modules/feature-match-overlay/borderGlow';

/**
 * How the Frame and a Source Item's framing, which store a flat per-side border
 * and glow, meet the shared border and glow fields: what the fields show is what
 * the Feature Match Overlay renderer paints, and each edit becomes the flat
 * fields it changes.
 */

describe('feature match overlay border and glow', () => {
	it('shows no border unless it is switched on, so an unset one reads as off', () => {
		expect(borderGlowFieldsValue({}).border).toBeNull();
		expect(borderGlowFieldsValue({ borderVisible: false, borderWidth: 4 }).border).toBeNull();
	});

	it('shows the width and colour the renderer paints when none is stored', () => {
		expect(borderGlowFieldsValue({ borderVisible: true }).border).toEqual({ color: undefined, width: 1, sides: {} });
		expect(borderGlowFieldsValue({ borderVisible: true }, '#ffffff').border?.color).toBe('#ffffff');
		expect(borderGlowFieldsValue({
			borderVisible: true,
			borderColor: '#0077a3',
			borderWidth: 4,
			borderTopVisible: false,
		}, '#ffffff').border)
			.toEqual({
				color: '#0077a3',
				width: 4,
				sides: { top: false },
			});
	});

	it('shows a glow only while it has a size, in the border colour unless it has its own', () => {
		expect(borderGlowFieldsValue({ borderVisible: true, glowSize: 0 }).glow).toBeNull();
		expect(borderGlowFieldsValue({ borderVisible: true, borderColor: '#0077a3', glowSize: 7 }).glow)
			.toEqual({
				color: '#0077a3',
				size: 7,
				opacity: 0.75,
				position: undefined,
			});
		expect(borderGlowFieldsValue({
			glowSize: 7,
			glowColor: '#ff0000',
			glowOpacity: 0.5,
			glowPosition: 'inside',
		}).glow)
			.toEqual({
				color: '#ff0000',
				size: 7,
				opacity: 0.5,
				position: 'inside',
			});
		expect(borderGlowFieldsValue({ glowSize: 7 }).glow?.color).toBe('#ffffff');
	});

	it('switches the border with its visibility, keeping its colour and width', () => {
		expect(borderGlowStyleUpdates({ kind: 'border', patch: {} })).toEqual({ borderVisible: true });
		expect(borderGlowStyleUpdates({ kind: 'border', patch: null })).toEqual({ borderVisible: false });
	});

	it('switches the glow on at a default size and off at size zero', () => {
		expect(borderGlowStyleUpdates({ kind: 'glow', patch: {} })).toEqual({ glowSize: 8 });
		expect(borderGlowStyleUpdates({ kind: 'glow', patch: null })).toEqual({ glowSize: 0 });
	});

	it('keeps a glow whose size is typed down to nothing, so only the switch turns it off', () => {
		expect(borderGlowStyleUpdates({
			kind: 'glow',
			patch: { size: 0 },
		})).toEqual({ glowSize: 1 });
	});

	it('writes each value edit to its flat field', () => {
		expect(borderGlowStyleUpdates({
			kind: 'border',
			patch: { color: '#123456' },
		})).toEqual({ borderColor: '#123456' });
		expect(borderGlowStyleUpdates({
			kind: 'border',
			patch: { width: 6 },
		})).toEqual({ borderWidth: 6 });
		expect(borderGlowStyleUpdates({ kind: 'border-side', side: 'left', visible: false }))
			.toEqual({ borderLeftVisible: false });
		expect(borderGlowStyleUpdates({
			kind: 'glow',
			patch: { color: undefined },
		})).toStrictEqual({ glowColor: undefined });
		expect(borderGlowStyleUpdates({
			kind: 'glow',
			patch: { size: 12 },
		})).toEqual({ glowSize: 12 });
		expect(borderGlowStyleUpdates({
			kind: 'glow',
			patch: { opacity: 0.4 },
		})).toEqual({ glowOpacity: 0.4 });
		expect(borderGlowStyleUpdates({
			kind: 'glow',
			patch: { position: 'outside' },
		})).toEqual({ glowPosition: 'outside' });
	});
});
