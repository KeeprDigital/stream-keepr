import type { DbScreen } from '~~/server/db/schema';
import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { mapBroadcastGraphicsLiveSessionToResponse } from '~~/server/mappers/broadcastGraphicsLiveSession';
import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { broadcastGraphicsStateService } from '~~/server/services/broadcastGraphicsState';
import { screenService } from '~~/server/services/screen';
import { broadcastGraphicPhaseDurations } from '~~/shared/modules/graphics';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { broadcastGraphicsGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

interface ApplyCommandParams {
	eventId: number;
	screenId: number;
	sessionId: number;
	command: BroadcastGraphicsCommand;
	originConnectionId?: string;
}

/**
 * Server-side Broadcast Graphics Live Session workflow module.
 *
 * The external seam for route handlers: it resolves the Screen a playout action
 * addresses, admits the action against the Screen's authored stack, and hands it
 * to the shared sequenced live-state module, which owns the authoritative order,
 * receipts, duplicate suppression, and realtime publication.
 *
 * Admission that needs the Screen belongs here rather than in the live-state
 * port, because the port's aggregate is exactly the row its projection writes
 * back — the Screen is a second entity the sequenced aggregate does not contain.
 */
export function broadcastGraphicsLiveSessionModule(dependencies: {
	graphicsAssets?: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevision'>;
} = {}) {
	const state = broadcastGraphicsStateService();
	const screens = screenService();

	/**
	 * The Screen, proven to be a Broadcast Graphics Screen.
	 *
	 * A Broadcast Graphics Live Session only exists while its Screen is in
	 * Broadcast Graphics mode, so asking about playout on any other Screen is a
	 * conflict rather than an empty answer.
	 */
	const requireBroadcastGraphicsScreen = async (eventId: number, screenId: number): Promise<DbScreen> => {
		const screen = await screens.findById(screenId, eventId);
		if (!screen)
			throw createError({ statusCode: 404, message: 'Screen not found' });
		if (screen.currentMode !== 'broadcast-graphics') {
			throw createError({
				statusCode: 409,
				message: 'Screen is not in Broadcast Graphics mode',
			});
		}
		return screen;
	};

	/**
	 * The placed Broadcast Graphic a command addresses, from the Screen's authored
	 * stack.
	 *
	 * Both admission and reduction need it: whether the Screen places the graphic at
	 * all, which Graphic Inputs it declares, and which Graphic Assets it pins. All
	 * three are questions about authored configuration rather than live state, which
	 * is why they are answered here rather than inside the live-state port.
	 */
	function findAuthoredGraphic(screen: DbScreen, graphicId: string): BroadcastGraphicConfig | undefined {
		const config = screen.modeConfigs?.['broadcast-graphics']
			?? getDefaultConfigForMode('broadcast-graphics');
		return config.graphics.find(graphic => graphic.id === graphicId);
	}

	/**
	 * A Missing Graphic Asset Reference invalidates the Broadcast Graphic that owns
	 * it, so that graphic cannot be taken on air.
	 *
	 * Enforced here rather than in the reducer, and rather than only in Live
	 * Control. The reducer's aggregate is exactly the row its projection writes
	 * back, and this question needs two more entities — the placed Broadcast Graphic
	 * and the Graphics Asset Library — so it belongs in the module that already
	 * resolves both before handing the command on. A disabled button is not the
	 * invariant: a second operator on stale data, a replayed command, or a direct
	 * API call all reach this path.
	 *
	 * Only Take is gated. Out needs none of the asset's bytes, and blocking it would
	 * trap on air the very graphic an operator most needs to remove. A retired asset
	 * is not a failure either: its pinned revisions keep resolving by design.
	 */
	const requireResolvableGraphicAssets = async (graphic: BroadcastGraphicConfig): Promise<void> => {
		const references = broadcastGraphicsGraphicAssetReferences({ graphics: [graphic] });
		if (references.length === 0)
			return;

		if (!dependencies.graphicsAssets) {
			throw createError({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Graphics Asset Library is unavailable',
			});
		}

		for (const item of references) {
			const status = await dependencies.graphicsAssets.inspectGraphicAssetRevision({
				assetId: graphicAssetId(item.reference.assetId),
				revisionId: graphicAssetRevisionId(item.reference.revisionId),
			});
			if (status.outcome === 'available')
				continue;
			throw createError({
				statusCode: 409,
				statusMessage: 'Conflict',
				message: status.outcome === 'missing'
					? `Graphic Asset Reference at ${item.ownerSlot} is missing, so this Broadcast Graphic cannot be taken on air`
					: `Graphic Asset Content at ${item.ownerSlot} is temporarily unavailable, so this Broadcast Graphic cannot be taken on air`,
			});
		}
	};

	/**
	 * The authoritative snapshot, opening the Screen's epoch if it has none.
	 *
	 * Every reconnecting Live Control and Screen Output reloads through here:
	 * realtime messages are notifications, and this is the authority they point
	 * at.
	 */
	const loadSession = async (
		eventId: number,
		screenId: number,
	): Promise<BroadcastGraphicsLiveSessionResponse> => {
		await requireBroadcastGraphicsScreen(eventId, screenId);
		const session = await state.ensureActiveSession(screenId, eventId);
		return mapBroadcastGraphicsLiveSessionToResponse(session);
	};

	const applyCommand = async ({
		eventId,
		screenId,
		sessionId,
		command,
		originConnectionId,
	}: ApplyCommandParams): Promise<BroadcastGraphicsCommandResult> => {
		const screen = await requireBroadcastGraphicsScreen(eventId, screenId);
		const graphic = findAuthoredGraphic(screen, command.payload.graphicId);

		if (!graphic) {
			throw createError({
				statusCode: 404,
				message: 'Broadcast Graphic not found on this Screen',
			});
		}

		if (command.type === 'Take')
			await requireResolvableGraphicAssets(graphic);

		const session = await state.findSessionById(sessionId, eventId);
		if (!session || session.screenId !== screenId) {
			throw createError({
				statusCode: 404,
				message: 'Broadcast graphics live session not found',
			});
		}

		return await state.applyCommand(
			sessionId,
			eventId,
			command,
			// Resolved from the placed graphic this module already had to find: what it
			// declares, and how long its lifecycle phases last. Both are authored Screen
			// configuration, which is exactly why the reducer is handed them rather than
			// reaching for them.
			{ inputs: graphic.inputs ?? [], durations: broadcastGraphicPhaseDurations(graphic) },
			originConnectionId,
			{ publish: true },
		);
	};

	return {
		loadSession,
		applyCommand,
		endSessionsForScreen: state.endSessionsForScreen,
	};
}
