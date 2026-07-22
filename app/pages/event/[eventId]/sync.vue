<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { LazyUIConfirmActionModal } from '#components';
import { useMeleeSyncUnresolvedDeckListResolution } from '~/modules/melee-sync/unresolvedDeckLists';
import { formatSyncTimestamp } from '~/utils/meleeSync';

definePageMeta({
	title: 'Sync',
	layout: false,
	middleware: 'sync',
});

const meleeStore = useMeleeStore();
const roundStore = useRoundStore();
const phaseStore = usePhaseStore();
const overlay = useOverlay();
const { runRequest } = useRequestFeedback();

const { event, eventId, hasLastError, isSetupComplete, isAnySyncRunning, statusDescription } = useMeleeSyncOverview();

const selectedSpecificRoundId = ref<number | undefined>();
const {
	unresolvedDeckCards,
	unresolvedDeckCardsLoading,
	unresolvedDeckCardsError,
	resolveModalOpen,
	selectedUnresolvedGroupKey,
	resolveSearchTerm,
	resolveSearchLoading,
	resolveSearchError,
	resolvingScryfallId,
	resolveSearchResults,
	firstResolveSearchResult,
	unresolvedDeckCardGroups,
	unresolvedDeckCardsCountLabel,
	activeUnresolvedGroupIndex,
	activeUnresolvedGroup,
	loadUnresolvedDeckCards,
	closeResolveModal,
	getResolveSearchImageUrl,
	debouncedSearchResolveCandidates,
	openResolveModal,
	goToPreviousUnresolvedGroup,
	goToNextUnresolvedGroup,
	resolveUnresolvedDeckCard,
	resolveFirstSearchResult,
	formatGroupEntryLabel,
} = useMeleeSyncUnresolvedDeckListResolution({ eventId, isSetupComplete });

const { initialLoading, initialError, retry } = useEventPageLoading([
	{ isLoaded: () => phaseStore.isLoaded, load: id => phaseStore.loadPhasesByEventId(id) },
	{ isLoaded: () => roundStore.isLoaded, load: id => roundStore.loadRoundsByEventId(id) },
]);

const connectionBadge = computed<{ color: 'success' | 'error'; label: string }>(() => {
	if (hasLastError.value) {
		return { color: 'error', label: 'Sync error' };
	}
	return { color: 'success', label: 'Melee connected' };
});

const initialSetupStepLabel = computed(() => {
	switch (meleeStore.setupStep) {
		case 'syncing':
			return 'Importing event structure, players, standings, and deck lists from Melee.gg.';
		case 'loading':
			return 'Reloading imported event data.';
		case 'complete':
			return 'Finalizing initial setup.';
		default:
			return 'Preparing initial setup.';
	}
});

const roundSyncStepLabel = computed(() => {
	switch (meleeStore.syncStep) {
		case 'syncing':
			return 'Syncing round data from Melee.gg.';
		case 'standings':
			return 'Refreshing players, standings, and round matches from Melee.gg.';
		case 'loading':
			return 'Reloading local round data.';
		case 'complete':
			return 'Round sync complete.';
		default:
			return 'Syncing round data.';
	}
});

const activeOperation = computed<null | { title: string; description: string }>(() => {
	if (meleeStore.runningSetup) {
		return {
			title: 'Initial Setup In Progress',
			description: initialSetupStepLabel.value,
		};
	}

	if (meleeStore.updatingFromMelee) {
		return {
			title: 'Melee Update In Progress',
			description: roundSyncStepLabel.value,
		};
	}

	if (meleeStore.syncingPlayers) {
		return {
			title: 'Player Sync In Progress',
			description: 'Refreshing players and standings from Melee.gg.',
		};
	}

	if (meleeStore.syncingDecklists) {
		return {
			title: 'Deck List Sync In Progress',
			description: 'Refreshing deck lists and card data from Melee.gg.',
		};
	}

	if (meleeStore.syncingRound) {
		return {
			title: 'Round Sync In Progress',
			description: roundSyncStepLabel.value,
		};
	}

	if (meleeStore.syncing) {
		return {
			title: 'Event Structure Sync In Progress',
			description: 'Refreshing the event structure from Melee.gg.',
		};
	}

	return null;
});

