import type {
	BroadcastGraphicInputsState,
	BroadcastGraphicPhaseTiming,
	BroadcastGraphicsLiveState,
	GraphicInputTrace,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import type {
	BroadcastGraphicConfig,
	GraphicAnimationPhase,
	GraphicInputValue,
	GraphicPlayoutState,
} from '~~/shared/types/graphics';
import type { MessageData } from '~/types/realtime';
import {
	acceptedGraphicInputValues,
	broadcastGraphicInputsState,
	broadcastGraphicPhaseProjection,
	broadcastGraphicPhaseTiming,
	broadcastGraphicPlayoutState,
	broadcastGraphicRenderedInputs,
	createInitialBroadcastGraphicsLiveState,
	graphicInputTraces,
	onAirBroadcastGraphicIds,
} from '~~/shared/modules/broadcast-graphics-live-session';
import { randomCommandId } from '~~/shared/utils/uuid';

/**
 * Client-side Broadcast Graphics playout state, per Screen.
 *
 * The snapshot loaded from the server is the only authority here: a playout
 * command's result and a reloaded snapshot are written straight in, and a
 * realtime notification is trusted only while it continues the sequence this
 * client already holds. A gap means this client fell behind, so it reloads the
 * authoritative snapshot rather than guessing what it missed. That is what makes
 * a reconnecting Live Control and a reconnecting Screen Output converge on the
 * same state.
 */
export const useBroadcastGraphicsLiveSessionStore = defineStore('broadcastGraphicsLiveSession', () => {
	const repository = useBroadcastGraphicsLiveSessionRepository();
	const { executeAction } = useAsyncAction();

	/**
	 * The authoritative clock, shared with every other live surface in the application.
	 *
	 * Every effective start time in a snapshot was stamped by the server's clock, and an
	 * output must not subtract two clocks it does not own: a browser a minute behind the
	 * server would believe an exiting Broadcast Graphic was still exiting for that whole
	 * minute, and since an exiting graphic is on program, a graphic the operator has
	 * taken off would stay on air on that output. Phases last at most twenty seconds; an
	 * un-synchronised clock is routinely minutes out.
	 *
	 * This is deliberately the existing installation-wide sync rather than a playout-specific
	 * one. It already compensates for round-trip time across three samples with the worst
	 * discarded and re-syncs every sixty seconds, so its residual error is smaller than
	 * anything a single snapshot read could establish — and one clock for the whole
	 * application means the Feature Match Session clock and Broadcast Graphics playout can
	 * never disagree about what time it is.
	 */
	const { getServerTime, isSynced: isClockSynced } = useServerTime();
	const sessions = ref<Map<number, BroadcastGraphicsLiveSessionResponse>>(new Map());
	const loading = ref(false);
	const error = ref<string | null>(null);
	/** Playout actions awaiting their authoritative answer, keyed per Broadcast Graphic. */
	const pending = ref<Set<string>>(new Set());

	function playoutKey(screenId: number, graphicId: string): string {
		return `${screenId}:${graphicId}`;
	}

	/**
	 * Whether this Broadcast Graphic has an action in flight.
	 *
	 * Scoped per graphic rather than per Screen: taking one graphic must never
	 * freeze the controls of another.
	 */
	function isPending(screenId: number, graphicId: string): boolean {
		return pending.value.has(playoutKey(screenId, graphicId));
	}

	function isConflict(failure: unknown): boolean {
		if (typeof failure !== 'object' || failure === null)
			return false;
		const status = 'statusCode' in failure ? failure.statusCode : ('status' in failure ? failure.status : undefined);
		return status === 409;
	}

	function liveState(screenId: number): BroadcastGraphicsLiveState {
		return sessions.value.get(screenId)?.currentState ?? createInitialBroadcastGraphicsLiveState();
	}

	/**
	 * Now, on the clock that stamped the effective start times being read.
	 *
	 * The only instant any playout projection in this client is allowed to use.
	 */
	function serverNow(): number {
		return getServerTime();
	}

	/**
	 * Everything one Broadcast Graphic's phases are projected against, at `now` — or
	 * nothing at all until this browser knows what time the server thinks it is.
	 *
	 * Before the first sync the offset is zero, which means the local clock unmodified —
	 * exactly the condition the clock-skew hazard describes. So an unsynced reader is
	 * given no timing, and no timing already means "report only the settled states":
	 * an on-air Broadcast Graphic renders at its Graphic Resting State, an exiting one is
	 * reported off and leaves program at once, and nothing animates.
	 *
	 * That is the same answer recovery resolves to, and it is chosen over projecting on an
	 * unknown clock because the two failures are not equally bad. Projecting unsynced can
	 * pin a graphic at full excursion for the length of the skew and then play its
	 * entrance from zero the moment the sync lands — the replay the no-replay invariant
	 * forbids, arriving through the clock. Holding the resting state instead costs an
	 * entrance that pops on rather than animating, for the length of one sync (three
	 * samples fifty milliseconds apart) after a load. A missed entrance is a blemish; a
	 * replayed one mid-show is a fault.
	 */
	function timingFor(
		graphic: Pick<BroadcastGraphicConfig, 'items' | 'animation'>,
		now: number,
	): BroadcastGraphicPhaseTiming | undefined {
		return isClockSynced.value ? broadcastGraphicPhaseTiming(graphic, now) : undefined;
	}

	/**
	 * The Graphic Playout State of one placed Broadcast Graphic.
	 *
	 * With a graphic and an instant it reports entering, updating, and exiting as well
	 * as the settled states; with neither it reports only the settled ones, which is
	 * what a caller that is not animating anything wants.
	 */
	function playoutState(
		screenId: number,
		graphicId: string,
		graphic?: Pick<BroadcastGraphicConfig, 'items' | 'animation'>,
		now?: number,
	): GraphicPlayoutState {
		return broadcastGraphicPlayoutState(
			liveState(screenId),
			graphicId,
			graphic ? timingFor(graphic, now ?? serverNow()) : undefined,
		);
	}

	/**
	 * Which Broadcast Graphics compose into the Screen's frame, in authored stack order.
	 *
	 * Each graphic is timed against its own authored durations, because an exiting
	 * graphic stays on program until *its* exit completes.
	 */
	function onAirGraphicIds(
		screenId: number,
		graphics: readonly BroadcastGraphicConfig[],
		now?: number,
	): string[] {
		const instant = now ?? serverNow();
		return onAirBroadcastGraphicIds(
			liveState(screenId),
			graphics,
			graphic => timingFor(graphic as BroadcastGraphicConfig, instant),
		);
	}

	/**
	 * The lifecycle phase and elapsed time each on-air Broadcast Graphic renders.
	 *
	 * Keyed by Broadcast Graphic id, in exactly the shape the compositor takes, so every
	 * output and the Program monitor resolve one frame from one authoritative instant.
	 */
	function animationProjection(
		screenId: number,
		graphics: readonly BroadcastGraphicConfig[],
		now?: number,
	): Record<string, { phase: GraphicAnimationPhase; elapsed: number }> {
		const state = liveState(screenId);
		const instant = now ?? serverNow();
		const projections: Record<string, { phase: GraphicAnimationPhase; elapsed: number }> = {};

		for (const graphic of graphics) {
			const projection = broadcastGraphicPhaseProjection(state, graphic.id, timingFor(graphic, instant));
			if (projection)
				projections[graphic.id] = projection;
		}

		return projections;
	}

	/**
	 * The rendering each Broadcast Graphic draws now, and the one an update is leaving.
	 *
	 * Not simply the accepted values: while an acceptance is coalescing behind an
	 * entrance, program still shows what the graphic entered with.
	 */
	function renderedInputValues(
		screenId: number,
		graphics: readonly BroadcastGraphicConfig[],
		now?: number,
	): {
		current: Record<string, Record<string, GraphicInputValue>>;
		outgoing: Record<string, Record<string, GraphicInputValue>>;
	} {
		const state = liveState(screenId);
		const instant = now ?? serverNow();
		const current: Record<string, Record<string, GraphicInputValue>> = {};
		const outgoing: Record<string, Record<string, GraphicInputValue>> = {};

		for (const graphic of graphics) {
			const rendered = broadcastGraphicRenderedInputs(
				state,
				graphic.id,
				graphic.inputs ?? [],
				timingFor(graphic, instant),
			);
			current[graphic.id] = rendered.current;
			if (rendered.outgoing)
				outgoing[graphic.id] = rendered.outgoing;
		}

		return { current, outgoing };
	}

	function cacheSession(session: BroadcastGraphicsLiveSessionResponse) {
		sessions.value.set(session.screenId, session);
	}

	function cacheCommandResult(result: BroadcastGraphicsCommandResult): BroadcastGraphicsLiveSessionResponse {
		cacheSession(result.session);
		return result.session;
	}

	async function loadSession(eventId: number, screenId: number): Promise<BroadcastGraphicsLiveSessionResponse | null> {
		return await executeAction(
			async () => {
				const session = await repository.getSession(eventId, screenId);
				cacheSession(session);
				return session;
			},
			{ loadingRef: loading, errorRef: error },
		);
	}

	/**
	 * Deliver one already-built command.
	 *
	 * The command arrives built, and that is load-bearing: this function may deliver
	 * it twice, and both deliveries have to be the same command. Building it here —
	 * inside the retry — would give the restatement a fresh command id, and the
	 * receipt that exists to recognise a repeated delivery could no longer see that
	 * it was one. For Take and Out that would be invisible, because applying either
	 * twice is indistinguishable from applying it once. For Update Graphic it would
	 * accept a staged Graphic Input set twice.
	 */
	async function deliverCommand(
		eventId: number,
		screenId: number,
		graphicId: string,
		command: BroadcastGraphicsCommand,
	): Promise<BroadcastGraphicsLiveSessionResponse | null> {
		const pendingKey = playoutKey(screenId, graphicId);
		pending.value.add(pendingKey);

		try {
			return await executeAction(
				async () => {
					const session = sessions.value.get(screenId) ?? await repository.getSession(eventId, screenId);

					try {
						return cacheCommandResult(await repository.sendCommand(eventId, screenId, session.id, command));
					}
					catch (failure) {
						// A conflict is what an epoch this client no longer shares looks
						// like: the Screen may have left and re-entered Broadcast Graphics
						// mode in another tab, ending the epoch under us. Without this the
						// operator's every Take would 409 until they reloaded the page —
						// a silent dead end on a live show. The snapshot is the authority
						// on which epoch is current, so reload and restate the intent once.
						if (!isConflict(failure))
							throw failure;

						const current = await repository.getSession(eventId, screenId);
						cacheSession(current);
						return cacheCommandResult(
							await repository.sendCommand(eventId, screenId, current.id, command),
						);
					}
				},
				{ errorRef: error },
			);
		}
		finally {
			pending.value.delete(pendingKey);
		}
	}

	function playoutCommand(
		type: 'Take' | 'Out',
		graphicId: string,
		cut: boolean,
	): BroadcastGraphicsCommand {
		return { commandId: randomCommandId(type), type, payload: { graphicId, cut } };
	}

	/** Take a Broadcast Graphic on air; `cut` skips its enter animation once one exists. */
	function take(eventId: number, screenId: number, graphicId: string, cut = false) {
		return deliverCommand(eventId, screenId, graphicId, playoutCommand('Take', graphicId, cut));
	}

	/** Take a Broadcast Graphic off air; `cut` skips its exit animation once one exists. */
	function out(eventId: number, screenId: number, graphicId: string, cut = false) {
		return deliverCommand(eventId, screenId, graphicId, playoutCommand('Out', graphicId, cut));
	}

	/** The Graphic Input state of one placed Broadcast Graphic, from the loaded snapshot. */
	function inputsState(screenId: number, graphicId: string): BroadcastGraphicInputsState {
		return broadcastGraphicInputsState(liveState(screenId), graphicId);
	}

	/**
	 * What Live Control shows for each declared Graphic Input: the latest bound
	 * value, the working value, and the accepted on-air value, kept apart.
	 */
	function inputTraces(screenId: number, graphic: BroadcastGraphicConfig): GraphicInputTrace[] {
		return graphicInputTraces(liveState(screenId), graphic.id, graphic);
	}

	/**
	 * The Graphic Input values an on-air Broadcast Graphic renders.
	 *
	 * Accepted values only. A Screen Output composing this graphic reads exactly
	 * these, so a staged edit can never appear on air by way of the compositor.
	 */
	function acceptedInputValues(
		screenId: number,
		graphic: BroadcastGraphicConfig,
	): Record<string, GraphicInputValue> {
		return acceptedGraphicInputValues(liveState(screenId), graphic.id, graphic.inputs ?? []);
	}

	/**
	 * Edit one Graphic Input's working value.
	 *
	 * The server accepts the working value, so a second operator's Live Control sees
	 * it immediately. Whether it also reaches air now is the input's On-air Update
	 * Policy, decided authoritatively rather than here.
	 */
	function setInput(
		eventId: number,
		screenId: number,
		graphicId: string,
		inputKey: string,
		value: GraphicInputValue,
	) {
		return deliverCommand(eventId, screenId, graphicId, {
			commandId: randomCommandId('Set Input'),
			type: 'Set Input',
			payload: { graphicId, inputKey, value },
		});
	}

	/**
	 * Accept this Broadcast Graphic's complete staged Graphic Input set.
	 *
	 * The acceptance revision is read once, here, and travels with the command: a
	 * restatement must name the same acceptance it originally superseded, or the
	 * sequence guard would be re-based onto whatever landed in the meantime and stop
	 * protecting the colleague it exists to protect. Cut Update is this same intent
	 * with the modifier set, which is why it shares the path and the command id.
	 */
	function updateGraphic(eventId: number, screenId: number, graphicId: string, cut = false) {
		return deliverCommand(eventId, screenId, graphicId, {
			commandId: randomCommandId('Update Graphic'),
			type: 'Update Graphic',
			payload: {
				graphicId,
				cut,
				basedOnAcceptedRevision: inputsState(screenId, graphicId).acceptedRevision,
			},
		});
	}

	async function applyRemoteCommand(data: MessageData<'broadcastGraphicsLiveSession:commandApplied'>) {
		const known = sessions.value.get(data.screenId);

		// Nothing loaded, or a different epoch entirely: the snapshot is the only
		// thing that can say which epoch this client should be following.
		if (!known || known.id !== data.sessionId) {
			await loadSession(data.eventId, data.screenId);
			return;
		}

		if (data.sequence <= known.sequence)
			return;

		if (data.sequence > known.sequence + 1) {
			await loadSession(data.eventId, data.screenId);
			return;
		}

		cacheSession({
			...known,
			sequence: data.sequence,
			currentState: data.currentState,
			updatedAt: new Date(data.timestamp),
		});
	}

	function $reset() {
		sessions.value.clear();
		pending.value.clear();
		loading.value = false;
		error.value = null;
	}

	return {
		sessions,
		loading,
		error,
		serverNow,
		playoutState,
		onAirGraphicIds,
		animationProjection,
		renderedInputValues,
		isPending,
		inputsState,
		inputTraces,
		acceptedInputValues,
		loadSession,
		take,
		out,
		setInput,
		updateGraphic,
		applyRemoteCommand,
		$reset,
	};
});
