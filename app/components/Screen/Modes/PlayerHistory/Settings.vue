<script setup lang="ts">
import type { PlayerHistoryColumnConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { VueDraggable } from 'vue-draggable-plus';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const playerStore = usePlayerStore();
const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'player-history',
);

defineExpose({ resetConfig, saving });

const playerOptions = computed(() => [
	{ label: 'Select a player…', value: null },
	...playerStore.players.map(player => ({ label: player.name, value: player.id })),
]);

const estimatedRowCount = ref(0);
const loadingHistory = ref(false);
let requestId = 0;

const columnLabels: Record<string, string> = {
	round: 'Round',
	opponent: 'Opponent',
	table: 'Table',
	outcome: 'Outcome',
};

const localColumns = ref<PlayerHistoryColumnConfig[]>([...config.value.columns]);

watch(() => config.value.columns, (columns) => {
	localColumns.value = columns.map(column => ({ ...column }));
}, { deep: true });

function onColumnDragEnd() {
	updateConfig({ columns: [...localColumns.value] });
}

function toggleColumnVisibility(index: number) {
	const columns = [...localColumns.value];
	columns[index] = { ...columns[index]!, visible: !columns[index]!.visible };
	localColumns.value = columns;
	updateConfig({ columns });
}

const totalPages = computed(() =>
	Math.max(1, Math.ceil(Math.max(estimatedRowCount.value, 1) / config.value.rowsPerPage)),
);

const currentPage = computed(() =>
	Math.min(config.value.currentPage ?? 1, totalPages.value),
);

onMounted(async () => {
	if (props.eventId && !playerStore.isLoaded) {
		await playerStore.loadPlayersByEventId(props.eventId);
	}
});

watch(() => config.value.playerId, async (playerId) => {
	const id = ++requestId;
	estimatedRowCount.value = 0;

	if (!playerId) {
		return;
	}

	loadingHistory.value = true;
	try {
		const data = await $fetch<{ history: unknown[] }>(`/api/events/${props.eventId}/players/${playerId}/match-history`);
		if (id === requestId) {
			estimatedRowCount.value = data.history.length;
		}
	}
	finally {
		if (id === requestId) {
			loadingHistory.value = false;
		}
	}
}, { immediate: true });

function adminNextPage() {
	const next = currentPage.value < totalPages.value ? currentPage.value + 1 : 1;
	updateConfig({ currentPage: next });
}

function adminPrevPage() {
	const prev = currentPage.value > 1 ? currentPage.value - 1 : totalPages.value;
	updateConfig({ currentPage: prev });
}
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Data">
			<UFormField
				label="Player"
				description="Select the player whose match history should be shown."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.playerId"
					:items="playerOptions"
					class="w-64"
					@update:model-value="updateConfig({ playerId: $event, currentPage: 1 })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Columns" subtitle="Drag to reorder, toggle to show/hide.">
			<VueDraggable
				v-model="localColumns"
				:animation="150"
				handle=".drag-handle"
				ghost-class="opacity-30"
				class="flex flex-col gap-1"
				@end="onColumnDragEnd"
			>
				<div
					v-for="(column, index) in localColumns"
					:key="column.key"
					class="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-elevated/50 border border-default"
				>
					<UIcon
						name="i-lucide-grip-vertical"
						class="drag-handle cursor-grab active:cursor-grabbing text-muted shrink-0"
					/>
					<span class="flex-1 text-sm" :class="{ 'text-muted': !column.visible }">
						{{ columnLabels[column.key] ?? column.key }}
					</span>
					<USwitch
						:model-value="column.visible"
						size="sm"
						@update:model-value="toggleColumnVisibility(index)"
					/>
				</div>
			</VueDraggable>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				label="Show header"
				description="Show the player name and record above the match history."
				:model-value="config.showHeader"
				@update:model-value="updateConfig({ showHeader: $event })"
			/>

			<UFormField
				v-if="config.showHeader"
				label="Custom header text"
				description="Leave empty for the player's name and match history."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInput
					:model-value="config.headerText ?? ''"
					placeholder="Auto"
					class="w-64"
					@update:model-value="updateConfig({ headerText: $event || undefined })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Pagination">
			<UFormField
				label="Rows per page"
				description="Number of match rows shown per page."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.rowsPerPage"
					:min="1"
					:max="100"
					class="w-32"
					@update:model-value="updateConfig({ rowsPerPage: Number($event), currentPage: 1 })"
				/>
			</UFormField>

			<USeparator />

			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Automatic Paging
			</p>

			<ScreenSettingsToggle
				label="Auto-page"
				description="Automatically cycle through match history pages."
				:model-value="config.autoPageEnabled"
				@update:model-value="updateConfig({ autoPageEnabled: $event })"
			/>

			<UFormField
				v-if="config.autoPageEnabled"
				label="Interval (seconds)"
				description="Time between page transitions."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="Math.round(config.autoPageIntervalMs / 1000)"
					:min="3"
					:max="60"
					class="w-32"
					@update:model-value="updateConfig({ autoPageIntervalMs: Number($event) * 1000 })"
				/>
			</UFormField>

			<USeparator />

			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Manual Page Controls
			</p>

			<div class="flex items-center justify-center gap-2 max-sm:flex-wrap">
				<UButton
					icon="i-lucide-chevron-left"
					variant="outline"
					:disabled="totalPages <= 1 || loadingHistory"
					@click="adminPrevPage"
				>
					Previous
				</UButton>
				<span class="text-sm text-muted min-w-24 text-center">
					Page {{ currentPage }} of {{ totalPages }}
				</span>
				<UButton
					trailing-icon="i-lucide-chevron-right"
					variant="outline"
					:disabled="totalPages <= 1 || loadingHistory"
					@click="adminNextPage"
				>
					Next
				</UButton>
			</div>
		</ScreenSettingsCard>
	</div>
</template>
