<script setup lang="ts">
import type { Match } from '~/types';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { isManualResultsRound } from '~~/shared/utils/roundControl';
import { LazyMatchCreateModal } from '#components';
import MatchResultModal from '~/components/Match/ResultModal.vue';

definePageMeta({
	title: 'Matches',
	layout: false,
});

const eventStore = useEventStore();
const matchStore = useMatchStore();
const roundStore = useRoundStore();
const meleeStore = useMeleeStore();
const featureMatchStore = useFeatureMatchStore();
const assignmentStore = useFeatureMatchAssignmentStore();
const playerStore = usePlayerStore();
const router = useRouter();
const matchRepository = useMatchRepository();
const { openPlayerDeckList } = usePlayerDeckListModal();
const { runRequest } = useRequestFeedback();

const route = useRoute();
const roundIdsWithMatches = ref(new Set<number>());
const roundAvailabilityLoaded = ref(false);

function parseRoundId(value: unknown): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function getMostRecentSyncedRoundId() {
	const syncedRounds = roundStore.rounds.filter(round => round.lastSyncedAt);
	if (syncedRounds.length === 0) {
		return undefined;
	}

	return syncedRounds
		.toSorted((a, b) => new Date(b.lastSyncedAt!).getTime() - new Date(a.lastSyncedAt!).getTime())[0]
		?.id;
}

function roundExists(roundId: number | null | undefined): roundId is number {
	return roundId != null && roundStore.rounds.some(round => round.id === roundId);
}

// Round switcher state. URL query wins, otherwise use the most recently synced/first round.
const queryRoundId = computed(() => parseRoundId(route.query.roundId));
const viewedRoundId = ref<number | undefined>(queryRoundId.value);

function resolvePreferredRoundId() {
	const preferredRoundIds: Array<number | null | undefined> = [
		queryRoundId.value,
		getMostRecentSyncedRoundId(),
		...roundStore.rounds.map(round => round.id),
	];

	return preferredRoundIds.find(roundExists);
}

// Round options for the dropdown — short labels are preferred in operator UI.
const phaseStore = usePhaseStore();
const roundOptions = computed(() =>
	roundStore.rounds.map((r) => {
		const phase = phaseStore.getPhaseById(r.phaseId);
		return {
			label: formatRoundOptionLabel(r, phase),
			value: r.id,
		};
	}),
);
const hasRounds = computed(() => roundStore.rounds.length > 0);
const hasSelectableRounds = computed(() => roundOptions.value.length > 0);
const hasMatches = computed(() => matchStore.matches.length > 0);
const selectedRound = computed(() => viewedRoundId.value ? roundStore.getRoundById(viewedRoundId.value) : undefined);
const selectedRoundBestOf = computed(() => toFeatureMatchDefaults(eventStore.event).bestOf);
const isSelectedRoundManualResults = computed(() => isManualResultsRound(selectedRound.value));
const canCreateMatches = computed(() => !!selectedRound.value && isSelectedRoundManualResults.value);
const canSyncSelectedRound = computed(() => !!(eventStore.event?.meleeEnabled && selectedRound.value?.externalSource === 'melee'));

const {
	eventId,
	initialLoading: storesLoading,
	initialError: storesError,
	retry: retryStores,
} = useEventPageLoading([
	{ isLoaded: () => featureMatchStore.isLoaded, load: id => featureMatchStore.loadFeatureMatchesByEventId(id) },
	{ isLoaded: () => playerStore.isLoaded, load: id => playerStore.loadPlayersByEventId(id) },
	{ isLoaded: () => phaseStore.isLoaded, load: id => phaseStore.loadPhasesByEventId(id) },
	{ isLoaded: () => roundStore.isLoaded, load: id => roundStore.loadRoundsByEventId(id) },
]);

watch(eventId, async (id) => {
	if (!id) {
		roundIdsWithMatches.value = new Set();
		roundAvailabilityLoaded.value = true;
		return;
	}

	roundAvailabilityLoaded.value = false;
	try {
		const matches = await matchRepository.list(id);
		roundIdsWithMatches.value = new Set(matches.map(match => match.roundId));
	}
	finally {
		roundAvailabilityLoaded.value = true;
	}
}, { immediate: true });

