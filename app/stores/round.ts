import type {
	CreateRoundInput,
	Round,
	UpdateRoundInput,
} from '~/types';
import type { MessageData } from '~/types/realtime';
import { useEventDataFetch, useEventDataResource } from '~/modules/event-data/client';
import { useEventDataLifecycle } from '~/modules/event-data/lifecycle';

export const useRoundStore = defineStore('round', () => {
	const roundRepo = useEventDataResource<Round, CreateRoundInput, UpdateRoundInput>({
		resourcePath: 'rounds',
		eventScoped: true,
		includeHeaders: true,
	});

	const lifecycle = useEventDataLifecycle<Round, CreateRoundInput, UpdateRoundInput>({
		repository: roundRepo,
		entityLabel: 'Round',
		eventFilter: (round, currentEventId) => round.eventId === currentEventId,
	});
	const rounds = lifecycle.items;
	const loading = lifecycle.loading;
	const error = lifecycle.error;
	const isLoaded = lifecycle.isLoaded;

	const loadRoundsByEventId = lifecycle.loadByEventId;
	const createRound = lifecycle.create;
	const updateRound = lifecycle.update;
	const removeRound = lifecycle.remove;
	const getRoundById = lifecycle.getById;
	const eventDataFetch = useEventDataFetch();

	/**
	 * "Start now": the server stamps the Round's start with its own time, so the
	 * answer is held as it comes back, not predicted (ADR-0066).
	 */
	async function startRound(eventId: number, roundId: number): Promise<Round> {
		const flight = lifecycle.currentLifetime();
		const started = await eventDataFetch.command<Round>(
			{
				eventId,
				resourcePath: 'rounds',
				resourceId: roundId,
				suffix: 'start',
			},
			{ method: 'POST' },
		);
		if (flight.current)
			lifecycle.applyRemoteUpdated(started);
		return started;
	}

	function applyRemoteCreated(data: MessageData<'round:created'>) {
		lifecycle.applyRemoteCreated(data.round as Round);
	}

	function applyRemoteUpdated(data: MessageData<'round:updated'>) {
		lifecycle.applyRemoteUpdated(data.round as Round);
	}

	function applyRemoteDeleted(data: MessageData<'round:deleted'>) {
		lifecycle.applyRemoteDeleted(data.roundId);
	}

	const $reset = lifecycle.reset;

	return {
		rounds,
		loading,
		error,
		isLoaded,
		loadRoundsByEventId,
		createRound,
		updateRound,
		removeRound,
		startRound,
		getRoundById,
		applyRemoteCreated,
		applyRemoteUpdated,
		applyRemoteDeleted,
		$reset,
	};
});
