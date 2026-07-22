import type {
	CreatePhaseInput,
	Phase,
	UpdatePhaseInput,
} from '~/types';
import type { MessageData } from '~/types/realtime';
import { useEventDataResource } from '~/modules/event-data/client';
import { useEventDataLifecycle } from '~/modules/event-data/lifecycle';

export const usePhaseStore = defineStore('phase', () => {
	const phaseRepo = useEventDataResource<Phase, CreatePhaseInput, UpdatePhaseInput>({
		resourcePath: 'phases',
		eventScoped: true,
		includeHeaders: true,
	});

	const lifecycle = useEventDataLifecycle<Phase, CreatePhaseInput, UpdatePhaseInput>({
		repository: phaseRepo,
		entityLabel: 'Phase',
		eventFilter: (phase, currentEventId) => phase.eventId === currentEventId,
	});
	const phases = lifecycle.items;
	const loading = lifecycle.loading;
	const error = lifecycle.error;
	const isLoaded = lifecycle.isLoaded;

	const loadPhasesByEventId = lifecycle.loadByEventId;
	const createPhase = lifecycle.create;
	const updatePhase = lifecycle.update;
	const removePhase = lifecycle.remove;
	const getPhaseById = lifecycle.getById;

	function applyRemoteCreated(data: MessageData<'phase:created'>) {
		lifecycle.applyRemoteCreated(data.phase as Phase);
	}

	function applyRemoteUpdated(data: MessageData<'phase:updated'>) {
		lifecycle.applyRemoteUpdated(data.phase as Phase);
	}

	function applyRemoteDeleted(data: MessageData<'phase:deleted'>) {
		lifecycle.applyRemoteDeleted(data.phaseId);
	}

	const $reset = lifecycle.reset;

	return {
		phases,
		loading,
		error,
		isLoaded,
		loadPhasesByEventId,
		createPhase,
		updatePhase,
		removePhase,
		getPhaseById,
		applyRemoteCreated,
		applyRemoteUpdated,
		applyRemoteDeleted,
		$reset,
	};
});
