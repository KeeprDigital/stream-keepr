import type { DbTheme } from '~~/server/db/schema';
import type { ThemeInUseData, ThemeListResponse, ThemeResponse } from '~~/shared/types/theme';
import { mapThemeToResponse, mapThemeToScreenOutput, mapThemeToSummary } from '~~/server/mappers/theme';
import { ThemeInUseError, themeService } from '~~/server/services/theme';
import { publishMessage } from '~~/server/utils/ably';
import { parseThemeTokenWrite } from '~~/shared/themeTokens';
import { THEME_IN_USE, THEME_TOKEN_WRITE_REFUSALS } from '~~/shared/types/theme';
import { randomUuid } from '~~/shared/utils/uuid';

interface TokenWriteParams {
	themeId: string;
	token: string;
	originConnectionId?: string;
}

function themeNotFound(): never {
	throw createError({
		statusCode: 404,
		message: 'Theme not found',
	});
}

/**
 * The installation's Theme library (ADR-0049): create, rename, delete, and
 * per-token set and clear. A token write takes no lease and has no draft; it
 * reaches every Screen Output of every Event using the Theme at once, through
 * one `theme:updated` on each of those Events.
 */
export function themeLibraryModule() {
	const themes = themeService();

	async function list(): Promise<ThemeListResponse> {
		return {
			themes: (await themes.findAll()).map(mapThemeToSummary),
		};
	}

	async function get(themeId: string): Promise<ThemeResponse> {
		return mapThemeToResponse(await themes.findById(themeId) ?? themeNotFound());
	}

	/** A new Theme sets no token, so it reads identically to the Default Theme. */
	async function create(name: string): Promise<ThemeResponse> {
		return mapThemeToResponse(await themes.create({
			id: randomUuid(),
			name,
		}));
	}

	async function rename(themeId: string, name: string): Promise<ThemeResponse> {
		return mapThemeToResponse(await themes.rename(themeId, name) ?? themeNotFound());
	}

	async function remove(themeId: string): Promise<void> {
		let deleted: boolean;
		try {
			deleted = await themes.remove(themeId);
		}
		catch (error) {
			if (!(error instanceof ThemeInUseError))
				throw error;
			const data: ThemeInUseData = { code: THEME_IN_USE, events: error.events };
			throw createError({
				statusCode: 409,
				message: `This Theme cannot be deleted while ${error.events.length === 1
					? 'an Event uses'
					: 'Events use'} it: ${error.events.map(event => event.name).join(', ')}`,
				data,
			});
		}
		if (!deleted)
			themeNotFound();
	}

	/** Announce a committed token write on every Event using the Theme, and on no other. */
	async function announce(theme: DbTheme, originConnectionId?: string): Promise<void> {
		const users = await themes.eventsUsing(theme.id);
		const payload = {
			theme: mapThemeToScreenOutput(theme),
		};
		await Promise.all(users.map(event => publishMessage(event.id, 'theme:updated', payload, originConnectionId)));
	}

	async function setToken({ themeId, token, value, originConnectionId }: TokenWriteParams & { value: unknown }): Promise<ThemeResponse> {
		const write = parseThemeTokenWrite(token, value);
		if (!write.ok) {
			throw createError({
				statusCode: 400,
				message: THEME_TOKEN_WRITE_REFUSALS[write.refusal],
				data: { code: write.refusal },
			});
		}
		const theme = await themes.setToken(themeId, token, write.value) ?? themeNotFound();
		await announce(theme, originConnectionId);
		return mapThemeToResponse(theme);
	}

	/** Clear a token, so the Theme reads its default again. One it does not set is cleared already, and announces nothing. */
	async function clearToken({ themeId, token, originConnectionId }: TokenWriteParams): Promise<ThemeResponse> {
		const { theme, cleared } = await themes.clearToken(themeId, token) ?? themeNotFound();
		if (cleared)
			await announce(theme, originConnectionId);
		return mapThemeToResponse(theme);
	}

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
