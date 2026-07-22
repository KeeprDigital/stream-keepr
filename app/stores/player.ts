import type {
	CreatePlayerInput,
	Player,
	UpdatePlayerInput,
} from '~/types';
import type { MessageData } from '~/types/realtime';
import { useEventDataResource } from '~/modules/event-data/client';
import { useEventDataLifecycle } from '~/modules/event-data/lifecycle';

export const usePlayerStore = defineStore('player', () => {
	const playerRepo = useEventDataResource<Player, CreatePlayerInput, UpdatePlayerInput>({
		resourcePath: 'players',
		eventScoped: true,
		includeHeaders: true,
	});
	const { executeAction } = useAsyncAction();

	const itemLoading = ref(false);

	/**
	 * Monotonically increasing counter that ticks on every player mutation
	 * (create, update, delete, bulk load). Watchers that depend on player
	 * data* (not just array length) should observe this instead of
	 * `players.length`.
	 */
	const dataVersion = ref(0);
	const lifecycle = useEventDataLifecycle<Player, CreatePlayerInput, UpdatePlayerInput>({
		repository: {
			...playerRepo,
			remove: async (eventId, playerId) => {
				const result = await playerRepo.remove(eventId, playerId);
				if (!result.success)
					throw new Error('Failed to delete player');
				return result;
			},
		},
		entityLabel: 'Player',
		onLoad: () => dataVersion.value++,
		onMutation: () => dataVersion.value++,
		onReset: () => {
			itemLoading.value = false;
			dataVersion.value = 0;
		},
	});
	const players = lifecycle.items;
	const loading = computed(() => lifecycle.loading.value || itemLoading.value);
	const error = lifecycle.error;
	const isLoaded = lifecycle.isLoaded;

	const loadPlayersByEventId = lifecycle.loadByEventId;
	const createPlayer = lifecycle.create;
	const updatePlayer = lifecycle.update;
	const removePlayer = lifecycle.remove;

	async function getPlayerById(eventId: number, playerId: number) {
		return executeAction(
			async () => {
				const playerData = await playerRepo.getById(eventId, playerId);
				if (!playerData) {
					throw new Error('Player not found');
				}
				return playerData;
			},
			{ loadingRef: itemLoading, errorRef: error },
		);
	}

	// Realtime handlers
	function applyRemoteCreated(data: MessageData<'player:created'>) {
		lifecycle.applyRemoteCreated(data.player);
	}

	function applyRemoteUpdated(data: MessageData<'player:updated'>) {
		lifecycle.applyRemoteUpdated(data.player);
	}

	function applyRemoteDeleted(data: MessageData<'player:deleted'>) {
		lifecycle.applyRemoteDeleted(data.playerId);
	}

	const $reset = lifecycle.reset;

	return {
		// State
		players,
		loading,
		error,

		// Computed
		isLoaded,

		/** Increments on every player mutation (create/update/delete/load). */
		dataVersion,

		// Actions
		loadPlayersByEventId,
		getPlayerById,
		createPlayer,
		updatePlayer,
		removePlayer,
		applyRemoteCreated,
		applyRemoteUpdated,
		applyRemoteDeleted,
		$reset,
	};
});
