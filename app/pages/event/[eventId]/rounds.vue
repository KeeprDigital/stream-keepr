<script setup lang="ts">
import type { Phase, Round } from '~/types';
import { LazyRoundEditModal, LazyRoundPhaseEditModal, LazyUIConfirmActionModal } from '#components';

definePageMeta({
	title: 'Event Structure',
	layout: false,
});

const eventStore = useEventStore();
const phaseStore = usePhaseStore();
const roundStore = useRoundStore();
const meleeStore = useMeleeStore();
const featureMatchStore = useFeatureMatchStore();
const overlay = useOverlay();
const { runRequest } = useRequestFeedback();

const isMeleeEvent = computed(() => !!eventStore.event?.meleeEnabled);

const { eventId, initialLoading, initialError, retry } = useEventPageLoading([
	{ isLoaded: () => phaseStore.isLoaded, load: id => phaseStore.loadPhasesByEventId(id) },
	{ isLoaded: () => roundStore.isLoaded, load: id => roundStore.loadRoundsByEventId(id) },
]);

const totalPhases = computed(() => phaseStore.phases.length);
const totalRounds = computed(() => roundStore.rounds.length);
const hasPhases = computed(() => totalPhases.value > 0);
const pageState = computed(() => initialError.value ? 'ready' : initialLoading.value ? 'loading' : (hasPhases.value ? 'ready' : 'empty'));

async function handleAddPhase() {
	if (!eventId.value)
		return;
	const maxOrder = phaseStore.phases.reduce((max, p) => Math.max(max, p.sortOrder), -1);
	await runRequest(
		() => phaseStore.createPhase(eventId.value!, {
			name: `Phase ${phaseStore.phases.length + 1}`,
			sortOrder: maxOrder + 1,
		}),
		{
			success: { title: 'Phase Created', color: 'success' },
			error: { title: 'Failed to Create Phase', color: 'error' },
		},
	);
}

async function handleEditPhase(phase: Phase) {
	const modal = overlay.create(LazyRoundPhaseEditModal);
	await modal.open({ phaseId: phase.id });
}

async function handleDeletePhase(phase: Phase) {
	if (!eventId.value)
		return;
	const roundCount = roundStore.rounds.filter(r => r.phaseId === phase.id).length;
	const modal = overlay.create(LazyUIConfirmActionModal);
	const confirmed = await modal.open({
		title: 'Delete Phase',
		message: roundCount > 0
			? `Delete "${phase.name}" and its ${roundCount} round${roundCount !== 1 ? 's' : ''}?`
			: `Delete "${phase.name}"?`,
		description: 'This action cannot be undone.',
		confirmLabel: 'Delete',
		confirmColor: 'error',
		icon: 'i-lucide-trash-2',
		iconColor: 'text-error',
	}).result;
	if (!confirmed)
		return;
	await runRequest(
		() => phaseStore.removePhase(eventId.value!, phase.id),
		{
			success: { title: 'Phase Deleted', color: 'success' },
			error: { title: 'Failed to Delete Phase', color: 'error' },
			onSuccess: async () => { await roundStore.loadRoundsByEventId(eventId.value!); },
		},
	);
}

async function handleAddRound(phase: Phase) {
	if (!eventId.value)
		return;
	const phaseRounds = roundStore.rounds.filter(r => r.phaseId === phase.id);
	const maxRoundNumber = phaseRounds.reduce((max, r) => Math.max(max, r.roundNumber), 0);
	await runRequest(
		() => roundStore.createRound(eventId.value!, {
			phaseId: phase.id,
			name: `Round ${maxRoundNumber + 1}`,
			roundNumber: maxRoundNumber + 1,
		}),
		{
			success: { title: 'Round Created', color: 'success' },
			error: { title: 'Failed to Create Round', color: 'error' },
		},
	);
}

async function handleEditRound(round: Round) {
	const modal = overlay.create(LazyRoundEditModal);
	await modal.open({ roundId: round.id });
}

