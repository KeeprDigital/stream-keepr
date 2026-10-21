import type { MaybeRefOrGetter, Ref } from 'vue';
import type { useAsyncAction } from '~/composables/core/useAsyncAction';
import type { MtgCard } from '~/types/card/mtg';
import type { MessageData } from '~/types/realtime';
import type { Flight } from '~/utils/guardedSequence';
import { onScopeDispose, toValue } from 'vue';
import { createGuardedSequence } from '~/utils/guardedSequence';

type ExecuteAction = ReturnType<typeof useAsyncAction>['executeAction'];

interface CountdownController {
	reset: () => void;
	start: (seconds: number) => void;
}

interface ActiveCardRuntimeState {
	eventId: MaybeRefOrGetter<number | null | undefined>;
	activeScreenId: Ref<number | null>;
	activeCard: Ref<MtgCard | null>;
	timeout: CountdownController;
	loading: Ref<boolean>;
	error: Ref<string | null>;
	executeAction: ExecuteAction;
}

/**
 * Active Card Screen runtime Module.
 *
 * Owns active Card Screen persistence, local timeout cleanup, and realtime
 * application for the currently selected Screen.
 *
 * A Card read is a Flight: it lands only while nothing about the Card has
 * reached this owner since it began (#704). A newer read, a realtime Card
 * message, an accepted local save or clear, a Screen selection and the end of
 * the Event Lifetime each supersede it, before they touch the Card, so a late
 * answer can neither replace what they put there nor arm a timer that would
 * later clear it.
 */
