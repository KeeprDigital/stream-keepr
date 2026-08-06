import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { ScreenOutputAssetCapabilityManager } from '~~/server/modules/screen-output-assets/manager';
import type { CreateScreenInput, UpdateScreenInput } from '~~/server/schemas/api/screen';
import type { ScreenResponse } from '~~/shared/api';
import type { ScreenMode } from '~~/shared/types/enums';
import { broadcastGraphicsLiveSessionModule } from '~~/server/modules/broadcast-graphics-live-session';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { parseModeConfigPatchResult } from '~~/server/schemas/api/screen';
import { cardService } from '~~/server/services/card';
import { screenService } from '~~/server/services/screen';
import { ServiceWiringError } from '~~/server/utils/errors';
import {
	validateScreenModeConfigReferences,
	validateScreenModeConfigsReferences,
} from '~~/server/utils/routeGuards';
import { mergeScreenModeConfig } from '~~/shared/types/screenConfig';
import {
	GRAPHIC_ASSET_REFERENCING_SCREEN_MODES,
	isGraphicAssetReferencingScreenMode,
	sameGraphicAssetReference,
	sameScreenGraphicAssetReferences,
	screenModeGraphicAssetReferences,
} from '~~/shared/utils/graphicsAssetReferences';

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

const MODE_CONFIG_ENDPOINT_REQUIRED
	= 'Graphic Asset References must be changed through the Screen Mode configuration endpoint';

/**
 * A dependency this module was never handed is a wiring fault, not a
 * configuration one, so it carries `ServiceWiringError` rather than #233's
 * `ServiceConfigurationError` — but it carries a cause for the same reason.
 * `mapPublicNitroError` rewrites every unrecognised 5xx to 'Internal Server
 * Error', and the operator who receives that for a misassembled build has
 * nothing to report and no setting to change. See #243.
 *
 * No route reaches this today; every construction site supplies what the
 * operation it calls needs. It is the branch a future one would fall into.
 */
function missingDependency(dependency: string) {
	const cause = new ServiceWiringError('The Screen write module', dependency);
	return createError({
		statusCode: cause.statusCode,
		statusMessage: 'Service Unavailable',
		message: cause.message,
		cause,
	});
}

/**
 * A generic Screen write indexes nothing, so it may not introduce a reference.
 *
 * Only the per-mode configuration endpoint writes a configuration and its
 * Graphic Asset Reference index together. A reference arriving through a generic
 * create or update would be published by the Screen without being indexed, and a
 * Screen Output would then be asked for a revision its capability never covered.
 */
function rejectUnindexedGraphicAssetReferencesOnCreate(
	modeConfigs: CreateScreenInput['modeConfigs'] | UpdateScreenInput['modeConfigs'],
) {
	for (const mode of GRAPHIC_ASSET_REFERENCING_SCREEN_MODES) {
		if (screenModeGraphicAssetReferences(mode, modeConfigs).length > 0) {
			throw createError({
				statusCode: 400,
				statusMessage: 'Bad Request',
				message: MODE_CONFIG_ENDPOINT_REQUIRED,
			});
		}
	}
}

function rejectChangedGraphicAssetReferencesOnGenericUpdate(
	currentModeConfigs: ScreenResponse['modeConfigs'],
	nextModeConfigs: UpdateScreenInput['modeConfigs'],
) {
	if (nextModeConfigs === undefined)
		return;
	for (const mode of GRAPHIC_ASSET_REFERENCING_SCREEN_MODES) {
		const currentReferences = screenModeGraphicAssetReferences(mode, currentModeConfigs);
		const nextReferences = screenModeGraphicAssetReferences(mode, nextModeConfigs);
		if (!sameScreenGraphicAssetReferences(currentReferences, nextReferences)) {
			throw createError({
				statusCode: 400,
				statusMessage: 'Bad Request',
				message: MODE_CONFIG_ENDPOINT_REQUIRED,
			});
		}
	}
}

