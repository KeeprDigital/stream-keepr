import type {
	BroadcastGraphicInputsState,
	BroadcastGraphicsLiveState,
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
	GraphicInputValue,
	GraphicPlayoutState,
} from '~~/shared/types/graphics';
import type { MessageData } from '~/types/realtime';
import {
	acceptedGraphicInputValues,
	broadcastGraphicInputsState,
	broadcastGraphicPlayoutState,
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
		});
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
	) {
		return deliverCommand(eventId, screenId, graphicId, {
			commandId: randomCommandId('Set Override'),
			type: 'Set Override',
			payload: { graphicId, inputKey, value },
		});
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
		playoutState,
		onAirGraphicIds,
		isPending,
		inputsState,
		inputTraces,
		sourceSelections,
		acceptedInputValues,
		loadSession,
		take,
		out,
		setInput,
		setOverride,
		selectSource,
		resolveBindings,
		updateGraphic,
		applyRemoteCommand,
		$reset,
	};
});