const includeDeckListsInUpdate = ref(false);
const refreshRoundDisabled = computed(() => !selectedSpecificRoundId.value || isAnySyncRunning.value);

const freshnessItems = computed(() => {
	if (!event.value) {
		return [];
	}

	return [
		{ label: 'Event structure', value: formatSyncTimestamp(event.value.lastEventSyncedAt) },
		{ label: 'Players and standings', value: formatSyncTimestamp(event.value.lastPlayersSyncedAt) },
		{ label: 'Deck lists', value: formatSyncTimestamp(event.value.lastDecklistsSyncedAt) },
	];
});

interface RoundRow {
	id: number;
	name: string;
	syncState: string;
	lastSyncedAt: Date | null;
	isNext: boolean;
}

const roundRows = computed<RoundRow[]>(() =>
	meleeStore.availableRounds.map((round) => {
		const phase = phaseStore.getPhaseById(round.phaseId);
		return {
			id: round.id,
			name: formatRoundOptionLabel(round, phase),
			syncState: round.lastSyncedAt ? 'Synced' : 'Not synced',
			lastSyncedAt: round.lastSyncedAt,
			isNext: meleeStore.nextUnsyncedRound?.id === round.id,
		};
	}),
);

const roundColumns: TableColumn<RoundRow>[] = [
	{ accessorKey: 'name', header: 'Round' },
	{ accessorKey: 'syncState', header: 'Sync State' },
	{ accessorKey: 'lastSyncedAt', header: 'Last Synced' },
];

const specificRoundOptions = computed(() =>
	roundRows.value.map(row => ({
		label: row.name,
		value: row.id,
	})),
);

watch(specificRoundOptions, (options) => {
	const hasSelection = options.some(option => option.value === selectedSpecificRoundId.value);
	if (hasSelection)
		return;

	selectedSpecificRoundId.value = options[0]?.value;
}, { immediate: true });

const selectedRoundLabel = computed(() =>
	specificRoundOptions.value.find(option => option.value === selectedSpecificRoundId.value)?.label ?? 'round',
);

function latestOperationToast() {
	const operation = meleeStore.lastOperation;
	if (!operation) {
		return null;
	}

	return {
		title: operation.title,
		description: operation.description,
		color: operation.status === 'success' ? 'success' : operation.status === 'warning' ? 'warning' : 'error',
	} as const;
}

function operationAlertColor(status: 'success' | 'warning' | 'error') {
	return status === 'success' ? 'success' : status === 'warning' ? 'warning' : 'error';
}

function operationAlertIcon(status: 'success' | 'warning' | 'error') {
	if (status === 'success')
		return 'i-lucide-check-circle-2';
	if (status === 'warning')
		return 'i-lucide-refresh-cw-off';
	return 'i-lucide-circle-alert';
}

useEnterToSubmit(resolveFirstSearchResult, {
	disabled: () =>
		!resolveModalOpen.value
		|| resolveSearchLoading.value
		|| resolvingScryfallId.value !== null
		|| !firstResolveSearchResult.value,
});

async function runStoreAction(action: () => Promise<unknown>) {
	if (isAnySyncRunning.value)
		return;

	await runRequest(action, {
		success: () => latestOperationToast() ?? false,
		error: ({ message }) => latestOperationToast() ?? {
			title: 'Operation Failed',
			description: message,
			color: 'error',
		},
		onSuccess: async () => {
			await loadUnresolvedDeckCards();
		},
		onFailure: async () => {
			await loadUnresolvedDeckCards();
		},
	});
}

async function confirmAndRun(
	title: string,
	message: string,
	confirmLabel: string,
	action: () => Promise<unknown>,
	options: { destructive?: boolean } = {},
) {
	const modal = overlay.create(LazyUIConfirmActionModal);
	const confirmed = await modal.open({
		title,
		message,
		confirmLabel,
		confirmColor: options.destructive ? 'error' : 'primary',
		icon: options.destructive ? 'i-lucide-triangle-alert' : 'i-lucide-refresh-cw',
		iconColor: options.destructive ? 'text-error' : 'text-primary',
	}).result;

	if (!confirmed)
		return;

	await runStoreAction(action);
}

