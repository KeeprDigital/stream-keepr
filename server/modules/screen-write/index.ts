import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { CreateScreenInput, UpdateScreenInput } from '~~/server/schemas/api/screen';
import type { ScreenResponse } from '~~/shared/api';
import type { ScreenMode } from '~~/shared/types/enums';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { featureMatchOverlayGraphicAssetReferences } from '~~/server/modules/screen-graphic-asset-references';
import { cardService } from '~~/server/services/card';
import { screenService } from '~~/server/services/screen';
import {
	validateScreenModeConfigReferences,
	validateScreenModeConfigsReferences,
} from '~~/server/utils/routeGuards';
import { mergeScreenModeConfig } from '~~/shared/types/screenConfig';

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

function rejectUnindexedFeatureMatchOverlayReferencesOnCreate(
	modeConfigs: CreateScreenInput['modeConfigs'] | UpdateScreenInput['modeConfigs'],
) {
	const config = modeConfigs?.['feature-match-overlay'];
	if (config && featureMatchOverlayGraphicAssetReferences(config).length > 0) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Bad Request',
			message: 'Graphic Asset References must be changed through the Feature Match Overlay configuration endpoint',
		});
	}
}

function rejectChangedFeatureMatchOverlayReferencesOnGenericUpdate(
	currentModeConfigs: ScreenResponse['modeConfigs'],
	nextModeConfigs: UpdateScreenInput['modeConfigs'],
) {
	if (nextModeConfigs === undefined)
		return;
	const currentConfig = currentModeConfigs?.['feature-match-overlay'];
	const nextConfig = nextModeConfigs?.['feature-match-overlay'];
	const currentReferences = currentConfig
		? featureMatchOverlayGraphicAssetReferences(currentConfig)
		: [];
	const nextReferences = nextConfig
		? featureMatchOverlayGraphicAssetReferences(nextConfig)
		: [];
	const nextBySlot = new Map(
		nextReferences.map(item => [item.ownerSlot, item.reference] as const),
	);
	const unchanged = currentReferences.length === nextReferences.length
		&& currentReferences.every((item) => {
			const next = nextBySlot.get(item.ownerSlot);
			return next?.assetId === item.reference.assetId
				&& next.revisionId === item.reference.revisionId;
		});
	if (!unchanged) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Bad Request',
			message: 'Graphic Asset References must be changed through the Feature Match Overlay configuration endpoint',
		});
	}
}

export function screenWriteModule(dependencies: {
	graphicsAssets?: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevision'>;
} = {}) {
	const publication = eventDataPublicationModule();
	const screens = screenService();

	async function createScreen({ eventId, input, originConnectionId }: CreateScreenParams): Promise<ScreenResponse> {
		await validateScreenModeConfigsReferences(eventId, input.modeConfigs);
		rejectUnindexedFeatureMatchOverlayReferencesOnCreate(input.modeConfigs);

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
		rejectChangedFeatureMatchOverlayReferencesOnGenericUpdate(
			existingScreen.modeConfigs,
			data.modeConfigs,
		);

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
		if (mode === 'feature-match-overlay') {
			const existing = await screens.findById(screenId, eventId);
			if (!existing)
				throw createError({ statusCode: 404, message: 'Screen not found' });
			const currentConfig = existing.modeConfigs?.[mode];
			const nextConfig = mergeScreenModeConfig(
				existing.modeConfigs ?? {},
				mode,
				config,
			)[mode]!;
			const currentReferences = new Map(
				currentConfig
					? featureMatchOverlayGraphicAssetReferences(currentConfig)
							.map(item => [item.ownerSlot, item.reference] as const)
					: [],
			);
			for (const item of featureMatchOverlayGraphicAssetReferences(nextConfig)) {
				const current = currentReferences.get(item.ownerSlot);
				if (
					current?.assetId === item.reference.assetId
					&& current.revisionId === item.reference.revisionId
				) {
					continue;
				}
				if (!dependencies.graphicsAssets) {
					throw createError({
						statusCode: 503,
						statusMessage: 'Service Unavailable',
						message: 'Graphics Asset Library is unavailable',
					});
				}
				const status = await dependencies.graphicsAssets.inspectGraphicAssetRevision({
					assetId: graphicAssetId(item.reference.assetId),
					revisionId: graphicAssetRevisionId(item.reference.revisionId),
				});
				if (status.outcome !== 'available' || status.lifecycleState !== 'active') {
					throw createError({
						statusCode: 409,
						statusMessage: 'Conflict',
						message: `Graphic Asset Reference at ${item.ownerSlot} is not selectable`,
					});
				}
			}
		}

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
