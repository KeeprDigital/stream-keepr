import type {
	MeleeConfigInput,
	MeleeConfigResponse,
	MeleeUnresolvedDeckCardResponse,
	ResolveMeleeUnresolvedDeckCardInput,
	ResolveMeleeUnresolvedDeckCardResponse,
	SyncDecklistsResponse,
} from '~~/shared/api';
import type {
	CreateEventInput,
	Event,
	UpdateEventInput,
} from '~/types';
import { useEventDataFetch, useEventDataResource } from '~/modules/event-data/client';

export function useEventRepository() {
	const eventData = useEventDataFetch();
	const base = useEventDataResource<Event, CreateEventInput, UpdateEventInput>({
		resourcePath: 'events',
		eventScoped: false,
		includeHeaders: true,
	});

	const list = async (params?: { game?: Game }): Promise<Event[]> => {
		const response = await eventData.command<{ events: Event[]; total: number }>(
			{ resourcePath: 'events', eventScoped: false },
			{ method: 'GET', query: params, includeHeaders: false },
		);
		return response.events;
	};

	const getById = async (id: number): Promise<Event | null> => {
		return base.getById(null, id);
	};

	const create = async (data: CreateEventInput): Promise<Event> => {
		return await eventData.command<Event, CreateEventInput>(
			{ resourcePath: 'events', eventScoped: false },
			{ method: 'POST', body: data, includeHeaders: false },
		);
	};

	const update = async (id: number, data: UpdateEventInput): Promise<Event> => {
		return base.update(null, id, data);
	};

	const remove = async (id: number): Promise<{ success: boolean }> => {
		return base.remove(null, id);
	};

	interface SyncMeleeResponse {
		success: boolean;
		message: string;
		event: { name: string };
		phases: number;
		rounds: number;
		warnings?: string[];
	}
	const syncMelee = async (id: number): Promise<SyncMeleeResponse> => {
		return await eventData.command<SyncMeleeResponse>(
			{ eventId: id, resourcePath: 'melee', suffix: 'sync-event' },
			{ method: 'POST' },
		);
	};

	interface InitialSetupResponse {
		success: boolean;
		message: string;
		steps: string[];
		event: { name: string };
		phases: number;
		rounds: number;
		players: { created: number; updated: number; deactivated: number; matchesUpdated: number; errors: string[] };
		deckLists: SyncDecklistsResponse['results'];
		warnings: string[];
	}
	const runInitialSetup = async (id: number): Promise<InitialSetupResponse> => {
		return await eventData.command<InitialSetupResponse>(
			{ eventId: id, resourcePath: 'melee', suffix: 'initial-setup' },
			{ method: 'POST' },
		);
	};

	interface SyncPlayersResponse {
		success: boolean;
		message: string;
		results: { created: number; updated: number; deactivated: number; matchesUpdated: number; errors: string[] };
		warnings?: string[];
	}
	const syncPlayers = async (id: number): Promise<SyncPlayersResponse> => {
		return await eventData.command<SyncPlayersResponse>(
			{ eventId: id, resourcePath: 'melee', suffix: 'sync-players' },
			{ method: 'POST' },
		);
	};

	interface SyncRoundResponse {
		success: boolean;
		message: string;
		round: { id: number; name: string; roundNumber: number; phaseId: number };
		matchCount: number;
		created: number;
		updated: number;
		staleDeleted: number;
		warnings: string[];
	}
	const syncSpecificRound = async (id: number, roundId: number): Promise<SyncRoundResponse> => {
		return await eventData.command<SyncRoundResponse, { roundId: number }>(
			{ eventId: id, resourcePath: 'melee', suffix: 'sync-round' },
			{ method: 'POST', body: { roundId } },
		);
	};

	interface UpdateFromMeleeResponse {
		success: boolean;
		message: string;
		steps: string[];
		players: { created: number; updated: number; deactivated: number; matchesUpdated: number; errors: string[] };
		deckLists: SyncDecklistsResponse['results'] | null;
		rounds: Array<SyncRoundResponse & { role: 'previous' | 'next' | 'latest' }>;
		advancedRound: SyncRoundResponse['round'] | null;
		refreshedRound: SyncRoundResponse['round'] | null;
		warnings: string[];
	}
	const updateFromMelee = async (id: number, options: { includeDeckLists?: boolean; advanceRound?: boolean } = {}): Promise<UpdateFromMeleeResponse> => {
		return await eventData.command<UpdateFromMeleeResponse, typeof options>(
			{ eventId: id, resourcePath: 'melee', suffix: 'update' },
			{ method: 'POST', body: options },
		);
	};

	const syncDecklists = async (id: number): Promise<SyncDecklistsResponse> => {
		return await eventData.command<SyncDecklistsResponse>(
			{ eventId: id, resourcePath: 'melee', suffix: 'sync-decklists' },
			{ method: 'POST' },
		);
	};

	const listUnresolvedDeckCards = async (id: number): Promise<MeleeUnresolvedDeckCardResponse[]> => {
		return await eventData.command<MeleeUnresolvedDeckCardResponse[]>(
			{ eventId: id, resourcePath: 'melee', suffix: 'unresolved-deck-cards' },
			{ method: 'GET' },
		);
	};

	const resolveUnresolvedDeckCard = async (
		id: number,
		unresolvedId: number,
		data: ResolveMeleeUnresolvedDeckCardInput,
	): Promise<ResolveMeleeUnresolvedDeckCardResponse> => {
		return await eventData.command<ResolveMeleeUnresolvedDeckCardResponse, ResolveMeleeUnresolvedDeckCardInput>(
			{ eventId: id, resourcePath: 'melee', suffix: `unresolved-deck-cards/${unresolvedId}` },
			{ method: 'PUT', body: data },
		);
	};

	const getMeleeConfig = async (id: number): Promise<MeleeConfigResponse> => {
		return await eventData.command<MeleeConfigResponse>(
			{ eventId: id, resourcePath: 'melee-config' },
			{ method: 'GET', includeHeaders: false },
		);
	};

	const updateMeleeConfig = async (id: number, data: MeleeConfigInput): Promise<Event> => {
		return await eventData.command<Event, MeleeConfigInput>(
			{ eventId: id, resourcePath: 'melee-config' },
			{ method: 'PUT', body: data },
		);
	};

	return {
		list,
		getById,
		create,
		update,
		remove,
		getMeleeConfig,
		updateMeleeConfig,
		syncMelee,
		runInitialSetup,
		syncPlayers,
		updateFromMelee,
		syncSpecificRound,
		syncDecklists,
		listUnresolvedDeckCards,
		resolveUnresolvedDeckCard,
	};
}
