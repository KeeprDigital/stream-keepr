import type { CreateFeatureMatchAssignmentInput, FeatureMatchAssignment, UpdateFeatureMatchAssignmentInput } from '~/types';
import { applySavedFeatureMatchAssignment, applyUpdatedFeatureMatchAssignment } from '~/modules/feature-match-assignment/collection';

export const useFeatureMatchAssignmentStore = defineStore('featureMatchAssignment', () => {
	const repo = useFeatureMatchAssignmentRepository();
	const assignments = ref<FeatureMatchAssignment[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const currentEventId = ref<number | null>(null);
	const loadedRoundId = ref<number | null>(null);

	async function loadAssignments(eventId: number, roundId: number) {
		loading.value = true;
		error.value = null;
		try {
			assignments.value = await repo.listByRound(eventId, roundId);
			currentEventId.value = eventId;
			loadedRoundId.value = roundId;
			return assignments.value;
		}
		catch (cause) {
			error.value = cause instanceof Error ? cause.message : 'Failed to load feature match assignments';
			return null;
		}
		finally {
			loading.value = false;
		}
	}

	async function saveAssignment(eventId: number, input: CreateFeatureMatchAssignmentInput) {
		const saved = await repo.create(eventId, input);
		if (saved)
			assignments.value = applySavedFeatureMatchAssignment(assignments.value, saved);
		return saved;
	}

	async function updateAssignment(eventId: number, assignmentId: number, input: UpdateFeatureMatchAssignmentInput) {
		const updated = await repo.update(eventId, assignmentId, input);
		if (updated)
			assignments.value = applyUpdatedFeatureMatchAssignment(assignments.value, assignmentId, updated);
		return updated;
	}

	function applySavedAssignment(assignment: FeatureMatchAssignment) {
		assignments.value = applySavedFeatureMatchAssignment(assignments.value, assignment);
	}

	function $reset() {
		assignments.value = [];
		currentEventId.value = null;
		loadedRoundId.value = null;
		error.value = null;
		loading.value = false;
	}

	return {
		assignments,
		loading,
		error,
		currentEventId,
		loadedRoundId,
		loadAssignments,
		saveAssignment,
		updateAssignment,
		applySavedAssignment,
		$reset,
	};
});
