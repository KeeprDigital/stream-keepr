import type { DbScreen } from '~~/server/db/schema';
import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import { mapBroadcastGraphicsLiveSessionToResponse } from '~~/server/mappers/broadcastGraphicsLiveSession';
import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { broadcastGraphicsStateService } from '~~/server/services/broadcastGraphicsState';
import { graphicBindingDataService } from '~~/server/services/graphicBindingData';
import { screenService } from '~~/server/services/screen';
import { publishMessage } from '~~/server/utils/ably';
import {
	broadcastGraphicChannelContexts,
	broadcastGraphicSourceSelections,
	broadcastGraphicsResolveBindingsDue,
	recoveredBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import { broadcastGraphicPhaseDurations, resolveGraphicInputBindings } from '~~/shared/modules/graphics';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { broadcastGraphicsGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';
import { randomCommandId } from '~~/shared/utils/uuid';

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
	 * The Screen's authored Broadcast Graphics stack and its Graphic Channels.
	 *
	 * Everything a command has to be admitted and reduced against that is not live
	 * state: whether the Screen places the graphic at all, which Graphic Inputs it
	 * declares, which Graphic Assets it pins, and which Graphic Channel it runs in.
	 * All of it is authored configuration, which is why it is answered here rather
	 * than inside the live-state port.
	 */
	function authoredStack(screen: DbScreen): BroadcastGraphicsModeConfig {
		return screen.modeConfigs?.['broadcast-graphics']
			?? getDefaultConfigForMode('broadcast-graphics');
	}

	/** The placed Broadcast Graphic a command addresses. */
	function findAuthoredGraphic(screen: DbScreen, graphicId: string): BroadcastGraphicConfig | undefined {
		return authoredStack(screen).graphics.find(graphic => graphic.id === graphicId);
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
		screen: DbScreen,
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
			// How long this graphic's lifecycle phases last, resolved from the placed
			// graphic this module already had to find. Authored Screen configuration, which
			// is exactly why the reducer is handed it rather than reaching for it.
			durations: broadcastGraphicPhaseDurations(graphic),
			// The Graphic Channel this graphic runs in, and every other Broadcast Graphic
			// the Screen places in it. A Take is the one command whose effect reaches past
			// the graphic it names — it replaces whichever member the channel holds — so
			// resolving the channel is admission's job in exactly the way resolving the
			// graphic is: both are questions about the Screen's authored configuration,
			// which the sequenced aggregate does not contain.
			channel: broadcastGraphicChannelContexts(authoredStack(screen))[graphic.id],
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

	/**
	 * Announce that a Screen's playout epoch has been replaced.
	 *
	 * Its own notification rather than a variant of `commandApplied`, because it is
	 * not a command and nothing about it can be applied: every client holding state
	 * for this Screen is holding state from a session that has ended, and the only
	 * correct response is to reload.
	 *
	 * The case that needs it is an explicit reset, which changes nothing about the
	 * Screen and so publishes no other message — without this, every peer would sit on
	 * the ended epoch still rendering the graphics the reset was meant to clear. A mode
	 * change is already covered by `screen:updated`, and publishes this as well only so
	 * the stale epoch is dropped deterministically.
	 */
	const publishEpochEnded = async (
		eventId: number,
		screenId: number,
		sessionId: number | null,
		originConnectionId?: string,
	): Promise<void> => {
		await publishMessage(
			eventId,
			'broadcastGraphicsLiveSession:epochEnded',
			{ screenId, sessionId },
			originConnectionId,
		);
	};

	/**
	 * End the Screen's epoch, announcing it when the caller wants clients to notice.
	 *
	 * A mode change and a reset both leave the Screen in place with live clients
	 * watching it, so both announce. Deleting the Screen does not: those clients are
	 * about to be told the Screen itself is gone, and pointing them at a snapshot
	 * route that will now refuse them would surface a spurious failure on the way
	 * out — which is why this is a caller's choice rather than something ending an
	 * epoch always does.
	 */
	const endSessionsForScreen = async (
		screenId: number,
		eventId: number,
		options: { notify?: boolean; originConnectionId?: string } = {},
	): Promise<void> => {
		const ended = await state.endSessionsForScreen(screenId, eventId);
		if (options.notify)
			await publishEpochEnded(eventId, screenId, ended?.id ?? null, options.originConnectionId);
	};

	/**
	 * Reset the Screen's live state: every Broadcast Graphic off, a new epoch, and
	 * nothing carried forward.
	 *
	 * The operator's escape hatch, and the recovery action for a Live Session whose
	 * durable state cannot be read at all. It is deliberately the same epoch
	 * advance as a mode change, so the guarantee that a command from an ended epoch
	 * can never affect a later show covers it for free.
	 */
	const resetLiveState = async ({
		eventId,
		screenId,
		originConnectionId,
	}: {
		eventId: number;
		screenId: number;
		originConnectionId?: string;
	}): Promise<BroadcastGraphicsLiveSessionResponse> => {
		await requireBroadcastGraphicsScreen(eventId, screenId);
		const { ended, opened } = await state.resetSessionForScreen(screenId, eventId);
		await publishEpochEnded(eventId, screenId, ended?.id ?? null, originConnectionId);
		return mapBroadcastGraphicsLiveSessionToResponse(opened);
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
			await reductionContextFor(eventId, screen, graphic, session.currentState, command),
			originConnectionId,
			{ publish: true },
		);
	};

	/**
	 * Whether any Graphic Input this Broadcast Graphic binds is applied immediately.
	 *
	 * The authored half of the question, answered before any Event Data is loaded.
	 * A graphic with no live-policy bound input cannot be changed by re-resolution
	 * whatever Event Data does, so it never costs a query.
	 */
	function hasLiveBoundInput(graphic: BroadcastGraphicConfig): boolean {
		return (graphic.bindings ?? []).some(binding => (graphic.inputs ?? []).some(
			declaration => declaration.key === binding.inputKey && declaration.updatePolicy === 'live',
		));
	}

	/**
	 * Re-resolve the live-policy Graphic Input Bindings of every Broadcast Graphic on
	 * program in this Event, for Event Data that has just changed.
	 *
	 * ## Why the authoritative side does this at all
	 *
	 * "Relevant Realtime Event Session changes re-resolve affected Graphic Input
	 * Bindings" is a rule about the show, not about anybody's browser. A live On-air
	 * Update Policy exists precisely for the hands-free case — a lower third that
	 * renames itself while the operator is looking at a different graphic, or at none —
	 * so re-resolution cannot be woken by a Live Control watching one selected graphic.
	 * It has to happen where the acceptance happens, which is here: an on-air Broadcast
	 * Graphic on a Screen nobody has open, with every client disconnected, still says
	 * the new name.
	 *
	 * ## What it deliberately does not do
	 *
	 * It issues the ordinary `Resolve Bindings` command, so every rule that command
	 * already obeys is obeyed here without being restated: a staged input stays pending,
	 * an override is not overwritten, an unavailable binding does not fall back to the
	 * template default, and `acceptedRevision` is left alone so another operator's
	 * staged Update Graphic is not invalidated by a Player being renamed.
	 *
	 * ## Why it is filtered twice before it writes
	 *
	 * Event Data changes constantly and almost none of it reaches a Broadcast Graphic.
	 * The authored filter above costs nothing; the reduction is then computed against
	 * loaded Event Data and only committed when it would actually change what program
	 * shows, because a command that changes nothing still advances the authoritative
	 * sequence that every Live Control and Screen Output reloads against.
	 *
	 * Which Event Data moved is deliberately not part of the filter. A binding may reach
	 * an entity through a fixed relationship from another, so a change that looks
	 * irrelevant to one graphic's declared kinds may not be — and the failure of guessing
	 * wrong is a stale name on program, which is the thing this exists to prevent. The
	 * value comparison is the honest filter, and it is exact.
	 *
	 * ## Why it takes no originating connection
	 *
	 * The Event Data write that woke this has an origin, and the message announcing *that*
	 * change carries it so the browser which already applied it optimistically does not
	 * echo it back to itself. This command is not that change. Nobody issued it, no client
	 * predicted it, and the client whose operator renamed the Player is exactly as
	 * uninformed about the re-resolution as every other client — so forwarding the origin
	 * would make the one browser that caused the change the only one never told its
	 * graphics moved, leaving its Live Control behind until some later command produced a
	 * sequence gap and forced a reload. Taking no parameter at all is what makes that
	 * unforwardable rather than merely unforwarded.
	 *
	 * ## Why one Broadcast Graphic's failure is not the Event's
	 *
	 * Each graphic is attempted on its own. An epoch that ended under the sweep, a Screen
	 * whose Event Data cannot be loaded, or any other single failure would otherwise throw
	 * out of the whole function and be swallowed by the caller — and every *other* Screen
	 * in the Event would silently miss this Event Data change. A change that reaches some
	 * graphics is strictly better than one that reaches none, and the sweep is best-effort
	 * on the way out regardless.
	 */
	const refreshLiveBindings = async ({ eventId }: { eventId: number }): Promise<void> => {
		const sessions = await state.findActiveSessionsByEvent(eventId);
		if (sessions.length === 0)
			return;

		const screensById = new Map((await screens.findByEventId(eventId)).map(screen => [screen.id, screen]));

		for (const session of sessions) {
			const screen = screensById.get(session.screenId);
			if (!screen || screen.currentMode !== 'broadcast-graphics')
				continue;

			for (const graphic of authoredStack(screen).graphics) {
				if (!hasLiveBoundInput(graphic))
					continue;

				try {
					const command: BroadcastGraphicsCommand = {
						commandId: randomCommandId('resolve-bindings'),
						type: 'Resolve Bindings',
						payload: { graphicId: graphic.id },
					};
					// Judged against the epoch as it was read. A Resolve Bindings writes only
					// the Broadcast Graphic it names, so an acceptance for an earlier graphic
					// cannot change the answer for this one — and `applyCommand` loads the
					// current aggregate for itself before it reduces.
					const context = await reductionContextFor(eventId, screen, graphic, session.currentState, command);
					const due = broadcastGraphicsResolveBindingsDue(
						recoveredBroadcastGraphicsLiveState(session.currentState),
						graphic.id,
						{ ...context, acceptedAt: Date.now() },
					);
					if (!due)
						continue;

					await state.applyCommand(session.id, eventId, command, context, undefined, { publish: true });
				}
				catch {
					console.error(JSON.stringify({
						message: 'broadcast_graphics_binding_refresh_failed',
						eventId,
						screenId: screen.id,
						graphicId: graphic.id,
					}));
				}
			}
		}
	};

	return {
		loadSession,
		applyCommand,
		refreshLiveBindings,
		resetLiveState,
		endSessionsForScreen,
	};
}

/**
 * Offer every Broadcast Graphic in one Event the chance to catch up with Event Data
 * that has just changed, and never let that failing break the change itself.
 *
 * The one entry point every trigger uses, so the swallow-and-log policy is stated
 * once and by the module that owns the work rather than copied into each caller. It
 * is best-effort in exactly the way realtime delivery already is: the Event Data
 * write has committed and its own notification has gone out, so a Broadcast Graphic
 * that fails to catch up must not turn a successful write into an apparent failure
 * that invites a retry of the write.
 */
export async function refreshBroadcastGraphicsBindings(eventId: number): Promise<void> {
	try {
		await broadcastGraphicsLiveSessionModule().refreshLiveBindings({ eventId });
	}
	catch {
		console.error(JSON.stringify({ message: 'broadcast_graphics_binding_refresh_failed', eventId }));
	}
}
