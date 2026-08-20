import type { FeatureMatchAssignment, SaveFeatureMatchAssignmentInput, UpdateFeatureMatchAssignmentInput } from '~/types';
import { applySavedFeatureMatchAssignment, applyUpdatedFeatureMatchAssignment } from '~/modules/feature-match-assignment/collection';

interface AssignmentMessage {
	eventId: number;
	timestamp?: number;
	originConnectionId?: string;
	featureMatchAssignment: FeatureMatchAssignment;
}

interface AssignmentDeletedMessage {
	eventId: number;
	timestamp?: number;
	originConnectionId?: string;
	featureMatchAssignmentId: number;
}

export const useFeatureMatchAssignmentStore = defineStore('featureMatchAssignment', () => {
	const repo = useFeatureMatchAssignmentRepository();
	const assignmentsByRound = ref(new Map<number, FeatureMatchAssignment[]>());
	const consumedRoundIds = ref(new Set<number>());
	const remoteChangedAssignmentIds = ref(new Set<number>());
	const remoteChangeTimers = new Map<number, ReturnType<typeof setTimeout>>();
	const roundConsumerCounts = new Map<number, number>();
	const loading = ref(false);
	const error = ref<string | null>(null);
	const currentEventId = ref<number | null>(null);
	const roundLoads = createKeyedGuardedSequence<number>();

	const assignments = computed(() => [...assignmentsByRound.value.values()].flat());

	function assignmentsForRound(roundId: number): FeatureMatchAssignment[] {
		return assignmentsByRound.value.get(roundId) ?? [];
	}

	function replaceRound(roundId: number, next: FeatureMatchAssignment[]) {
		assignmentsByRound.value = new Map(assignmentsByRound.value).set(roundId, next);
	}

	function ensureEvent(eventId: number) {
		if (currentEventId.value !== eventId) {
			roundLoads.supersedeAll();
			assignmentsByRound.value = new Map();
			consumedRoundIds.value = new Set();
			roundConsumerCounts.clear();
			currentEventId.value = eventId;
		}
	}

	function consumeRound(eventId: number, roundId: number): () => void {
		ensureEvent(eventId);
		roundConsumerCounts.set(roundId, (roundConsumerCounts.get(roundId) ?? 0) + 1);
		consumedRoundIds.value = new Set(consumedRoundIds.value).add(roundId);
		let released = false;
		return () => {
			if (released || currentEventId.value !== eventId)
				return;
			released = true;
			const remaining = (roundConsumerCounts.get(roundId) ?? 1) - 1;
			if (remaining > 0) {
				roundConsumerCounts.set(roundId, remaining);
				return;
			}
			roundConsumerCounts.delete(roundId);
			const next = new Set(consumedRoundIds.value);
			next.delete(roundId);
			consumedRoundIds.value = next;
		};
	}

	async function loadAssignments(eventId: number, roundId: number) {
		ensureEvent(eventId);
		const flight = roundLoads.begin(roundId);
		loading.value = true;
		error.value = null;
		try {
			const loaded = await repo.listByRound(eventId, roundId);
			if (flight.current && currentEventId.value === eventId)
				replaceRound(roundId, loaded);
			return loaded;
		}
		catch (cause) {
			if (flight.current)
				error.value = cause instanceof Error ? cause.message : 'Failed to load feature match assignments';
			return null;
		}
		finally {
			loading.value = false;
		}
	}

	async function reloadConsumedRounds() {
		const eventId = currentEventId.value;
		if (!eventId)
			return;
		const roundIds = [...consumedRoundIds.value];
		await Promise.all(roundIds.map(async (roundId) => {
			const flight = roundLoads.begin(roundId);
			try {
				const loaded = await repo.listByRound(eventId, roundId);
				if (flight.current && currentEventId.value === eventId && consumedRoundIds.value.has(roundId))
					replaceRound(roundId, loaded);
			}
			catch (cause) {
				if (flight.current)
					error.value = cause instanceof Error ? cause.message : 'Failed to reload feature match assignments';
			}
		}));
	}

	async function saveAssignment(eventId: number, input: SaveFeatureMatchAssignmentInput) {
		const saved = await repo.create(eventId, input);
		if (saved && assignmentsByRound.value.has(saved.roundId))
			replaceRound(saved.roundId, applySavedFeatureMatchAssignment(assignmentsForRound(saved.roundId), saved));
		return saved;
	}

	async function updateAssignment(eventId: number, assignmentId: number, input: UpdateFeatureMatchAssignmentInput) {
		const updated = await repo.update(eventId, assignmentId, input);
		if (updated && assignmentsByRound.value.has(updated.roundId)) {
			replaceRound(
				updated.roundId,
				applyUpdatedFeatureMatchAssignment(assignmentsForRound(updated.roundId), assignmentId, updated),
			);
		}
		return updated;
	}

	function applySavedAssignment(assignment: FeatureMatchAssignment) {
		if (!assignmentsByRound.value.has(assignment.roundId))
			return;
		replaceRound(
			assignment.roundId,
			applySavedFeatureMatchAssignment(assignmentsForRound(assignment.roundId), assignment),
		);
	}

	function markRemoteNoteChanged(assignmentId: number) {
		const existingTimer = remoteChangeTimers.get(assignmentId);
		if (existingTimer)
			clearTimeout(existingTimer);
		remoteChangedAssignmentIds.value = new Set(remoteChangedAssignmentIds.value).add(assignmentId);
		remoteChangeTimers.set(assignmentId, setTimeout(() => {
			const next = new Set(remoteChangedAssignmentIds.value);
			next.delete(assignmentId);
			remoteChangedAssignmentIds.value = next;
			remoteChangeTimers.delete(assignmentId);
		}, 2500));
	}

	function applyRemoteCreated({ eventId, featureMatchAssignment }: AssignmentMessage) {
		if (currentEventId.value !== eventId || !assignmentsByRound.value.has(featureMatchAssignment.roundId))
			return;
		applySavedAssignment(featureMatchAssignment);
		if (featureMatchAssignment.note)
			markRemoteNoteChanged(featureMatchAssignment.id);
	}

	function applyRemoteUpdated({ eventId, featureMatchAssignment }: AssignmentMessage) {
		if (currentEventId.value !== eventId || !assignmentsByRound.value.has(featureMatchAssignment.roundId))
			return;
		const previous = assignmentsForRound(featureMatchAssignment.roundId)
			.find(assignment => assignment.id === featureMatchAssignment.id);
		applySavedAssignment(featureMatchAssignment);
		if (previous?.note !== featureMatchAssignment.note)
			markRemoteNoteChanged(featureMatchAssignment.id);
	}

	function applyRemoteDeleted({ eventId, featureMatchAssignmentId }: AssignmentDeletedMessage) {
		if (currentEventId.value !== eventId)
			return;
		for (const [roundId, roundAssignments] of assignmentsByRound.value) {
			if (roundAssignments.some(assignment => assignment.id === featureMatchAssignmentId)) {
				replaceRound(roundId, roundAssignments.filter(assignment => assignment.id !== featureMatchAssignmentId));
				break;
			}
		}
	}

	function isRemoteChanged(assignmentId: number): boolean {
		return remoteChangedAssignmentIds.value.has(assignmentId);
	}

	function $reset() {
		roundLoads.supersedeAll();
		roundConsumerCounts.clear();
		for (const timer of remoteChangeTimers.values())
			clearTimeout(timer);
		remoteChangeTimers.clear();
		assignmentsByRound.value = new Map();
		consumedRoundIds.value = new Set();
		remoteChangedAssignmentIds.value = new Set();
		currentEventId.value = null;
		error.value = null;
		loading.value = false;
	}

	return {
		assignments,
		assignmentsByRound,
		consumedRoundIds,
		loading,
		error,
		currentEventId,
		assignmentsForRound,
		consumeRound,
		loadAssignments,
		reloadConsumedRounds,
		saveAssignment,
		updateAssignment,
		applySavedAssignment,
		applyRemoteCreated,
		applyRemoteUpdated,
		applyRemoteDeleted,
		isRemoteChanged,
		$reset,
	};
});
