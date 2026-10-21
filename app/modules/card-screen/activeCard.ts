import type { MaybeRefOrGetter, Ref } from 'vue';
import type { useAsyncAction } from '~/composables/core/useAsyncAction';
import type { MtgCard } from '~/types/card/mtg';
import type { MessageData } from '~/types/realtime';
import type { Flight } from '~/utils/guardedSequence';
import { onScopeDispose, toValue } from 'vue';
import { cardTimeoutRemainingMs } from '~~/shared/utils/card/timeout';
import { createGuardedSequence } from '~/utils/guardedSequence';

/**
 * How a Card read ended. Only `'landed'` holds what it read; Event Data Resync
 * counts nothing else as re-read (ADR-0028).
 */
export type CardReadOutcome = 'landed' | 'superseded' | 'failed';

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
 * Owns active Screen Card persistence, hiding it here when its Card Timeout
 * runs out, and realtime application for the currently selected Screen.
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
 * what they put there nor arm a timer that would later hide it.
 *
 * A Card save or Clear is not: it is the operator's, and is sent whatever
 * arrives meanwhile. Its continuation — holding the saved Card, clearing the
 * held one, reporting its failure — belongs to the Screen selection it began
 * in. A selection is a Flight. Selecting a Screen begins a new one, and so does
 * the store reset that ends the Event Lifetime (ADR-0024). So a write answered after A → B → A, or after
 * leaving its Screen and coming back, touches nothing the fresh load holds. The
 * caller still receives its answer. A Clear changes nothing it holds until its
 * `DELETE` succeeds, so a failed one has nothing to roll back, and whatever
 * the store accepted meanwhile stands (#726).
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
	/** The Screen selection, within the Event Lifetime, a write's continuation belongs to. */
	const selections = createGuardedSequence();
	let selection = selections.begin();
	/** The Event Lifetime a request's effect on `state.loading` belongs to. */
	const lifetimes = createGuardedSequence();
	let lifetime = lifetimes.begin();
	/**
	 * Card reads and saves still out in this Event Lifetime. `state.loading` is
	 * true while any is, so a superseded read neither leaves it stuck nor turns it
	 * off under a save, and a request from an ended lifetime touches it no more.
	 */
	let requestsOut = 0;

	async function whileLoading<T>(request: () => Promise<T>) {
		const flight = lifetime;
		requestsOut++;
		state.loading.value = true;
		try {
			return await request();
		}
		finally {
			if (flight.current) {
				requestsOut--;
				state.loading.value = requestsOut > 0;
			}
		}
	}

	/** Whether a continuation begun in `flight` for this Event and Screen may still touch the store. */
	function stillSelected(flight: Flight, eventId: number, screenId: number) {
		// The ids are checked too, because the Card page's Screen picker writes
		// `activeScreenId` before its watcher selects the Screen.
		return flight.current && currentEventId() === eventId && state.activeScreenId.value === screenId;
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
		return cardTimeoutRemainingMs(card.timeoutData, getServerTime());
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
		selection = selections.begin();
		state.activeScreenId.value = screenId;
		resetActiveCardState();
	}

	/** The store reset ends the Event Lifetime: nothing still out touches the next one. */
	function endLifetime() {
		selection = selections.begin();
		lifetime = lifetimes.begin();
		requestsOut = 0;
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

	/**
	 * Read the selected Screen's Card. The answer says whether the read landed:
	 * `'landed'` when it is held, a read of no Card included; `'superseded'` when
	 * something newer reached the Card first, so it holds nothing; `'failed'`
	 * when it did not answer, which `state.error` reports.
	 */
	async function loadActiveCard(): Promise<CardReadOutcome> {
		const eventId = currentEventId();
		if (!eventId) {
			state.error.value = 'No event loaded';
			return 'failed';
		}
		if (!state.activeScreenId.value) {
			resetActiveCardState();
			return 'landed';
		}
		const screenId = state.activeScreenId.value;
		const flight = reads.begin();
		const outcome = await state.executeAction(
			async (): Promise<CardReadOutcome> => {
				const card = await whileLoading(async () => screenOutputRead ? await screenOutputRead() : await getScreenCard(eventId, screenId));
				// Something newer reached the Card while this read was out: it lands nothing.
				if (!stillSelected(flight, eventId, screenId))
					return 'superseded';
				holdCard(card);
				return 'landed';
			},
			// A superseded read's failure describes nothing still held.
			{ errorRef: state.error, flight },
		);
		return outcome ?? (flight.current ? 'failed' : 'superseded');
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
		const flight = selection;
		return state.executeAction(
			async () => {
				await whileLoading(async () => saveScreenCard(eventId, screenId, cardData));
				if (!stillSelected(flight, eventId, screenId))
					return cardData;
				reads.supersede();
				holdCard(cardData);
				return cardData;
			},
			// A failure from an ended selection describes nothing still held.
			{ errorRef: state.error, flight },
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
		const flight = selection;
		// Nothing held changes until the `DELETE` succeeds, so a failed one rolls
		// nothing back: what was accepted meanwhile stands, and so does the hiding
		// of a Card whose Card Timeout ran out meanwhile.
		return state.executeAction(
			async () => {
				await deleteScreenCard(eventId, screenId);
				if (!stillSelected(flight, eventId, screenId))
					return;
				resetActiveCardState();
			},
			{ errorRef: state.error, flight },
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
		endLifetime,
		setActiveScreen,
		loadActiveCard,
		saveActiveCard,
		clearActiveCard,
		applyRemoteUpdated,
		applyRemoteCleared,
	};
}