// Stays true until rounds AND matches (if a round is selected) have loaded
const initialLoading = computed(() =>
	storesLoading.value || !roundAvailabilityLoaded.value || (!!viewedRoundId.value && !matchStore.isLoaded),
);

// Search state (debounced for table performance)
const searchQuery = ref('');
const globalFilter = refDebounced(searchQuery, 200);

// Load matches when viewed round changes
watch(viewedRoundId, async (roundId) => {
	if (eventId.value && roundId) {
		await Promise.all([
			matchStore.loadMatchesByRoundId(eventId.value, roundId),
			assignmentStore.loadAssignments(eventId.value, roundId),
		]);
	}
}, { immediate: true });

watch([
	queryRoundId,
	() => roundStore.rounds,
	() => roundAvailabilityLoaded.value,
], async () => {
	if (!roundAvailabilityLoaded.value) {
		return;
	}

	const currentSelectionExists = roundExists(viewedRoundId.value);
	const preferredRoundId = resolvePreferredRoundId();

	if (queryRoundId.value !== undefined && queryRoundId.value !== preferredRoundId) {
		const nextQuery = Object.fromEntries(
			Object.entries(route.query).filter((entry): entry is [string, string] => entry[0] !== 'roundId' && typeof entry[1] === 'string'),
		);
		if (preferredRoundId !== undefined) {
			nextQuery.roundId = String(preferredRoundId);
		}
		else {
			delete nextQuery.roundId;
		}

		await router.replace({ query: nextQuery });
	}

	if (queryRoundId.value !== undefined || viewedRoundId.value === undefined || !currentSelectionExists) {
		viewedRoundId.value = preferredRoundId;
	}
}, { immediate: true, deep: true });

// ── Actions ──

const overlay = useOverlay();
const featureMatchPromotion = useFeatureMatchPromotion();

function handleCreateMatch() {
	const modal = overlay.create(LazyMatchCreateModal);
	void modal.open({
		defaultRoundId: viewedRoundId.value,
	});
}

function handleEditResult(match: Match) {
	const modal = overlay.create(MatchResultModal);
	void modal.open({
		match,
		bestOf: selectedRoundBestOf.value,
	});
}

async function handlePromote(featureMatchId: number, matchId: number) {
	if (!eventId.value || !viewedRoundId.value)
		return;
	await runRequest(
		async () => {
			const result = await featureMatchPromotion.promote({
				eventId: eventId.value!,
				roundId: viewedRoundId.value!,
				slotId: featureMatchId,
				matchId,
			});
			if (!result.promotedSlot)
				throw new Error('Failed to promote match');
			return true;
		},
		{
			success: false,
			error: { title: 'Failed to promote match', color: 'error' },
		},
	);
}

async function handleSyncSelectedRound() {
	if (!eventId.value || !selectedRound.value)
		return;

	await runRequest(
		async () => {
			const result = await meleeStore.syncSpecificRound(selectedRound.value!.id);
			if (!result.success)
				throw new Error(result.error ?? 'Failed to sync round matches');

			await Promise.all([
				matchStore.loadMatchesByRoundId(eventId.value!, selectedRound.value!.id),
				roundStore.loadRoundsByEventId(eventId.value!),
			]);
			const matches = await matchRepository.list(eventId.value!);
			roundIdsWithMatches.value = new Set(matches.map(match => match.roundId));
			return true;
		},
		{
			success: { title: 'Round Synced', description: `${selectedRound.value.name} matches synced`, color: 'success' },
			error: ({ message }) => ({ title: 'Round Sync Failed', description: message, color: 'error' }),
		},
	);
}

async function handleAssignmentNoteBlur(assignmentId: number, note: string) {
	if (!eventId.value)
		return;
	await assignmentStore.updateAssignment(eventId.value, assignmentId, { note: note.trim() || null });
}

