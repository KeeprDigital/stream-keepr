import type { PageRotationControls } from '~/modules/screen-mode/rotationWrites';

// The one line a closed Screen settings card shows in place of its body
// (`ScreenSettingsSection`'s `summary`, ADR-0072).

/** What the Header card's header shows: hidden, the mode's own title, or the custom text. */
export function headerSummary(config: { showHeader: boolean; headerText?: string | null }): string {
	if (!config.showHeader)
		return 'Hidden';
	return config.headerText
		? `“${config.headerText}”`
		: 'Auto title';
}

/** What a card holding only a Look shows while every token there follows the Theme. */
export const FOLLOWS_THE_THEME = 'Follows the Theme';

/** A Page Rotation's page size, and whether it pages itself and how often (ADR-0039). */
export function paginationSummary(rotation: Pick<PageRotationControls, 'pageSize' | 'rotationConfig'>): string {
	const { autoPageEnabled, autoPageIntervalMs } = rotation.rotationConfig.value;
	const paging = autoPageEnabled
		? `Auto-page every ${autoPageIntervalMs / 1000} s`
		: 'Manual paging';
	const pageSize = rotation.pageSize.value;
	return `${pageSize === undefined
		? 'One page'
		: `${pageSize} per page`} · ${paging}`;
}

/** A card's summary parts on one line, or `fallback` when it has none. */
export function settingsSummary(parts: Array<string | null | undefined | false>, fallback = ''): string {
	const present = parts.filter((part): part is string => Boolean(part));
	return present.length > 0
		? present.join(' · ')
		: fallback;
}
