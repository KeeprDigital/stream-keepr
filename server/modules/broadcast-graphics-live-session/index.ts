import type { DbScreen } from '~~/server/db/schema';
import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
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
import { graphicBindingDataService } from '~~/server/services/graphicBindingData';
import { screenService } from '~~/server/services/screen';
import {
	broadcastGraphicSourceSelections,
} from '~~/shared/modules/broadcast-graphics-live-session';
import { resolveGraphicInputBindings } from '~~/shared/modules/graphics';
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
	const bindingData = graphicBindingDataService();

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
	 * What reduction needs to know about the addressed Broadcast Graphic: its
	 * declarations, and how its Graphic Input Bindings resolve against Event Data.
	 *
	 * Event Data is loaded once, here, for the Graphic Source Selections this command
	 * could leave in place — the ones already accepted, plus the one this command is
	 * about. Reduction then resolves against that loaded set, so a Select Source can
	 * see its own effect and a merge retry re-resolves without another round trip.
	 *
	 * The bindings resolve through the shared catalog, which is the same function Live
	 * Control resolves its displayed bound values with. That is deliberate: an
	 * operator's "latest bound value" and the value acceptance actually puts on air are
	 * then the same computation over the same facts, rather than two implementations
	 * that agree until they do not.
	 */
	const reductionContextFor = async (
		eventId: number,
		graphic: BroadcastGraphicConfig,
		currentState: BroadcastGraphicsLiveState,
		command: BroadcastGraphicsCommand,
	) => {
		const accepted = broadcastGraphicSourceSelections(currentState, graphic.id);
		const candidate = command.type === 'Select Source' && command.payload.selectionId !== null
			? { ...accepted, [command.payload.sourceKey]: command.payload.selectionId }
			: accepted;
		const data = await bindingData.load(eventId, graphic.sources ?? [], candidate);

		return {
			inputs: graphic.inputs ?? [],
			sources: graphic.sources ?? [],
			bindings: graphic.bindings ?? [],
			resolveBindings: (selections: Readonly<Record<string, number>>) =>
				resolveGraphicInputBindings(graphic, selections, data),
		};
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
			await reductionContextFor(eventId, graphic, session.currentState, command),
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
