import type { DbScreen } from '~~/server/db/schema';
import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { mapBroadcastGraphicsLiveSessionToResponse } from '~~/server/mappers/broadcastGraphicsLiveSession';
import { broadcastGraphicsStateService } from '~~/server/services/broadcastGraphicsState';
import { screenService } from '~~/server/services/screen';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';

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
export function broadcastGraphicsLiveSessionModule() {
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
	 * all, and which Graphic Inputs it declares. Both are questions about authored
	 * configuration rather than live state, which is why they are answered here
	 * rather than inside the live-state port.
	 */
	function findAuthoredGraphic(screen: DbScreen, graphicId: string): BroadcastGraphicConfig | undefined {
		const config = screen.modeConfigs?.['broadcast-graphics']
			?? getDefaultConfigForMode('broadcast-graphics');
		return config.graphics.find(graphic => graphic.id === graphicId);
	}

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
			graphic.inputs ?? [],
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
