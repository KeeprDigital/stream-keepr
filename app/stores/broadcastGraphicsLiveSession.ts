import type {
	BroadcastGraphicInputsState,
	BroadcastGraphicPhaseTiming,
	BroadcastGraphicsLiveState,
	BroadcastGraphicsRecoveryFault,
	BroadcastGraphicsRejectionCode,
	GraphicInputTrace,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type { GraphicSourceSelectionsState } from '~~/shared/modules/graphics';
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
	BROADCAST_GRAPHICS_REJECTION_CODES,
	broadcastGraphicInputsState,
	broadcastGraphicPhaseProjection,
	broadcastGraphicPhaseTiming,
	broadcastGraphicPlayoutState,
	broadcastGraphicRenderedInputs,
	broadcastGraphicSourceSelections,
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
	/**
	 * The Graphic Inputs whose last edit from this session lost a field-scoped
	 * conflict, and have therefore been refreshed from the authoritative snapshot.
	 *
	 * Local to this operator's session, never live state: whose edit was refused is a
	 * fact about this client, and marking the field in a colleague's Live Control —
	 * where their edit is the one that won — would be exactly backwards.
	 */
	const supersededInputs = ref<Set<string>>(new Set());

	function playoutKey(screenId: number, graphicId: string): string {
		return `${screenId}:${graphicId}`;
	}

	function inputKeyOf(screenId: number, graphicId: string, inputKey: string): string {
		return `${screenId}:${graphicId}:${inputKey}`;
	}

	/**
	 * Forget this Screen's refused-edit markers, and only this Screen's.
	 *
	 * A marker says "your last edit to this field was superseded", which stops being
	 * true once the epoch holding the winning value is gone. That is a fact about one
	 * Screen: an operator working two Screens must not have one Screen's reset wipe
	 * what the other is telling them.
	 */
	function forgetSupersededInputs(screenId: number) {
		for (const key of [...supersededInputs.value]) {
			if (key.startsWith(`${screenId}:`))
				supersededInputs.value.delete(key);
		}
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

	/** The domain refusal code a rejected command carried, when it carried one. */
	function rejectionCode(failure: unknown): BroadcastGraphicsRejectionCode | undefined {
		if (typeof failure !== 'object' || failure === null || !('data' in failure))
			return undefined;
		const data = (failure as { data?: { code?: string } }).data;
		return BROADCAST_GRAPHICS_REJECTION_CODES.includes(data?.code as BroadcastGraphicsRejectionCode)
			? data!.code as BroadcastGraphicsRejectionCode
			: undefined;
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
	 * forbids, arriving through the clock. It can also jump *backwards*: a settled graphic
	 * read on a clock that is ahead of the authoritative one, then corrected, re-enters a
	 * phase it had already finished. Holding the resting state instead costs an entrance
	 * that pops on rather than animating, for the length of one sync (three samples fifty
	 * milliseconds apart) after a load. A missed entrance is a blemish; a replayed or
	 * rewound one mid-show is a fault.
	 *
	 * Note that `isSynced` means "has synced at least once", not "is currently in sync" —
	 * `lastSyncedAt` is not consulted, so a browser whose clock drifts after a successful
	 * sync reads as synced until the next one. That is the case the magnitude bound inside
	 * the shared projection covers, and the reason it is kept rather than treated as
	 * redundant once the offset exists.
	 */
	function timingFor(
		graphic: Pick<BroadcastGraphicConfig, 'items' | 'animation'>,
		now: number,
	): BroadcastGraphicPhaseTiming | undefined {
		return isClockSynced.value ? broadcastGraphicPhaseTiming(graphic, now) : undefined;
	}

	/**
	 * The timing *which rendering is on screen* is answered against — supplied even while
	 * the clock is unsynced, unlike the timing motion is answered against.
	 *
	 * The two questions are not equally dangerous on a clock this browser has not
	 * checked. Motion is sampled every frame, so a wrong clock there means a phase pinned
	 * and then replayed. Which values are showing is a single, non-animating choice
	 * between two renderings, and the update chain carries its own magnitude bound: a
	 * reader further from the authoritative clock than the deferral could possibly last
	 * falls through to the accepted set rather than stalling on the old rendering.
	 *
	 * Which is why this is not simply routed through the unsynced hold. An absent timing
	 * makes `broadcastGraphicRenderedInputs` answer with the accepted set, and while an
	 * acceptance is coalescing behind an entrance the accepted set is exactly what must
	 * not* be on screen yet — so holding here would quietly skip the coalescing deferral
	 * rather than being conservative about it. Answering "old rendering" instead would be
	 * worse again: nothing clears `updateStartedAt` when an update merely completes, so a
	 * chain existing usually means one finished long ago, and a reader with no clock would
	 * show stale content indefinitely. Bounding the chain and reading it is the only one
	 * of the three that is right in both directions.
	 */
	function renderTimingFor(
		graphic: Pick<BroadcastGraphicConfig, 'items' | 'animation'>,
		now: number,
	): BroadcastGraphicPhaseTiming {
		return broadcastGraphicPhaseTiming(graphic, now);
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
				renderTimingFor(graphic, instant),
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
		/** What to do about a domain refusal before it is surfaced to the operator. */
		onRejection?: (code: BroadcastGraphicsRejectionCode) => void | Promise<void>,
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
						// A domain refusal is the server saying this command is wrong about the
						// show — a stale acceptance, an overtaken field, a required value that
						// is missing. Restating it would only be refused again, and for a
						// field-scoped conflict that second delivery would arrive after the
						// refresh and race it. So these are handled and surfaced, never retried.
						const code = rejectionCode(failure);
						if (code) {
							await onRejection?.(code);
							throw failure;
						}

						// A bare conflict is what an epoch this client no longer shares looks
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

	/** Which entity each of this Broadcast Graphic's Graphic Source Selections names. */
	function sourceSelections(screenId: number, graphicId: string): GraphicSourceSelectionsState {
		return broadcastGraphicSourceSelections(liveState(screenId), graphicId);
	}

	/**
	 * What Live Control shows for each declared Graphic Input: the latest bound
	 * value, any Graphic Input Override masking it, the working value, and the
	 * accepted on-air value, kept apart.
	 *
	 * Whether the graphic is on air is derived here rather than asked of the caller,
	 * because it is what separates a held stale value from a plainly unavailable one
	 * and a caller getting it wrong would mislabel what program is showing.
	 */
	function inputTraces(
		screenId: number,
		graphic: BroadcastGraphicConfig,
		/** The latest values this graphic's Graphic Input Bindings resolve. */
		boundValues: Readonly<Record<string, GraphicInputValue>> = {},
	): GraphicInputTrace[] {
		const state = playoutState(screenId, graphic.id);
		return graphicInputTraces(liveState(screenId), graphic.id, graphic, boundValues, {
			onAir: state !== 'off' && state !== 'waiting',
			supersededInputKeys: (graphic.inputs ?? [])
				.map(declaration => declaration.key)
				.filter(key => supersededInputs.value.has(inputKeyOf(screenId, graphic.id, key))),
		});
	}

	/**
	 * Why this Screen's durable live state could not be trusted, when it could not.
	 *
	 * A recovery fault is not an action failure, so it deliberately does not travel
	 * in `error`: the command an operator just issued may have succeeded perfectly
	 * while the session it landed in is still the one that had to be recovered. Live
	 * Control has to be able to say both things at once.
	 */
	function recoveryFault(screenId: number): BroadcastGraphicsRecoveryFault | null {
		return sessions.value.get(screenId)?.recoveryFault ?? null;
	}

	/**
	 * Reset this Screen's live state: every Broadcast Graphic off, and a new epoch.
	 *
	 * The way back from a recovery fault, and the only action that deliberately
	 * discards prepared Graphic Input values — so the superseded-field markers this
	 * session was holding go with them.
	 */
	async function resetLiveState(eventId: number, screenId: number) {
		return await executeAction(
			async () => {
				const session = await repository.resetSession(eventId, screenId);
				cacheSession(session);
				forgetSupersededInputs(screenId);
				return session;
			},
			{ loadingRef: loading, errorRef: error },
		);
	}

	/**
	 * A Screen's playout epoch has been replaced.
	 *
	 * Nothing here is applied: everything this client holds for that Screen belongs
	 * to the epoch that ended, so the snapshot is the only thing that can say what
	 * the show looks like now. A client holding nothing for the Screen has nothing to
	 * correct and deliberately does not open an epoch just to hear about one ending.
	 */
	async function applyEpochEnded(data: MessageData<'broadcastGraphicsLiveSession:epochEnded'>) {
		if (!sessions.value.has(data.screenId))
			return;

		// Dropped before the reload rather than after it. The ended epoch's state may
		// have graphics on air, and if the reload fails — the Screen has left Broadcast
		// Graphics mode, which is one of the ways an epoch ends — keeping it cached
		// would leave every output rendering a show that is over.
		sessions.value.delete(data.screenId);
		forgetSupersededInputs(data.screenId);
		await loadSession(data.eventId, data.screenId);
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
		/**
		 * The value this operator was editing away from: the Field Ownership claim.
		 *
		 * Required rather than derived here, because the honest claim is the value the
		 * operator was actually shown — which is the working value *resolved against the
		 * declaration's default*, and the declarations live with the caller. Deriving it
		 * from stored values alone would send no claim at all for an input nobody has
		 * edited yet, and that is precisely the case a second operator's first edit
		 * falls into: it would silently overwrite the first operator's.
		 *
		 * Leaving it to the caller is also what keeps this correct now that the layers
		 * above the working value have arrived: a Graphic Input Override and a resolved
		 * binding change *what the operator was shown* without changing anything here.
		 * Live Control passes the effective value for exactly that reason.
		 */
		basedOnValue: GraphicInputValue,
	) {
		supersededInputs.value.delete(inputKeyOf(screenId, graphicId, inputKey));

		return deliverCommand(
			eventId,
			screenId,
			graphicId,
			{
				commandId: randomCommandId('Set Input'),
				type: 'Set Input',
				payload: { graphicId, inputKey, value, basedOn: { value: basedOnValue } },
			},
			async (code) => {
				if (code !== 'stale-input-edit')
					return;

				// Rejected and refreshed, which is the whole point: the operator gets the
				// value that actually landed rather than having silently overwritten it,
				// and the field is marked so the refresh does not read as their own edit
				// being accepted.
				supersededInputs.value.add(inputKeyOf(screenId, graphicId, inputKey));
				await loadSession(eventId, screenId);
			},
		);
	}

	/**
	 * Mask one Graphic Input's binding with an operator's own value, or clear the mask.
	 *
	 * A separate command from an ordinary edit because it is a separate thing: the
	 * binding underneath keeps resolving, so clearing resumes whatever it resolves
	 * then rather than whatever it resolved when the override was set.
	 */
	function setOverride(
		eventId: number,
		screenId: number,
		graphicId: string,
		inputKey: string,
		value: GraphicInputValue,
		/**
		 * The value this override replaces: the same Field Ownership claim a working edit
		 * carries, for the same reason. Absent for a clear, which is not an edit away from
		 * a value an operator was reading but the removal of a mask — and which must
		 * therefore never be refused.
		 */
		basedOnValue?: GraphicInputValue,
	) {
		supersededInputs.value.delete(inputKeyOf(screenId, graphicId, inputKey));

		return deliverCommand(
			eventId,
			screenId,
			graphicId,
			{
				commandId: randomCommandId('Set Override'),
				type: 'Set Override',
				payload: {
					graphicId,
					inputKey,
					value,
					...(basedOnValue === undefined ? {} : { basedOn: { value: basedOnValue } }),
				},
			},
			async (code) => {
				if (code !== 'stale-input-edit')
					return;

				// Same treatment as a refused working edit: the operator gets the value that
				// actually landed, and the field is marked so the refresh does not read as
				// their own override having been accepted.
				supersededInputs.value.add(inputKeyOf(screenId, graphicId, inputKey));
				await loadSession(eventId, screenId);
			},
		);
	}

	/**
	 * Point one Graphic Source Selection at an entity, or clear it with `null`.
	 *
	 * Every Graphic Input Binding reading that selection re-resolves authoritatively,
	 * and each input's On-air Update Policy decides which resolved values reach air
	 * now — which is why this is a command rather than local state.
	 */
	function selectSource(
		eventId: number,
		screenId: number,
		graphicId: string,
		sourceKey: string,
		selectionId: number | null,
	) {
		return deliverCommand(eventId, screenId, graphicId, {
			commandId: randomCommandId('Select Source'),
			type: 'Select Source',
			payload: { graphicId, sourceKey, selectionId },
		});
	}

	/**
	 * Tell the server that Event Data this Broadcast Graphic's bindings read has moved.
	 *
	 * It carries no value: the server re-resolves the bindings itself, so what reaches
	 * air is a fact about Event Data rather than this client's reading of it. Whether
	 * anything reaches air is each input's On-air Update Policy — a live one applies
	 * now, a staged one waits for Update Graphic.
	 */
	function resolveBindings(eventId: number, screenId: number, graphicId: string) {
		return deliverCommand(eventId, screenId, graphicId, {
			commandId: randomCommandId('Resolve Bindings'),
			type: 'Resolve Bindings',
			payload: { graphicId },
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

		// While a recovery fault is held, no notification may be applied in place.
		// The fault is a property of the durable state, and a notification carries
		// only the state — so patching incrementally would advance the sequence while
		// leaving the fault asserted forever. That is the worst possible reading for
		// an operator: the colleague's Take has recovered the session and put graphics
		// on air, and this client would still be showing "nothing is on air, take
		// something" over a live show. The snapshot carries both facts together, so
		// reloading is the only answer that keeps them consistent. It costs one fetch
		// per client per incident, because the first accepted command clears the fault.
		if (known.recoveryFault) {
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
		supersededInputs.value.clear();
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
		sourceSelections,
		acceptedInputValues,
		recoveryFault,
		loadSession,
		take,
		out,
		setInput,
		setOverride,
		selectSource,
		resolveBindings,
		updateGraphic,
		resetLiveState,
		applyRemoteCommand,
		applyEpochEnded,
		$reset,
	};
});
