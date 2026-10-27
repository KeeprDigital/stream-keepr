import type { DbTheme } from '~~/server/db/schema';
import type { ScreenOutputTheme, ThemeResponse, ThemeSummary } from '~~/shared/types/theme';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapThemeToResponse(theme: DbTheme): ThemeResponse {
	return mapTimestamps({
		id: theme.id,
		name: theme.name,
		tokens: theme.tokens,
		revision: theme.revision,
		createdAt: theme.createdAt,
		updatedAt: theme.updatedAt,
	});
}

export function mapThemeToSummary(theme: DbTheme): ThemeSummary {
	return mapTimestamps({
		id: theme.id,
		name: theme.name,
		createdAt: theme.createdAt,
		updatedAt: theme.updatedAt,
	});
}

/** What a rendering holds of its Event's Theme. */
export function mapThemeToScreenOutput(theme: DbTheme): ScreenOutputTheme {
	return {
		id: theme.id,
		revision: theme.revision,
		tokens: theme.tokens,
	};
}
