import type { ThemeColor, ThemeFill } from '~~/shared/modules/theme';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';

/**
 * A colour inside a composite token, as the shared graphics fields edit it: one
 * string. A literal is itself; a colour Foundation Token it names is
 * `token:<name>`, which no CSS colour can be. The fields' rules (two to four
 * gradient stops, keeping the colour across a kind change) never read the
 * colour, so they apply to either.
 */
const TOKEN_PREFIX = 'token:';

export function encodeThemeColor(color: ThemeColor): string {
	return typeof color === 'string'
		? color
		: `${TOKEN_PREFIX}${color.token}`;
}

export function decodeThemeColor(encoded: string): ThemeColor {
	return encoded.startsWith(TOKEN_PREFIX)
		? {
				token: encoded.slice(TOKEN_PREFIX.length),
			}
		: encoded;
}

export function encodeThemeFill(fill: ThemeFill): ThemeFill<string> {
	return fill.type === 'solid'
		? {
				type: 'solid',
				color: encodeThemeColor(fill.color),
			}
		: {
				...fill,
				stops: fill.stops.map(stop => ({
					...stop,
					color: encodeThemeColor(stop.color),
				})),
			};
}

export function decodeThemeFill(fill: ThemeFill<string>): ThemeFill {
	return fill.type === 'solid'
		? {
				type: 'solid',
				color: decodeThemeColor(fill.color),
			}
		: {
				...fill,
				stops: fill.stops.map(stop => ({
					...stop,
					color: decodeThemeColor(stop.color),
				})),
			};
}

/** The colour Foundation Tokens a composite's colour may follow, as picker items. */
export const THEME_COLOR_SOURCE_ITEMS = Object.entries(FOUNDATION_TOKENS)
	.filter(([, token]) => token.type === 'color')
	.map(([name, token]) => ({
		label: `Follow ${token.label}`,
		value: encodeThemeColor({ token: name }),
	}));

/** A composite colour as the editor states it. */
export function themeColorText(color: ThemeColor): string {
	if (typeof color === 'string')
		return color;
	const token = FOUNDATION_TOKENS[color.token as keyof typeof FOUNDATION_TOKENS];
	return token
		? token.label
		: color.token;
}
