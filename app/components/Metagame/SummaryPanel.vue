<script setup lang="ts">
import type { MetagameSummaryResponse } from '~~/shared/types/metagame';

const props = defineProps<{
	summary: MetagameSummaryResponse | null;
	loading?: boolean;
}>();

const eventStore = useEventStore();
const metagameStore = useMetagameStore();
const playerListStore = usePlayerListStore();

const isMtg = computed(() => eventStore.event?.game === 'mtg');

const scopeLabel = computed(() => {
	if (metagameStore.scope === 'topN')
		return `Top ${metagameStore.topN}`;

	if (metagameStore.scope === 'minPoints')
		return `${metagameStore.minPoints}+ Points`;

	if (metagameStore.scope === 'playerList' && metagameStore.playerListId != null) {
		const list = playerListStore.lists.find(entry => entry.id === metagameStore.playerListId);
		return list ? `Player List: ${list.name}` : `Player List #${metagameStore.playerListId}`;
	}

	return 'All Players';
});

const stats = computed(() => {
	if (!props.summary)
		return [];

	const values: Array<{ label: string; value: string | number | null }> = [
		{ label: 'Players', value: props.summary.totalPlayers },
		{ label: 'Classified', value: `${props.summary.classifiedPlayers} / ${props.summary.totalPlayers}` },
		{ label: 'Archetypes', value: props.summary.scopedArchetypeCount },
	];

	if (isMtg.value)
		values.splice(2, 0, { label: 'Decklists', value: `${props.summary.totalDecks} / ${props.summary.totalPlayers}` });

	return values;
});
</script>

<template>
	<UCard>
		<template #header>
			<div class="flex items-center justify-between gap-3 flex-wrap">
				<div>
					<h2 class="text-base font-semibold">
						Metagame Overview
					</h2>
					<p class="text-sm text-muted mt-1">
						Current scope totals.
					</p>
				</div>
				<UBadge variant="subtle" color="neutral">
					{{ scopeLabel }}
				</UBadge>
			</div>
		</template>

		<div v-if="loading && !summary" class="flex items-center justify-center py-8">
			<UILoadingSpinner />
		</div>

		<div v-else-if="summary" class="flex flex-col gap-6">
			<MetagameStatStrip :stats="stats" />
		</div>
	</UCard>
</template>