const featureMatchesForList = computed(() =>
	featureMatchStore.featureMatches.map(fm => ({ id: fm.id, matchId: fm.matchId })),
);

const pageState = computed(() => {
	if (storesError.value)
		return 'ready';
	if (initialLoading.value)
		return 'loading';
	if (hasMatches.value)
		return 'ready';
	return hasSelectableRounds.value ? 'empty-filtered' : 'empty';
});
const noMatchesAvailableTitle = computed(() => hasRounds.value ? 'No round selected' : 'No matches yet');
const noMatchesAvailableDescription = computed(() => hasRounds.value
	? 'Select a round to review or sync its matches.'
	: 'Set up rounds before creating matches.');
</script>

<template>
	<UICollectionPage
		:state="pageState"
		content-width="narrow"
		empty-icon="i-lucide-swords"
		:empty-title="hasSelectableRounds ? (canCreateMatches ? 'No matches yet' : 'No matches synced yet') : noMatchesAvailableTitle"
		:empty-description="hasSelectableRounds ? (canCreateMatches ? 'Create a match to get started.' : 'Sync or refresh this round from Melee to see the current pairings.') : noMatchesAvailableDescription"
	>
		<template v-if="selectedRound" #actions>
			<div class="flex items-center gap-2">
				<UButton
					v-if="canSyncSelectedRound"
					icon="i-lucide-refresh-cw"
					label="Sync Matches"
					color="primary"
					:loading="meleeStore.syncingRound"
					@click="handleSyncSelectedRound"
				/>
				<UButton
					v-if="hasMatches && canCreateMatches"
					icon="i-lucide-plus"
					label="Add Match"
					color="primary"
					@click="handleCreateMatch"
				/>
			</div>
		</template>

		<template #toolbar>
			<UDashboardToolbar>
				<template #left>
					<div class="flex flex-wrap items-center gap-3">
						<USelectMenu
							v-if="roundOptions.length > 0"
							v-model="viewedRoundId"
							:items="roundOptions"
							value-key="value"
							placeholder="Select round"
							class="w-56"
						/>
						<UBadge color="neutral" variant="subtle">
							{{ matchStore.matches.length }} Match{{ matchStore.matches.length === 1 ? '' : 'es' }}
						</UBadge>
					</div>
				</template>

				<template #right>
					<div class="flex flex-wrap items-center justify-end gap-3">
						<UISearchInput
							v-model="searchQuery"
							placeholder="Search by player or deck..."
							aria-label="Search matches"
						/>
					</div>
				</template>
			</UDashboardToolbar>
		</template>

		<UIInitialLoadError v-if="storesError" :error="storesError" @retry="retryStores" />

		<div v-else>
			<MatchList
				:matches="matchStore.matches"
				:players="playerStore.players"
				:feature-matches="featureMatchesForList"
				:feature-match-assignments="assignmentStore.assignments"
				:loading="initialLoading"
				:global-filter="globalFilter"
				:results-editable="isSelectedRoundManualResults"
				@promote="handlePromote"
				@view-deck-list="openPlayerDeckList"
				@edit-result="handleEditResult"
				@assignment-note-blur="handleAssignmentNoteBlur"
			/>
		</div>

		<template #empty-actions>
			<UButton
				v-if="!hasSelectableRounds"
				variant="outline"
				color="neutral"
				:to="`/event/${eventId}/rounds`"
				icon="i-lucide-list-ordered"
			>
				Set Up Structure
			</UButton>
			<UButton
				v-else-if="canSyncSelectedRound"
				icon="i-lucide-refresh-cw"
				color="primary"
				:loading="meleeStore.syncingRound"
				@click="handleSyncSelectedRound"
			>
				Sync Matches
			</UButton>
			<UButton
				v-else-if="canCreateMatches"
				icon="i-lucide-plus"
				color="primary"
				@click="handleCreateMatch"
			>
				Add Match
			</UButton>
			<UButton
				v-else
				color="neutral"
				variant="ghost"
				:to="`/event/${eventId}/rounds`"
			>
				Event Structure
			</UButton>
		</template>
	</UICollectionPage>
</template>