export function useActiveCardScreenRuntime(state: ActiveCardRuntimeState) {
	const { saveScreenCard, getScreenCard, deleteScreenCard } = useCardRepository();
	const { getServerTime } = useServerTime();
	let cardTimeoutId: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Set when this client is a rendering of the Screen rather than its operator
	 * (#604): the Card is read through the Screen's capability-scoped read, and an
	 * expired Card is hidden here rather than cleared on the server — an output
	 * must not change live state by watching it, and the server's own timeout
	 * clears the Card and announces it.
	 */
	let screenOutputRead: (() => Promise<MtgCard | null>) | null = null;
	const reads = createGuardedSequence();
	/** The read whose answer `state.loading` waits on, while it is current. */
	let pendingRead: Flight | null = null;

	/**
	 * Supersede any Card read in flight: called before every change to the held
	 * Card or its timer that is not a read's own answer.
	 */
	function supersedeReads() {
		if (pendingRead?.current)
			state.loading.value = false;
		pendingRead = null;
		reads.supersede();
	}

	/** Install the rendering's Card read; the answer uninstalls it when the rendering goes away. */
	function readAsScreenOutput(read: () => Promise<MtgCard | null>) {
		screenOutputRead = read;
		return () => {
			if (screenOutputRead === read)
				screenOutputRead = null;
		};
	}

	function expireCard() {
		if (!state.activeCard.value)
			return;
		if (!screenOutputRead) {
			void clearActiveCard();
			return;
		}
		state.activeCard.value = null;
		state.timeout.reset();
	}

	function currentEventId() {
		return toValue(state.eventId) ?? null;
	}

	function clearCardTimeout() {
		if (cardTimeoutId !== null) {
			clearTimeout(cardTimeoutId);
			cardTimeoutId = null;
		}
	}

	function resetActiveCardState() {
		supersedeReads();
		state.activeCard.value = null;
		state.timeout.reset();
		clearCardTimeout();
	}

	function setActiveScreen(screenId: number | null) {
		state.activeScreenId.value = screenId;
		resetActiveCardState();
	}

	function isMessageForActiveScreen(messageData?: { screenId?: number }) {
		if (!messageData)
			return false;
		return state.activeScreenId.value !== null && messageData.screenId === state.activeScreenId.value;
	}

	function updateTimeout(cardData: MtgCard | null) {
		if (!cardData || !cardData.timeoutData) {
			state.timeout.reset();
			return;
		}
		const { timeoutStartTimestamp, timeoutDuration } = cardData.timeoutData;
		const remainingMs = timeoutDuration - (getServerTime() - timeoutStartTimestamp);
		if (remainingMs <= 0) {
			state.timeout.reset();
			return;
		}
		state.timeout.start(Math.round(remainingMs / 1000));
	}

	/**
	 * Set up a local setTimeout to auto-clear the card when timeout expires.
	 * Needed because realtime self-origin messages are ignored.
	 */
	function scheduleLocalTimeout(cardData: MtgCard) {
		// Replacing a timed card with an untimed card must cancel the old timer too.
		clearCardTimeout();
		if (!cardData.timeoutData)
			return;
		const { timeoutDuration, timeoutStartTimestamp } = cardData.timeoutData;
		const remainingMs = Math.max(0, timeoutDuration - (getServerTime() - timeoutStartTimestamp));
		// A short timeout may expire while the save/reload request is in flight.
		// Scheduling at zero still performs the authoritative DELETE; silently
		// skipping it would leave the expired card visible until another reload.
		cardTimeoutId = setTimeout(() => {
			expireCard();
			cardTimeoutId = null;
		}, remainingMs);
	}

	async function loadActiveCard() {
		const eventId = currentEventId();
		if (!eventId) {
			state.error.value = 'No event loaded';
			return null;
		}
		if (!state.activeScreenId.value) {
			resetActiveCardState();
			return null;
		}
		const screenId = state.activeScreenId.value;
		const flight = reads.begin();
		pendingRead = flight;
		return state.executeAction(
			async () => {
				let card: MtgCard | null;
				try {
					card = screenOutputRead ? await screenOutputRead() : await getScreenCard(eventId, screenId);
				}
				finally {
					if (pendingRead === flight)
						pendingRead = null;
				}
				// Something newer reached the Card while this read was out: it lands nothing.
				if (flight.stale || currentEventId() !== eventId || state.activeScreenId.value !== screenId)
					return null;
				state.activeCard.value = card;
				if (card) {
					updateTimeout(card);
					scheduleLocalTimeout(card);
				}
				else {
					state.timeout.reset();
					clearCardTimeout();
				}
				return card;
			},
			{ loadingRef: state.loading, errorRef: state.error, flight },
		);
	}

	async function saveActiveCard(cardData: MtgCard) {
		const eventId = currentEventId();
		if (!eventId) {
			state.error.value = 'No event loaded';
			return null;
		}
		if (!state.activeScreenId.value) {
			state.error.value = 'No screen selected';
			return null;
		}
		const screenId = state.activeScreenId.value;
		return state.executeAction(
			async () => {
				await saveScreenCard(eventId, screenId, cardData);
				if (currentEventId() !== eventId || state.activeScreenId.value !== screenId)
					return cardData;
				supersedeReads();
				state.activeCard.value = cardData;
				updateTimeout(cardData);
				scheduleLocalTimeout(cardData);
				return cardData;
			},
			{ loadingRef: state.loading, errorRef: state.error },
		);
	}

	async function clearActiveCard() {
		const eventId = currentEventId();
		if (!eventId) {
			state.error.value = 'No event loaded';
			return null;
		}
		if (!state.activeScreenId.value) {
			state.error.value = 'No screen selected';
			return null;
		}
		const screenId = state.activeScreenId.value;
		const original = state.activeCard.value;
		return state.executeAction(
			async () => {
				await deleteScreenCard(eventId, screenId);
				if (currentEventId() !== eventId || state.activeScreenId.value !== screenId)
					return;
				resetActiveCardState();
			},
			{
				errorRef: state.error,
				onError: () => {
					if (currentEventId() === eventId && state.activeScreenId.value === screenId)
						state.activeCard.value = original;
				},
			},
		);
	}

	function applyRemoteUpdated(data: MessageData<'card:updated'>) {
		const eventId = currentEventId();
		if (eventId && data.eventId === eventId && isMessageForActiveScreen(data)) {
			supersedeReads();
			state.activeCard.value = data.card;
			if (data.card) {
				updateTimeout(data.card);
				scheduleLocalTimeout(data.card);
			}
			else {
				state.timeout.reset();
				clearCardTimeout();
			}
		}
	}

	function applyRemoteCleared(data: MessageData<'card:cleared'>) {
		const eventId = currentEventId();
		if (eventId && data.eventId === eventId && isMessageForActiveScreen(data))
			resetActiveCardState();
	}

	function applyRemoteTimeout(data: MessageData<'card:timeout'>) {
		const eventId = currentEventId();
		if (eventId && data.eventId === eventId && isMessageForActiveScreen(data)) {
			supersedeReads();
			const remainingMs = Math.max(0, data.expiresAt - getServerTime());
			if (remainingMs > 0) {
				state.timeout.start(Math.round(remainingMs / 1000));
				clearCardTimeout();
				cardTimeoutId = setTimeout(() => {
					expireCard();
					cardTimeoutId = null;
				}, remainingMs);
			}
		}
	}

	function applyRemoteTimeoutCancel(data: MessageData<'card:timeout:cancel'>) {
		const eventId = currentEventId();
		if (eventId && data.eventId === eventId && isMessageForActiveScreen(data)) {
			supersedeReads();
			state.timeout.reset();
			clearCardTimeout();
		}
	}

	onScopeDispose(() => clearCardTimeout());

	return {
		readAsScreenOutput,
		clearCardTimeout,
		resetActiveCardState,
		setActiveScreen,
		loadActiveCard,
		saveActiveCard,
		clearActiveCard,
		applyRemoteUpdated,
		applyRemoteCleared,
		applyRemoteTimeout,
		applyRemoteTimeoutCancel,
	};
}
