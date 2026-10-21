import type { MaybeRefOrGetter, Ref } from 'vue';
import type { useAsyncAction } from '~/composables/core/useAsyncAction';
import type { MtgCard } from '~/types/card/mtg';
import type { MessageData } from '~/types/realtime';
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
 * Owns active Screen Card persistence, its local Card Timeout, and realtime
 * application for the currently selected Screen.
 *
 * A Card's expiry is a clock projection (ADR-0022): this client holds a timed
 * Card only until server time reaches its `timeoutStartTimestamp +
 * timeoutDuration`, then hides it. It never asks the server to clear it, on the
 * operator Card page or in a rendering; `clearActiveCard` is the operator's
 * explicit Clear only. A Card that arrives already expired is held as no Card.
 *
 * A Card read is a Flight: it lands only while nothing newer has reached the
 * held Card since it began (#704). A newer read, a `card:updated` or
 * `card:cleared` for the selected Screen, an accepted local save or clear, a
 * Screen selection and the store reset that ends the Event Lifetime each
 * supersede it before they touch the Card, so a late answer can neither replace
 * what they put there nor arm a timer that would later hide it. A failed
 * clear's rollback supersedes nothing.
 */
export function useActiveCardScreenRuntime(state: ActiveCardRuntimeState) {
	const { saveScreenCard, getScreenCard, deleteScreenCard } = useCardRepository();
	const { getServerTime } = useServerTime();
	let cardTimeoutId: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Set when this client is a rendering of the Screen rather than its operator
	 * (#604): the Card is read through the Screen's capability-scoped read.
	 */
	let screenOutputRead: (() => Promise<MtgCard | null>) | null = null;
	const reads = createGuardedSequence();
	/**
	 * Card reads and saves still out. `state.loading` is true while any is, so a
	 * superseded read neither leaves it stuck nor turns it off under a save.
	 */
	let requestsOut = 0;

	async function whileLoading<T>(request: () => Promise<T>) {
		requestsOut++;
		state.loading.value = true;
		try {
			return await request();
		}
		finally {
			requestsOut--;
			state.loading.value = requestsOut > 0;
		}
	}

	/** Hold a Card, arming its hiding from its own timeout data; an expired Card is held as none. */
	function holdCard(card: MtgCard | null) {
		if (card && !isExpired(card)) {
			state.activeCard.value = card;
			updateTimeout(card);
			scheduleLocalTimeout(card);
		}
		else {
			state.activeCard.value = null;
			state.timeout.reset();
			clearCardTimeout();
		}
	}

	function remainingMs(card: MtgCard) {
		if (!card.timeoutData)
			return Infinity;
		const { timeoutStartTimestamp, timeoutDuration } = card.timeoutData;
		return timeoutDuration - (getServerTime() - timeoutStartTimestamp);
	}

	function isExpired(card: MtgCard) {
		return remainingMs(card) <= 0;
	}

	/** Install the rendering's Card read; the answer uninstalls it when the rendering goes away. */
	function readAsScreenOutput(read: () => Promise<MtgCard | null>) {
		screenOutputRead = read;
		return () => {
			if (screenOutputRead === read)
				screenOutputRead = null;
		};
	}

	/** The held Card's Card Timeout ran out: hide it here, and write nothing (ADR-0022). */
	function expireCard() {
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
		reads.supersede();
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

	function updateTimeout(cardData: MtgCard) {
		if (!cardData.timeoutData) {
			state.timeout.reset();
			return;
		}
		state.timeout.start(Math.round(remainingMs(cardData) / 1000));
	}

	/** Hide the held Card when its Card Timeout runs out, on the shared clock. */
	function scheduleLocalTimeout(cardData: MtgCard) {
		// Replacing a timed card with an untimed card must cancel the old timer too.
		clearCardTimeout();
		if (!cardData.timeoutData)
			return;
		cardTimeoutId = setTimeout(() => {
			expireCard();
			cardTimeoutId = null;
		}, Math.max(0, remainingMs(cardData)));
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
		return state.executeAction(
			async () => {
				const card = await whileLoading(async () => screenOutputRead ? await screenOutputRead() : await getScreenCard(eventId, screenId));
				// Something newer reached the Card while this read was out: it lands nothing.
				// The ids are checked too, because the Card page's Screen picker writes
				// `activeScreenId` before its watcher selects the Screen.
				if (flight.stale || currentEventId() !== eventId || state.activeScreenId.value !== screenId)
					return null;
				holdCard(card);
				return card;
			},
			// A superseded read's failure describes nothing still held.
			{ errorRef: state.error, flight },
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
				await whileLoading(async () => saveScreenCard(eventId, screenId, cardData));
				if (currentEventId() !== eventId || state.activeScreenId.value !== screenId)
					return cardData;
				reads.supersede();
				holdCard(cardData);
				return cardData;
			},
			{ errorRef: state.error },
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
			reads.supersede();
			holdCard(data.card);
		}
	}

	function applyRemoteCleared(data: MessageData<'card:cleared'>) {
		const eventId = currentEventId();
		if (eventId && data.eventId === eventId && isMessageForActiveScreen(data))
			resetActiveCardState();
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
	};
}
