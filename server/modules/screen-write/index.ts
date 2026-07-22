import type { CreateScreenInput, UpdateScreenInput } from '~~/server/schemas/api/screen';
import type { ScreenResponse } from '~~/shared/api';
import type { ScreenMode } from '~~/shared/types/enums';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { cardService } from '~~/server/services/card';
import { screenService } from '~~/server/services/screen';
import {
	validateScreenModeConfigReferences,
	validateScreenModeConfigsReferences,
} from '~~/server/utils/routeGuards';

interface CreateScreenParams {
	eventId: number;
	input: CreateScreenInput;
	originConnectionId?: string;
}

interface UpdateScreenParams {
	eventId: number;
	screenId: number;
	input: UpdateScreenInput;
	originConnectionId?: string;
}

interface DeleteScreenParams {
	eventId: number;
	screenId: number;
	originConnectionId?: string;
}

interface UpdateScreenConfigParams {
	eventId: number;
	screenId: number;
	config: Record<string, unknown>;
	stateVersion?: number;
	originConnectionId?: string;
}

interface UpdateModeConfigParams {
	eventId: number;
	screenId: number;
	mode: ScreenMode;
	config: Record<string, unknown>;
	stateVersion?: number;
	originConnectionId?: string;
}

export function screenWriteModule() {
	const publication = eventDataPublicationModule();
	const screens = screenService();

	async function createScreen({ eventId, input, originConnectionId }: CreateScreenParams): Promise<ScreenResponse> {
		await validateScreenModeConfigsReferences(eventId, input.modeConfigs);

		const slugExists = await screens.slugExists(eventId, input.slug);
		if (slugExists) {
			throw createError({
				statusCode: 400,
				message: 'A screen with this slug already exists',
			});
		}

		const newScreen = await screens.create(eventId, input);

		return await publication.screenCreated({
			eventId,
			entity: newScreen,
			originConnectionId,
		});
	}

	async function updateScreen({ eventId, screenId, input, originConnectionId }: UpdateScreenParams): Promise<ScreenResponse> {
		const { stateVersion, ...data } = input;
		const existingScreen = await screens.findById(screenId, eventId);
		if (!existingScreen)
			throw createError({ statusCode: 404, message: 'Screen not found' });

		await validateScreenModeConfigsReferences(eventId, data.modeConfigs);

		if (data.slug) {
			const slugExists = await screens.slugExists(eventId, data.slug, screenId);
			if (slugExists) {
				throw createError({
					statusCode: 400,
					message: 'A screen with this slug already exists',
				});
			}
		}

		const updatedScreen = await screens.update(screenId, eventId, data, stateVersion);

		if (!updatedScreen) {
			throw createError({ statusCode: 404, message: 'Screen not found' });
		}

		return await publication.screenUpdated({
			eventId,
			entity: updatedScreen,
			originConnectionId,
		});
	}

	async function deleteScreen({ eventId, screenId, originConnectionId }: DeleteScreenParams): Promise<{ success: boolean }> {
		const deleted = await screens.remove(screenId, eventId);

		if (!deleted) {
			throw createError({
				statusCode: 404,
				message: 'Screen not found',
			});
		}

		// D1 is authoritative. Derived KV/realtime artifacts are cleaned only after
		// the relational delete commits, so a failed delete cannot erase live state.
		await cardService().cleanupDeletedScreenCard(eventId, screenId);

		await publication.screenDeleted({
			eventId,
			id: screenId,
			originConnectionId,
		});

		return { success: true };
	}

	async function updateScreenConfig({ eventId, screenId, config, stateVersion, originConnectionId }: UpdateScreenConfigParams): Promise<ScreenResponse> {
		const updatedScreen = await screens.updateScreenConfig(screenId, eventId, config, stateVersion);

		if (!updatedScreen) {
			throw createError({
				statusCode: 404,
				message: 'Screen not found',
			});
		}

		return await publication.screenUpdated({
			eventId,
			entity: updatedScreen,
			originConnectionId,
		});
	}

	async function updateModeConfig({ eventId, screenId, mode, config, stateVersion, originConnectionId }: UpdateModeConfigParams): Promise<ScreenResponse> {
		await validateScreenModeConfigReferences(eventId, mode, config);

		const updatedScreen = await screens.updateModeConfig(screenId, eventId, mode, config, stateVersion);

		if (!updatedScreen) {
			throw createError({
				statusCode: 404,
				message: 'Screen not found',
			});
		}

		return await publication.screenUpdated({
			eventId,
			entity: updatedScreen,
			originConnectionId,
		});
	}

	return {
		createScreen,
		updateScreen,
		deleteScreen,
		updateScreenConfig,
		updateModeConfig,
	};
}