export function screenWriteModule(dependencies: {
	graphicsAssets?: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevision'>;
	screenOutputAssetCapabilities?: Pick<ScreenOutputAssetCapabilityManager, 'prepare'>;
} = {}) {
	const publication = eventDataPublicationModule();
	const screens = screenService();

	async function createScreen({ eventId, input, originConnectionId }: CreateScreenParams): Promise<ScreenResponse> {
		await validateScreenModeConfigsReferences(eventId, input.modeConfigs);
		rejectUnindexedGraphicAssetReferencesOnCreate(input.modeConfigs);
		if (!dependencies.screenOutputAssetCapabilities)
			throw missingDependency('Screen Output asset capabilities');

		const slugExists = await screens.slugExists(eventId, input.slug);
		if (slugExists) {
			throw createError({
				statusCode: 400,
				message: 'A screen with this slug already exists',
			});
		}

		const preparedCapability = await dependencies.screenOutputAssetCapabilities.prepare();
		const newScreen = await screens.create(
			eventId,
			input,
			preparedCapability.persisted,
		);

		return publication.screenCreated({
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
		rejectChangedGraphicAssetReferencesOnGenericUpdate(
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

		// A Broadcast Graphics Live Session is the Screen's playout epoch, so
		// leaving the mode ends it. Ending after the mode change commits means a
		// failed update can never orphan a running show's live state.
		//
		// Announced, though not out of necessity: `screen:updated` already reaches
		// every client including Screen Outputs, and an output renders by the Screen's
		// current mode, so it stops composing graphics without being told about the
		// epoch. The notification makes each peer drop the ended epoch's cached state
		// deterministically rather than as a side effect of a component remount.
		if (existingScreen.currentMode === 'broadcast-graphics' && updatedScreen.currentMode !== 'broadcast-graphics') {
			await broadcastGraphicsLiveSessionModule().endSessionsForScreen(screenId, eventId, {
				notify: true,
				originConnectionId,
			});
		}
		else if (data.modeConfigs !== undefined && updatedScreen.currentMode === 'broadcast-graphics') {
			// A generic write may not change the authored Graphic Asset References — that
			// is refused above — but it may still stop declaring a media Graphic Input
			// whose default is null, which changes what the Live Session publishes without
			// changing a single authored reference.
			await broadcastGraphicsLiveSessionModule().republishLiveSessionReferences({
				eventId,
				screenId,
				previousStack: existingScreen.modeConfigs?.['broadcast-graphics'],
			});
		}

		return await publication.screenUpdated({
			eventId,
			entity: updatedScreen,
			originConnectionId,
		});
	}

	async function deleteScreen({ eventId, screenId, originConnectionId }: DeleteScreenParams): Promise<{ success: boolean }> {
		// End any playout epoch before the delete, and only for a Screen that has
		// one. Ending is what discards the epoch's Command Receipts, and it has to
		// happen while the sessions still exist: the Screen's cascade delete removes
		// them, after which nothing identifies the receipts they left behind. That is
		// the opposite order from `updateScreen`, which ends the epoch only after its
		// mode change commits so a failed update cannot blank a running show.
		const existingScreen = await screens.findById(screenId, eventId);
		if (existingScreen?.currentMode === 'broadcast-graphics')
			await broadcastGraphicsLiveSessionModule().endSessionsForScreen(screenId, eventId);

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

		const existing = await screens.findById(screenId, eventId);
		if (!existing)
			throw createError({ statusCode: 404, message: 'Screen not found' });

		/*
		 * Every whole-object rule the mode configuration has to satisfy is checked
		 * here, against the configuration this patch would produce.
		 *
		 * A patch is a fragment, so the patch schema can only enforce field bounds;
		 * rules about the whole configuration — today the byte total shared across all
		 * ten Screen Modes — are properties of the merged result. Checking them at this
		 * one point is what makes them hold identically whether a Screen was configured
		 * in a single write or built up one patch at a time, and it means a rule added
		 * to `modeConfigSchemaMap` in future is enforced on the editors' write path
		 * without anyone having to remember to wire it up. See #85.
		 */
		parseModeConfigPatchResult(existing.modeConfigs, mode, config);

		if (isGraphicAssetReferencingScreenMode(mode)) {
			const nextConfigs = mergeScreenModeConfig(existing.modeConfigs ?? {}, mode, config);
			const currentReferences = new Map(
				screenModeGraphicAssetReferences(mode, existing.modeConfigs)
					.map(item => [item.ownerSlot, item.reference] as const),
			);
			// A newly chosen revision must be one an author could legitimately select
			// right now. An unchanged one is deliberately not re-checked: a pinned
			// revision keeps resolving after its asset is retired, so re-checking it
			// would make every later edit of an unrelated property fail.
			for (const item of screenModeGraphicAssetReferences(mode, nextConfigs)) {
				const current = currentReferences.get(item.ownerSlot);
				if (sameGraphicAssetReference(current, item.reference)) {
					continue;
				}
				if (!dependencies.graphicsAssets)
					throw missingDependency('the Graphics Asset Library');
				const status = await dependencies.graphicsAssets.inspectGraphicAssetRevision({
					assetId: graphicAssetId(item.reference.assetId),
					revisionId: graphicAssetRevisionId(item.reference.revisionId),
				});
				if (
					status.outcome !== 'available'
					|| status.lifecycleState !== 'active'
					|| status.kind !== item.kind
				) {
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

		// What a Broadcast Graphics Live Session publishes is its accepted media values
		// read through the Screen's *current* declarations, so this write can change it
		// without any acceptance happening. Undeclaring a media Graphic Input, or
		// unplacing the Broadcast Graphic that declares it, has to remove its published
		// references here — nothing on the acceptance path can see that it happened.
		if (mode === 'broadcast-graphics') {
			await broadcastGraphicsLiveSessionModule().republishLiveSessionReferences({
				eventId,
				screenId,
				previousStack: existing.modeConfigs?.['broadcast-graphics'],
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
