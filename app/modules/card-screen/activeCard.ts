import type { MaybeRefOrGetter, Ref } from 'vue';
import type { useAsyncAction } from '~/composables/core/useAsyncAction';
import type { MtgCard } from '~/types/card/mtg';
import type { MessageData } from '~/types/realtime';
import { onScopeDispose, toValue } from 'vue';

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
 */
export function useActiveCardScreenRuntime(state: ActiveCardRuntimeState) {
	const { saveScreenCard, getScreenCard, deleteScreenCard } = useCardRepository();
	const { getServerTime } = useServerTime();
	let cardTimeoutId: ReturnType<typeof setTimeout> | null = null;

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
			if (state.activeCard.value)
				void clearActiveCard();
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
		return state.executeAction(
			async () => {
				const card = await getScreenCard(eventId, screenId);
				if (currentEventId() !== eventId || state.activeScreenId.value !== screenId) {
					return null;
				}
				state.activeCard.value = card;
				if (card) {
					updateTimeout(card);
					scheduleLocalTimeout(card);
				}
				else {
					resetActiveCardState();
				}
				return card;
			},
			{ loadingRef: state.loading, errorRef: state.error },
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
				state.activeCard.value = null;
				state.timeout.reset();
				clearCardTimeout();
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
		if (eventId && data.eventId === eventId && isMessageForActiveScreen(data)) {
			state.activeCard.value = null;
			state.timeout.reset();
			clearCardTimeout();
		}
	}

	function applyRemoteTimeout(data: MessageData<'card:timeout'>) {
		const eventId = currentEventId();
		if (eventId && data.eventId === eventId && isMessageForActiveScreen(data)) {
			const remainingMs = Math.max(0, data.expiresAt - getServerTime());
			if (remainingMs > 0) {
				state.timeout.start(Math.round(remainingMs / 1000));
				clearCardTimeout();
				cardTimeoutId = setTimeout(() => {
					if (state.activeCard.value)
						void clearActiveCard();
					cardTimeoutId = null;
				}, remainingMs);
			}
		}
	}

	function applyRemoteTimeoutCancel(data: MessageData<'card:timeout:cancel'>) {
		const eventId = currentEventId();
		if (eventId && data.eventId === eventId && isMessageForActiveScreen(data)) {
			state.timeout.reset();
			clearCardTimeout();
		}
	}

	onScopeDispose(() => clearCardTimeout());

	return {
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
