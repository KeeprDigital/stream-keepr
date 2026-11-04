import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ScreenMode } from '~~/shared/types/enums';
import { placeScreenThemeTokens } from '~~/shared/screenThemeOverrides';

// The one line a closed Screen settings card shows in place of its body
// (`ScreenSettingsCard`'s `summary`, ADR-0071).

/** What the Header card's header shows: hidden, the mode's own title, or the custom text. */
export function headerSummary(config: { showHeader: boolean; headerText?: string | null }): string {
	if (!config.showHeader)
		return 'Hidden';
	return config.headerText
		? `“${config.headerText}”`
		: 'Auto title';
}

/** A Page Rotation's page size, and whether it pages itself and how often (ADR-0039). */
export function paginationSummary(rotation: { pageSize: number; autoPageEnabled: boolean; autoPageIntervalMs: number }): string {
	const paging = rotation.autoPageEnabled
		? `Auto-page every ${rotation.autoPageIntervalMs / 1000} s`
		: 'Manual paging';
	return `${rotation.pageSize} per page · ${paging}`;
}

/**
 * How many of a Screen's Theme Overrides (`themeOverrides`) the Looks of a
 * `mode`'s `groups` hold, or `null` while every token there follows the Theme.
 */
export function lookSummary(mode: ScreenMode, themeOverrides: StoredThemeTokens | null | undefined, groups: readonly string[]): string | null {
	const placed = placeScreenThemeTokens(mode, groups).groups;
	const overrides = themeOverrides ?? {};
	const count = groups
		.flatMap(group => placed[group] ?? [])
		.filter(name => overrides[name] !== undefined)
		.length;
	if (count === 0)
		return null;
	return count === 1
		? '1 Look override'
		: `${count} Look overrides`;
}

/** A card's summary parts on one line, or `fallback` when it has none. */
export function settingsSummary(parts: Array<string | null | undefined | false>, fallback = ''): string {
	const present = parts.filter((part): part is string => Boolean(part));
	return present.length > 0
		? present.join(' · ')
		: fallback;
}
