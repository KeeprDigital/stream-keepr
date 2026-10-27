/** A colour as the Theme editor edits it: an opaque `#rrggbb` and its alpha. */
export interface EditableColor {
	hex: string;
	/** 0 (clear) to 1 (opaque). */
	alpha: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i;

function channel(value: number): string {
	return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

function roundAlpha(alpha: number): number {
	return Math.round(Math.max(0, Math.min(1, alpha)) * 100) / 100;
}

/** A stored colour the editor can take apart, or null for one it can show only as text. */
export function parseEditableColor(css: string): EditableColor | null {
	const value = css.trim();
	const hex = HEX.exec(value)?.[1];
	if (hex) {
		const full = hex.length === 3
			? [...hex].map(digit => digit + digit).join('')
			: hex;
		return {
			hex: `#${full.slice(0, 6).toLowerCase()}`,
			alpha: full.length === 8
				? roundAlpha(Number.parseInt(full.slice(6), 16) / 255)
				: 1,
		};
	}
	const rgb = RGB.exec(value);
	if (rgb) {
		const [, r, g, b, a] = rgb;
		return {
			hex: `#${channel(Number(r))}${channel(Number(g))}${channel(Number(b))}`,
			alpha: a === undefined
				? 1
				: roundAlpha(Number(a)),
		};
	}
	return null;
}

/** The CSS colour a Theme stores: hex when opaque, `rgba()` when translucent. */
export function formatEditableColor({ hex, alpha }: EditableColor): string {
	const opacity = roundAlpha(alpha);
	if (opacity >= 1)
		return hex.toLowerCase();
	const [r, g, b] = [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16));
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