async function handleDeleteRound(round: Round) {
	if (!eventId.value)
		return;
	const modal = overlay.create(LazyUIConfirmActionModal);
	const confirmed = await modal.open({
		title: 'Delete Round',
		message: `Delete "${round.name}"?`,
		description: 'This action cannot be undone.',
		confirmLabel: 'Delete',
		confirmColor: 'error',
		icon: 'i-lucide-trash-2',
		iconColor: 'text-error',
	}).result;
	if (!confirmed)
		return;
	await runRequest(
		() => roundStore.removeRound(eventId.value!, round.id),
		{
			success: { title: 'Round Deleted', color: 'success' },
			error: { title: 'Failed to Delete Round', color: 'error' },
			onSuccess: async () => { await featureMatchStore.loadFeatureMatchesByEventId(eventId.value!); },
		},
	);
}

async function handleSyncRoundMatches(round: Round) {
	if (!eventId.value)
		return;
	await runRequest(
		() => meleeStore.syncSpecificRound(round.id),
		{
			success: { title: 'Matches Synced', description: `Synced matches for ${round.name}`, color: 'success' },
			error: ({ message }) => ({ title: 'Sync Failed', description: message, color: 'error' }),
			onSuccess: async () => { await roundStore.loadRoundsByEventId(eventId.value!); },
		},
	);
}

async function handleEnableManualOverride(round: Round) {
	if (!eventId.value)
		return;
	const modal = overlay.create(LazyUIConfirmActionModal);
	const confirmed = await modal.open({
		title: 'Switch to Manual Override',
		message: `Stop using Melee as the source of truth for "${round.name}"? Local pairings and results will become authoritative for this round.`,
		description: 'This change is permanent for the round and cannot be undone.',
		confirmLabel: 'Enable Manual Override',
		confirmColor: 'warning',
		icon: 'i-lucide-pencil-ruler',
		iconColor: 'text-warning',
	}).result;
	if (!confirmed)
		return;
	await runRequest(async () => {
		await $fetch(`/api/events/${eventId.value}/rounds/${round.id}/state/manual-override`, { method: 'POST', headers: useApiHeaders().getHeaders() });
		await roundStore.loadRoundsByEventId(eventId.value!);
		return true;
	}, {
		success: { title: 'Manual Override Enabled', description: `${round.name} now uses local pairings and results.`, color: 'success' },
		error: ({ message }) => ({ title: 'Failed to Enable Manual Override', description: message, color: 'error' }),
	});
}
</script>

<template>
	<UICollectionPage
		:state="pageState"
		flush
		content-width="full"
		empty-icon="i-lucide-list-ordered"
		empty-title="No event structure yet"
		empty-description="Add a phase to start building the event's phase and round structure."
	>
		<template #actions>
			<UButton icon="i-lucide-plus" @click="handleAddPhase">
				Add Phase
			</UButton>
		</template>

		<template #toolbar>
			<UDashboardToolbar>
				<template #left>
					<div class="flex flex-wrap items-center gap-3">
						<span class="text-sm text-muted">{{ totalPhases }} phase{{ totalPhases !== 1 ? 's' : '' }} · {{ totalRounds }} round{{ totalRounds !== 1 ? 's' : '' }}</span>
					</div>
				</template>
				<template #right>
					<div class="flex flex-wrap items-center justify-end gap-2">
						<UButton
							size="sm"
							variant="ghost"
							color="neutral"
							:to="`/event/${eventId}/matches`"
							icon="i-lucide-swords"
						>
							Review Matches
						</UButton>
					</div>
				</template>
			</UDashboardToolbar>
		</template>

		<UIInitialLoadError v-if="initialError" :error="initialError" @retry="retry" />

		<RoundPhaseList
			v-else
			:phases="phaseStore.phases"
			:rounds="roundStore.rounds"
			:loading="initialLoading"
			:is-melee-event="isMeleeEvent"
			:event-id="eventId!"
			@edit-phase="handleEditPhase"
			@delete-phase="handleDeletePhase"
			@add-round="handleAddRound"
			@sync-matches="handleSyncRoundMatches"
			@enable-manual-override="handleEnableManualOverride"
			@edit-round="handleEditRound"
			@delete-round="handleDeleteRound"
		/>

		<template #empty-actions>
			<UButton icon="i-lucide-plus" @click="handleAddPhase">
				Add Phase
			</UButton>
		</template>
	</UICollectionPage>
</template>
