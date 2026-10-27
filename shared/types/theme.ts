import type { StoredThemeTokens } from '../modules/theme/tokens';

/** A Theme in the installation's library, as its editor reads it. */
export interface ThemeResponse {
	id: string;
	name: string;
	/** Only the Theme Tokens it sets; every other token reads its default. */
	tokens: StoredThemeTokens;
	/** Advanced by every token write. */
	revision: number;
	createdAt: Date;
	updatedAt: Date;
}

export type ThemeSummary = Pick<ThemeResponse, 'id' | 'name' | 'createdAt' | 'updatedAt'>;

export interface ThemeListResponse {
	themes: ThemeSummary[];
}

/**
 * What a rendering needs of its Event's Theme to resolve its tokens: the stored
 * values, and the revision that orders a token write's announcement against a
 * read. An Event with no Theme carries none, and renders the Default Theme.
 */
export interface ScreenOutputTheme {
	id: string;
	revision: number;
	tokens: StoredThemeTokens;
}

/** Why a Theme delete was refused: Events use it. */
export const THEME_IN_USE = 'THEME_IN_USE';

/** The Events a refused Theme delete names. */
export interface ThemeInUseData {
	code: typeof THEME_IN_USE;
	events: { id: number; name: string }[];
}

/** Why a Theme Token write was refused. */
export const THEME_TOKEN_WRITE_REFUSALS = {
	'unknown-token': 'No Theme Token has this name',
	'invalid-value': 'The value is not one this Theme Token can hold',
} as const;

export type ThemeTokenWriteRefusal = keyof typeof THEME_TOKEN_WRITE_REFUSALS;