async function handleRefreshPlayers() {
	await confirmAndRun(
		'Refresh Players',
		'Re-fetch player records and standings from Melee.gg. Deck lists and match results are not affected.',
		'Refresh Players',
		() => meleeStore.syncPlayers(),
	);
}

async function handleRefreshDecklists() {
	await confirmAndRun(
		'Refresh Deck Lists',
		'Re-fetch deck lists and card data from Melee.gg for players already in the event.',
		'Refresh Deck Lists',
		() => meleeStore.syncDecklists(),
	);
}

async function handleRefreshRound() {
	if (!selectedSpecificRoundId.value)
		return;

	const roundLabel = selectedRoundLabel.value;
	await confirmAndRun(
		'Refresh Round Matches',
		`Re-sync matches for ${roundLabel} from Melee.gg. Local results for this round will be replaced.`,
		'Refresh Round',
		() => meleeStore.syncSpecificRound(selectedSpecificRoundId.value!),
	);
}

async function handleResetEventStructure() {
	await confirmAndRun(
		'Reset Event Structure',
		'Re-fetch the event structure from Melee.gg. The local phase and round layout will be replaced with whatever Melee returns. Any local edits to rounds will be lost.',
		'Reset Structure',
		() => meleeStore.syncEvent(),
		{ destructive: true },
	);
}

async function handleInitialSetup() {
	await runStoreAction(() => meleeStore.runInitialSetup());
}

async function handleUpdateFromMelee() {
	await runStoreAction(() => meleeStore.updateFromMelee({ includeDeckLists: includeDeckListsInUpdate.value }));
}
</script>

