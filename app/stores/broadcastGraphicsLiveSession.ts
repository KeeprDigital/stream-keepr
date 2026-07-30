import type {
	BroadcastGraphicInputsState,
	BroadcastGraphicsLiveState,
	BroadcastGraphicsRecoveryFault,
	BroadcastGraphicsRejectionCode,
	GraphicInputTrace,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import type {
	BroadcastGraphicConfig,
	GraphicInputValue,
	GraphicPlayoutState,
} from '~~/shared/types/graphics';
import type { MessageData } from '~/types/realtime';
import {
	acceptedGraphicInputValues,
	BROADCAST_GRAPHICS_REJECTION_CODES,
	broadcastGraphicInputsState,
	broadcastGraphicPlayoutState,
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

	/** The Graphic Playout State of one placed Broadcast Graphic. */
	function playoutState(screenId: number, graphicId: string): GraphicPlayoutState {
		return broadcastGraphicPlayoutState(liveState(screenId), graphicId);
	}

	/** Which Broadcast Graphics compose into the Screen's frame, in authored stack order. */
	function onAirGraphicIds(
		screenId: number,
		graphics: readonly Pick<BroadcastGraphicConfig, 'id'>[],
	): string[] {
		return onAirBroadcastGraphicIds(liveState(screenId), graphics);
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

	/**
	 * What Live Control shows for each declared Graphic Input: the latest bound
	 * value, the working value, and the accepted on-air value, kept apart.
	 */
	function inputTraces(screenId: number, graphic: BroadcastGraphicConfig): GraphicInputTrace[] {
		return graphicInputTraces(
			liveState(screenId),
			graphic.id,
			graphic,
			{},
			(graphic.inputs ?? [])
				.map(declaration => declaration.key)
				.filter(key => supersededInputs.value.has(inputKeyOf(screenId, graphic.id, key))),
		);
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
		 * Leaving it to the caller is also what keeps this correct as the layers above
		 * the working value arrive: an override and a resolved binding change *what the
		 * operator was shown* without changing anything here.
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
		playoutState,
		onAirGraphicIds,
		isPending,
		inputsState,
		inputTraces,
		acceptedInputValues,
		recoveryFault,
		loadSession,
		take,
		out,
		setInput,
		updateGraphic,
		resetLiveState,
		applyRemoteCommand,
		applyEpochEnded,
		$reset,
	};
});
