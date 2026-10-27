import type { ThemeListResponse, ThemeResponse, ThemeSummary } from '~~/shared/types/theme';

/**
 * HTTP adapter for the installation's Theme library (ADR-0049). Only paths,
 * methods and shapes: a token write is per token, and answers the whole Theme.
 */
export function useThemeRepository() {
	const apiHeaders = useApiHeaders();
	const library = '/api/themes';
	const theme = (themeId: string) => `${library}/${encodeURIComponent(themeId)}`;
	const token = (themeId: string, name: string) => `${theme(themeId)}/tokens/${encodeURIComponent(name)}`;

	const list = async (): Promise<ThemeSummary[]> =>
		(await $fetch<ThemeListResponse>(library)).themes;

	const get = async (themeId: string): Promise<ThemeResponse> =>
		await $fetch<ThemeResponse>(theme(themeId));

	const create = async (name: string): Promise<ThemeResponse> =>
		await $fetch<ThemeResponse>(library, {
			method: 'POST',
			headers: apiHeaders.getHeaders(),
			body: { name },
		});

	const rename = async (themeId: string, name: string): Promise<ThemeResponse> =>
		await $fetch<ThemeResponse>(theme(themeId), {
			method: 'PATCH',
			headers: apiHeaders.getHeaders(),
			body: { name },
		});

	const remove = async (themeId: string): Promise<void> => {
		await $fetch(theme(themeId), {
			method: 'DELETE',
			headers: apiHeaders.getHeaders(),
		});
	};

	const setToken = async (themeId: string, name: string, value: unknown): Promise<ThemeResponse> =>
		await $fetch<ThemeResponse>(token(themeId, name), {
			method: 'PUT',
			headers: apiHeaders.getHeaders(),
			body: { value },
		});

	const clearToken = async (themeId: string, name: string): Promise<ThemeResponse> =>
		await $fetch<ThemeResponse>(token(themeId, name), {
			method: 'DELETE',
			headers: apiHeaders.getHeaders(),
		});

	return {
		list,
		get,
		create,
		rename,
		remove,
		setToken,
		clearToken,
	};
}