<template>
	<NuxtLayout name="default">
		<template #actions>
			<UButton
				color="neutral"
				variant="ghost"
				:to="`/event/${eventId}/config/integrations`"
			>
				Manage Integration
			</UButton>
		</template>

		<template #toolbar>
			<UDashboardToolbar>
				<template #left>
					<div class="flex items-center gap-3">
						<UBadge
							:color="connectionBadge.color"
							variant="subtle"
							size="sm"
						>
							{{ connectionBadge.label }}
						</UBadge>
						<span class="text-sm text-muted">
							{{ meleeStore.syncedRoundCount }} / {{ meleeStore.totalRoundCount }} rounds synced
						</span>
					</div>
				</template>
			</UDashboardToolbar>
		</template>

		<UContainer class="max-w-4xl">
			<UIInitialLoadError v-if="initialError" :error="initialError" @retry="retry" />

			<UILoadingSpinner v-else-if="initialLoading" />

			<div v-else class="flex flex-col gap-4">
				<UAlert
					v-if="activeOperation"
					color="primary"
					variant="subtle"
					icon="i-lucide-loader-circle"
					:title="activeOperation.title"
					:description="activeOperation.description"
				/>

				<UAlert
					v-if="event?.lastSyncError"
					color="warning"
					variant="subtle"
					icon="i-lucide-triangle-alert"
					title="Sync Attention Needed"
					:description="event.lastSyncError"
				/>

				<UCard v-if="!isSetupComplete">
					<template #header>
						<div class="flex items-center gap-2">
							<UIcon name="i-lucide-route" class="text-muted" />
							<span class="font-semibold text-sm">Initial Setup</span>
						</div>
					</template>

					<div class="flex flex-col gap-3">
						<p class="text-sm text-muted">
							{{ statusDescription }}
						</p>
						<p v-if="meleeStore.runningSetup" class="text-sm font-medium">
							{{ initialSetupStepLabel }}
						</p>
						<UAlert
							v-else-if="meleeStore.lastOperation"
							:title="meleeStore.lastOperation.title"
							:description="meleeStore.lastOperation.description"
							:color="operationAlertColor(meleeStore.lastOperation.status)"
							:icon="operationAlertIcon(meleeStore.lastOperation.status)"
							variant="subtle"
						/>
						<div class="flex flex-wrap gap-2">
							<UButton
								:loading="meleeStore.runningSetup"
								:disabled="isAnySyncRunning"
								@click="handleInitialSetup"
							>
								Run Initial Setup
							</UButton>
							<UButton
								color="neutral"
								variant="ghost"
								:to="`/event/${eventId}/config/integrations`"
								:disabled="isAnySyncRunning"
							>
								Manage Integration
							</UButton>
						</div>
					</div>
				</UCard>

				<UCard v-else>
					<template #header>
						<div class="flex items-center gap-2">
							<UIcon name="i-lucide-clock" class="text-muted" />
							<span class="font-semibold text-sm">Data Freshness</span>
						</div>
					</template>
					<div class="divide-y divide-default">
						<div
							v-for="item in freshnessItems"
							:key="item.label"
							class="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
						>
							<div class="text-sm text-muted">
								{{ item.label }}
							</div>
							<div class="text-sm font-medium text-right">
								{{ item.value }}
							</div>
						</div>
					</div>
				</UCard>

				<UCard v-if="isSetupComplete">
					<template #header>
						<div class="flex items-center gap-2">
							<UIcon name="i-lucide-refresh-cw" class="text-muted" />
							<span class="font-semibold text-sm">Update from Melee</span>
						</div>
					</template>

					<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
						<div class="flex flex-col gap-2">
							<p class="text-sm text-muted">
								Refresh players, current standings, round results, and import the next unsynced round when available.
							</p>
							<UCheckbox
								v-model="includeDeckListsInUpdate"
								label="Also refresh deck lists"
								:disabled="isAnySyncRunning"
							/>
						</div>
						<UButton
							class="shrink-0"
							:loading="meleeStore.updatingFromMelee"
							:disabled="isAnySyncRunning"
							@click="handleUpdateFromMelee"
						>
							Update from Melee
						</UButton>
					</div>
				</UCard>

				<UCard v-if="isSetupComplete && roundRows.length > 0" :ui="{ body: 'p-0 sm:p-0' }">
					<template #header>
						<div class="flex items-center gap-2">
							<UIcon name="i-lucide-list-ordered" class="text-muted" />
							<span class="font-semibold text-sm">Round Sync Status</span>
						</div>
					</template>
					<UTable :data="roundRows" :columns="roundColumns">
						<template #syncState-cell="{ row }">
							<UBadge variant="subtle" :color="row.original.lastSyncedAt ? 'success' : 'neutral'" size="sm">
								{{ row.original.syncState }}
							</UBadge>
						</template>
						<template #lastSyncedAt-cell="{ row }">
							<div class="flex items-center gap-2">
								<span class="text-sm" :class="{ 'text-muted': !row.original.lastSyncedAt }">
									{{ row.original.lastSyncedAt ? formatSyncTimestamp(row.original.lastSyncedAt) : 'Pending sync' }}
								</span>
								<UBadge
									v-if="row.original.isNext"
									variant="soft"
									color="primary"
									size="sm"
								>
									Next
								</UBadge>
							</div>
						</template>
					</UTable>
				</UCard>

				<UCard v-if="isSetupComplete">
					<template #header>
						<div class="flex items-center gap-2">
							<UIcon name="i-lucide-wrench" class="text-muted" />
							<span class="font-semibold text-sm">Advanced Recovery Tools</span>
						</div>
					</template>

					<UAlert
						v-if="meleeStore.lastOperation"
						class="mb-4"
						:title="meleeStore.lastOperation.title"
						:description="meleeStore.lastOperation.description"
						:color="operationAlertColor(meleeStore.lastOperation.status)"
						:icon="operationAlertIcon(meleeStore.lastOperation.status)"
						variant="subtle"
					>
						<template v-if="meleeStore.lastOperation.details?.length" #description>
							<div class="flex flex-col gap-2">
								<p>{{ meleeStore.lastOperation.description }}</p>
								<ul class="list-disc pl-5 text-sm">
									<li v-for="detail in meleeStore.lastOperation.details" :key="detail">
										{{ detail }}
									</li>
								</ul>
							</div>
						</template>
					</UAlert>

					<div class="divide-y divide-default">
						<div class="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
							<div>
								<h3 class="font-medium text-sm">
									Refresh Players
								</h3>
								<p class="text-sm text-muted">
									Re-fetch player records and standings from Melee.gg without changing deck lists or matches.
								</p>
							</div>
							<UButton
								variant="outline"
								class="shrink-0"
								:loading="meleeStore.syncingPlayers"
								:disabled="isAnySyncRunning"
								@click="handleRefreshPlayers"
							>
								Refresh Players
							</UButton>
						</div>

						<div class="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
							<div>
								<h3 class="font-medium text-sm">
									Refresh Deck Lists
								</h3>
								<p class="text-sm text-muted">
									Re-fetch deck lists and card data for players already imported into the event.
								</p>
							</div>
							<UButton
								variant="outline"
								class="shrink-0"
								:loading="meleeStore.syncingDecklists"
								:disabled="isAnySyncRunning"
								@click="handleRefreshDecklists"
							>
								Refresh Deck Lists
							</UButton>
						</div>

						<div class="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<h3 class="font-medium text-sm">
									Refresh Round Matches
								</h3>
								<p class="text-sm text-muted">
									Re-sync matches for the selected round. Use this when a round falls out of step with Melee.gg.
								</p>
							</div>
							<div class="flex items-center gap-2 shrink-0">
								<USelectMenu
									v-model="selectedSpecificRoundId"
									class="w-60"
									placeholder="Select round"
									value-key="value"
									:disabled="isAnySyncRunning"
									:items="specificRoundOptions"
								/>
								<UButton
									variant="outline"
									:loading="meleeStore.syncingRound"
									:disabled="refreshRoundDisabled"
									@click="handleRefreshRound"
								>
									Refresh Round
								</UButton>
							</div>
						</div>
					</div>
				</UCard>

				<UCard v-if="isSetupComplete">
					<template #header>
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div class="flex items-center gap-2">
								<UIcon name="i-lucide-file-warning" class="text-muted" />
								<span class="font-semibold text-sm">Unresolved Deck Cards</span>
							</div>
							<UButton
								v-if="unresolvedDeckCardGroups.length > 0"
								variant="outline"
								:disabled="unresolvedDeckCardsLoading"
								@click="openResolveModal()"
							>
								Review Unresolved Cards
							</UButton>
						</div>
					</template>

					<div class="flex flex-col gap-4">
						<p class="text-sm text-muted">
							Fix any deck entries that could not be matched during sync. Saved resolutions apply only to this event and will be reused on the next deck refresh.
						</p>

						<div v-if="unresolvedDeckCardsLoading" class="min-h-24 flex items-center justify-center">
							<UILoadingSpinner size="sm" label="Loading unresolved deck cards..." />
						</div>

						<div v-else-if="unresolvedDeckCardsError" class="flex flex-col items-start gap-3">
							<UAlert
								color="warning"
								variant="subtle"
								icon="i-lucide-cloud-off"
								title="Unresolved cards could not be loaded"
								:description="unresolvedDeckCardsError"
							/>
							<UButton variant="outline" @click="loadUnresolvedDeckCards">
								Retry
							</UButton>
						</div>

						<UIEmptyState
							v-else-if="unresolvedDeckCards.length === 0"
							variant="inline"
							icon="i-lucide-check-circle-2"
							:title="unresolvedDeckCardsCountLabel"
							description="All imported deck cards are resolved."
						/>

						<div v-else class="divide-y divide-default rounded-lg border border-default">
							<div
								v-for="group in unresolvedDeckCardGroups"
								:key="group.key"
								class="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
							>
								<div class="min-w-0">
									<div class="flex flex-wrap items-center gap-2">
										<h3 class="font-medium text-sm">
											{{ group.originalName }}
										</h3>
										<UBadge variant="soft" color="neutral" size="sm">
											{{ group.entryType === 'companion' ? 'Companion' : `${group.entryCount} matching entries` }}
										</UBadge>
										<UBadge
											v-if="group.setCode"
											variant="outline"
											color="neutral"
											size="sm"
										>
											{{ group.setCode.toUpperCase() }}
										</UBadge>
									</div>
									<p class="text-sm text-muted">
										{{ group.affectedPlayerCount }} player{{ group.affectedPlayerCount === 1 ? '' : 's' }} · {{ group.affectedDeckCount }} deck{{ group.affectedDeckCount === 1 ? '' : 's' }} affected
									</p>
									<p class="text-xs text-muted truncate">
										{{ group.entries[0]?.playerName }} · {{ group.entries[0]?.deckName }}<span v-if="group.entries[0]?.phaseName"> · {{ group.entries[0]?.phaseName }}</span>
									</p>
								</div>
								<UButton
									variant="outline"
									class="shrink-0"
									@click="openResolveModal(group.key)"
								>
									Review Group
								</UButton>
							</div>
						</div>
					</div>
				</UCard>

				<UCard v-if="isSetupComplete" class="ring-1 ring-error/40">
					<template #header>
						<div class="flex items-center gap-2">
							<UIcon name="i-lucide-triangle-alert" class="text-error" />
							<span class="font-semibold text-sm">Danger Zone</span>
						</div>
					</template>

					<div class="flex items-start justify-between gap-4">
						<div>
							<h3 class="font-medium text-sm">
								Reset Event Structure
							</h3>
							<p class="text-sm text-muted">
								Re-fetches the event structure from Melee.gg and replaces the local phase and round layout. Any local edits to rounds will be lost.
							</p>
						</div>
						<UButton
							color="error"
							variant="outline"
							class="shrink-0"
							:loading="meleeStore.syncing"
							:disabled="isAnySyncRunning"
							@click="handleResetEventStructure"
						>
							Reset Structure
						</UButton>
					</div>
				</UCard>
			</div>
		</UContainer>
		<UModal
			v-model:open="resolveModalOpen"
			:close="{ onClick: closeResolveModal }"
			:ui="{ content: 'sm:max-w-6xl' }"
		>
			<template #title>
				Resolve Deck Cards
			</template>
			<template #description>
				Review unresolved imports as a queue. Resolving one group will fix every matching unresolved entry for this event and save the correction for the next deck sync.
			</template>
			<template #body>
				<div v-if="unresolvedDeckCardGroups.length > 0" class="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
					<div class="flex flex-col gap-3">
						<div class="rounded-lg border border-default p-3">
							<p class="text-sm font-medium">
								{{ activeUnresolvedGroupIndex + 1 }} / {{ unresolvedDeckCardGroups.length }} groups
							</p>
							<p class="text-xs text-muted mt-1">
								{{ unresolvedDeckCards.length }} unresolved entr{{ unresolvedDeckCards.length === 1 ? 'y' : 'ies' }} remaining
							</p>
						</div>

						<div class="divide-y divide-default rounded-lg border border-default overflow-hidden">
							<button
								v-for="group in unresolvedDeckCardGroups"
								:key="group.key"
								type="button"
								class="w-full p-3 text-left transition-colors"
								:class="group.key === activeUnresolvedGroup?.key ? 'bg-primary/8' : 'hover:bg-elevated/50'"
								:disabled="resolvingScryfallId !== null"
								@click="selectedUnresolvedGroupKey = group.key"
							>
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0">
										<p class="font-medium text-sm truncate">
											{{ group.originalName }}
										</p>
										<p class="text-xs text-muted truncate mt-1">
											{{ group.affectedDeckCount }} deck{{ group.affectedDeckCount === 1 ? '' : 's' }} · {{ group.entryCount }} entr{{ group.entryCount === 1 ? 'y' : 'ies' }}
										</p>
									</div>
									<UBadge variant="soft" color="neutral" size="sm">
										{{ group.entryType === 'companion' ? 'Companion' : 'Card' }}
									</UBadge>
								</div>
							</button>
						</div>
					</div>

					<div v-if="activeUnresolvedGroup" class="flex flex-col gap-4 min-w-0">
						<div class="rounded-lg border border-default p-4">
							<div class="flex flex-wrap items-center gap-2">
								<p class="text-base font-semibold">
									{{ activeUnresolvedGroup.originalName }}
								</p>
								<UBadge variant="soft" color="neutral" size="sm">
									{{ activeUnresolvedGroup.entryType === 'companion' ? 'Companion' : `${activeUnresolvedGroup.entryCount} matching entries` }}
								</UBadge>
								<UBadge
									v-if="activeUnresolvedGroup.setCode"
									variant="outline"
									color="neutral"
									size="sm"
								>
									{{ activeUnresolvedGroup.setCode.toUpperCase() }}
								</UBadge>
							</div>
							<p class="text-sm text-muted mt-2">
								Resolving this group will fix {{ activeUnresolvedGroup.entryCount }} matching entr{{ activeUnresolvedGroup.entryCount === 1 ? 'y' : 'ies' }} across {{ activeUnresolvedGroup.affectedPlayerCount }} player{{ activeUnresolvedGroup.affectedPlayerCount === 1 ? '' : 's' }} and save an event-specific override.
							</p>
						</div>

						<div class="rounded-lg border border-default">
							<div class="border-b border-default px-4 py-3">
								<p class="text-sm font-medium">
									Affected Decks
								</p>
							</div>
							<div class="max-h-52 divide-y divide-default overflow-y-auto">
								<div
									v-for="entry in activeUnresolvedGroup.entries"
									:key="entry.id"
									class="px-4 py-3"
								>
									<p class="text-sm font-medium">
										{{ entry.playerName }}
									</p>
									<p class="text-sm text-muted">
										{{ entry.deckName }}<span v-if="entry.phaseName"> · {{ entry.phaseName }}</span>
									</p>
									<p class="text-xs text-muted mt-1">
										{{ formatGroupEntryLabel(entry) }}
									</p>
								</div>
							</div>
						</div>

						<UInput
							v-model="resolveSearchTerm"
							placeholder="Search Scryfall for the intended card"
							:loading="resolveSearchLoading"
							@update:model-value="debouncedSearchResolveCandidates"
						/>

						<UAlert
							v-if="resolveSearchError"
							color="warning"
							variant="subtle"
							icon="i-lucide-cloud-off"
							title="Card search unavailable"
							:description="resolveSearchError"
						/>

						<div v-else-if="resolveSearchResults.length > 0" class="divide-y divide-default rounded-lg border border-default">
							<button
								v-for="card in resolveSearchResults"
								:key="card.id"
								type="button"
								class="flex w-full items-center gap-3 p-3 text-left hover:bg-elevated/50 transition-colors"
								:disabled="resolvingScryfallId !== null"
								@click="resolveUnresolvedDeckCard(card)"
							>
								<img
									v-if="getResolveSearchImageUrl(card)"
									:src="getResolveSearchImageUrl(card)!"
									:alt="card.name"
									class="h-12 w-9 rounded object-cover border border-default"
								>
								<div class="min-w-0 flex-1">
									<p class="font-medium text-sm truncate">
										{{ card.name }}
									</p>
									<p class="text-xs text-muted">
										{{ card.set.toUpperCase() }}<span v-if="card.set_name"> · {{ card.set_name }}</span>
									</p>
								</div>
								<UIcon
									v-if="resolvingScryfallId === card.id"
									name="i-lucide-loader-circle"
									class="animate-spin text-primary"
								/>
							</button>
						</div>

						<UIEmptyState
							v-else-if="!resolveSearchLoading && resolveSearchTerm.trim().length >= 2"
							variant="inline"
							icon="i-lucide-search-x"
							title="No cards found"
							description="Try a broader search term or a different spelling."
						/>
					</div>
				</div>

				<UAlert
					v-else-if="unresolvedDeckCardsError"
					color="warning"
					variant="subtle"
					icon="i-lucide-cloud-off"
					title="Unresolved cards could not be loaded"
					:description="unresolvedDeckCardsError"
				/>

				<UIEmptyState
					v-else
					variant="inline"
					icon="i-lucide-check-circle-2"
					title="Everything resolved"
					description="There are no unresolved deck cards left to review."
				/>
			</template>
			<template #footer>
				<div class="flex justify-between items-center gap-4 w-full">
					<div class="flex items-center gap-2">
						<UButton
							color="neutral"
							variant="ghost"
							:disabled="activeUnresolvedGroupIndex <= 0 || resolvingScryfallId !== null"
							@click="goToPreviousUnresolvedGroup"
						>
							Previous
						</UButton>
						<UButton
							color="neutral"
							variant="ghost"
							:disabled="activeUnresolvedGroupIndex < 0 || activeUnresolvedGroupIndex >= unresolvedDeckCardGroups.length - 1 || resolvingScryfallId !== null"
							@click="goToNextUnresolvedGroup"
						>
							Skip
						</UButton>
					</div>
					<UButton color="neutral" variant="ghost" @click="closeResolveModal">
						Close
					</UButton>
				</div>
			</template>
		</UModal>
	</NuxtLayout>
</template>
