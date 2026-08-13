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

/**
 * A collaborator an operation needs, passed as a thunk and invoked at the point
 * of use.
 *
 * Two decisions, and they are separate ones.
 *
 * **Required, and on the operation rather than the module.** Optional module
 * dependencies meant a construction site could omit one and find out at runtime,
 * which is the 503 #243 spent a ticket making legible. Requiring them makes the
 * omission a compile error and the defensive branch unrepresentable, so it is
 * deleted rather than decorated. They sit on the operation because that is where
 * the requirement is true: three of this module's seven construction sites call
 * an operation that needs neither, and a module-level requirement would make
 * those routes name collaborators they never use. Every one of these is
 * request-scoped — derived from the H3 event, exactly like `originConnectionId`
 * — so it belongs to the call rather than to the module.
 *
 * **A thunk, because constructing one can fail or can be wasted.**
 * `screenOutputAssetCapabilityManagerForEvent` throws when the signing key is
 * unset (#233), and `updateModeConfig` serves all ten Screen Modes while only
 * two of them can pin a Graphic Asset Reference. Deferring construction to the
 * point of need is what keeps a write that never reaches the collaborator from
 * paying for it. See #247.
 */
type Provides<T> = () => T;

interface CreateScreenParams {
	eventId: number;
	input: CreateScreenInput;
	originConnectionId?: string;
	screenOutputAssetCapabilities: Provides<Pick<ScreenOutputAssetCapabilityManager, 'prepare'>>;
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
	graphicsAssets: Provides<Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevision'>>;
}

const MODE_CONFIG_ENDPOINT_REQUIRED
	= 'Graphic Asset References must be changed through the Screen Mode configuration endpoint';

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

export function screenWriteModule() {
	const publication = eventDataPublicationModule();
	const screens = screenService();

	async function createScreen({ eventId, input, originConnectionId, screenOutputAssetCapabilities }: CreateScreenParams): Promise<ScreenResponse> {
		await validateScreenModeConfigsReferences(eventId, input.modeConfigs);
		rejectUnindexedGraphicAssetReferencesOnCreate(input.modeConfigs);

		const slugExists = await screens.slugExists(eventId, input.slug);
		if (slugExists) {
			throw createError({
				statusCode: 400,
				message: 'A screen with this slug already exists',
			});
		}

		// Constructed here rather than by the route, so a create refused for its
		// slug or its Graphic Asset References never reaches for a signing key it
		// was not going to use.
		const preparedCapability = await screenOutputAssetCapabilities().prepare();
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

		// A Broadcast Graphics Live Session is the Screen's playout epoch, so leaving
		// the mode ends it — in the same commit as the mode change, because neither
		// order survives on its own. Ending first meant a refused update could blank a
		// running show; ending afterwards meant a failed end left the Screen out of the
		// mode with its epoch still active, which the next activation resurrected with
		// the previous show's graphics on air (#305). Committed together there is no
		// instant between them, and the end's own condition covers the refused write.
		const epochEnd = existingScreen.currentMode === 'broadcast-graphics'
			&& data.currentMode !== undefined
			&& data.currentMode !== 'broadcast-graphics'
			? await broadcastGraphicsLiveSessionModule()
					.endEpochOnLeavingBroadcastGraphics(screenId, eventId, originConnectionId)
			: undefined;

		const updatedScreen = await screens.update(
			screenId,
			eventId,
			data,
			stateVersion,
			epochEnd?.statements,
		);

		if (!updatedScreen) {
			throw createError({ statusCode: 404, message: 'Screen not found' });
		}

		// Announced only now, because an announcement is a claim that an epoch ended
		// and the commit that ends it has to have happened first. Not out of necessity:
		// `screen:updated` already reaches every client including Screen Outputs, and
		// an output renders by the Screen's current mode, so it stops composing
		// graphics without being told about the epoch. The notification makes each peer
		// drop the ended epoch's cached state deterministically rather than as a side
		// effect of a component remount.
		if (epochEnd) {
			await epochEnd.announceEnded();
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
		// them, after which nothing identifies the receipts they left behind. This is
		// the one end still issued as a write of its own — `updateScreen` commits its
		// end with the mode change that causes it, which is not available here because
		// the delete is not one statement to ride along with. A failure between the
		// two costs nothing that matters: the epoch has ended and the Screen survives,
		// which is a Screen in Broadcast Graphics mode whose next snapshot opens a
		// fresh epoch — the state a delete was heading for anyway.
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

	async function updateModeConfig({ eventId, screenId, mode, config, stateVersion, originConnectionId, graphicsAssets }: UpdateModeConfigParams): Promise<ScreenResponse> {
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
			// Built at most once, and only once a reference this write actually
			// changes has been found. Eight of the ten Screen Modes pin nothing at
			// all, and a write to either of the other two that changes no reference
			// asks the library nothing — none of them should build one.
			let library: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevision'> | undefined;
			// A newly chosen revision must be one an author could legitimately select
			// right now. An unchanged one is deliberately not re-checked: a pinned
			// revision keeps resolving after its asset is retired, so re-checking it
			// would make every later edit of an unrelated property fail.
			for (const item of screenModeGraphicAssetReferences(mode, nextConfigs)) {
				const current = currentReferences.get(item.ownerSlot);
				if (sameGraphicAssetReference(current, item.reference)) {
					continue;
				}
				library ??= graphicsAssets();
				const status = await library.inspectGraphicAssetRevision({
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
