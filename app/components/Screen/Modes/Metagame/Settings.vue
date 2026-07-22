<script setup lang="ts">
import type {
	MetagameArchetypeColumnKey,
	MetagameCardColumnKey,
	MetagameCardSortBy,
	MetagameScope,
	MetagameSortBy,
	MetagameViewMode,
} from '~~/shared/types/enums';
import type {
	MetagameArchetypeColumnConfig,
	MetagameCardColumnConfig,
} from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { VueDraggable } from 'vue-draggable-plus';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'metagame',
);

defineExpose({ resetConfig, saving });

const playerStore = usePlayerStore();
const playerListStore = usePlayerListStore();

onMounted(async () => {
	if (!props.eventId) {
		return;
	}

	if (!playerStore.isLoaded) {
		await playerStore.loadPlayersByEventId(props.eventId);
	}

	if (!playerListStore.isLoaded) {
		await playerListStore.loadByEventId(props.eventId);
	}
});

const viewModeOptions = [
	{ label: 'Archetypes', value: 'archetype' },
	{ label: 'Cards', value: 'cards' },
];

const scopeOptions = computed(() => {
	const options = [
		{ label: 'All Players', value: 'all' },
		{ label: 'Top N', value: 'topN' },
	];

	if (playerListStore.lists.length > 0) {
		options.push({ label: 'Player List', value: 'playerList' });
	}

	return options;
});

const playerListOptions = computed(() => [
	{ label: 'Select a list...', value: null },
	...playerListStore.lists.map(list => ({
		label: `${list.name} (${list.memberCount})`,
		value: list.id,
	})),
]);

const sortByOptions = [
	{ label: 'Meta Share', value: 'metaShare' },
	{ label: 'Count', value: 'count' },
	{ label: 'Win Rate', value: 'winRate' },
];

const cardSortByOptions = [
	{ label: 'Inclusion Rate', value: 'inclusionRate' },
	{ label: 'Avg Copies', value: 'avgCopies' },
	{ label: 'Total Copies', value: 'totalCopies' },
];

type ActiveMetagameColumnConfig = MetagameArchetypeColumnConfig | MetagameCardColumnConfig;

const localColumns = ref<ActiveMetagameColumnConfig[]>([]);

const columnLabels: Record<MetagameArchetypeColumnKey | MetagameCardColumnKey, string> = {
	archetype: 'Archetype',
	count: 'Count',
	metaShare: 'Share',
	winRate: 'Win Rate',
	avgPlace: 'Avg Place',
	colors: 'Colors',
	card: 'Card',
	manaCost: 'Cost',
	type: 'Type',
	inclusionRate: 'Inclusion',
	avgCopies: 'Avg Copies',
	totalCopies: 'Total Copies',
	deckCount: 'Decks',
	mainboardCount: 'Main',
	sideboardCount: 'Side',
};

const activeColumns = computed<ActiveMetagameColumnConfig[]>(() =>
	config.value.viewMode === 'cards'
		? config.value.cardColumns
		: config.value.archetypeColumns,
);

watch(activeColumns, (columns) => {
	localColumns.value = columns.map(column => ({ ...column }));
}, { immediate: true, deep: true });

function persistColumns(columns: ActiveMetagameColumnConfig[]) {
	if (config.value.viewMode === 'cards') {
		updateConfig({ cardColumns: columns as MetagameCardColumnConfig[] });
		return;
	}

	updateConfig({ archetypeColumns: columns as MetagameArchetypeColumnConfig[] });
}

function onColumnDragEnd() {
	persistColumns([...localColumns.value]);
}

function toggleColumnVisibility(index: number) {
	const columns = [...localColumns.value];
	columns[index] = { ...columns[index]!, visible: !columns[index]!.visible };
	localColumns.value = columns;
	persistColumns(columns);
}

function updateMaxTableWidth(value: number | null | undefined) {
	updateConfig({ maxTableWidth: value ?? null });
}

const estimatedRowCount = computed(() => {
	if (config.value.viewMode === 'cards') {
		return config.value.limit;
	}

	if (config.value.scope === 'topN') {
		return config.value.topN;
	}

	if (config.value.scope === 'playerList') {
		const list = playerListStore.lists.find(item => item.id === config.value.playerListId);
		return list?.memberCount ?? 0;
	}

	return playerStore.players.length;
});

const totalPages = computed(() =>
	Math.max(1, Math.ceil(Math.max(estimatedRowCount.value, 1) / config.value.pageSize)),
);

const currentPage = computed(() =>
	Math.min(config.value.currentPage ?? 1, totalPages.value),
);

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
				label="Display"
				description="Choose the metagame table to show."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.viewMode"
					:items="viewModeOptions"
					class="w-48"
					@update:model-value="updateConfig({ viewMode: $event as MetagameViewMode, currentPage: 1 })"
				/>
			</UFormField>

			<UFormField
				label="Player scope"
				description="Which players to include in the breakdown."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.scope"
					:items="scopeOptions"
					class="w-48"
					@update:model-value="updateConfig({ scope: $event as MetagameScope, currentPage: 1 })"
				/>
			</UFormField>

			<UFormField
				v-if="config.scope === 'topN'"
				label="Top N"
				description="Include the top N players by position."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.topN"
					:min="1"
					:max="500"
					class="w-32"
					@update:model-value="updateConfig({ topN: Number($event), currentPage: 1 })"
				/>
			</UFormField>

			<template v-if="config.scope === 'playerList'">
				<template v-if="playerListStore.lists.length > 0">
					<UFormField
						label="Select list"
						description="Include players from this list only."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<USelect
							:model-value="config.playerListId ?? null"
							:items="playerListOptions"
							class="w-64"
							@update:model-value="updateConfig({ playerListId: $event ?? undefined, currentPage: 1 })"
						/>
					</UFormField>
				</template>
				<div v-else class="text-sm text-muted text-center py-2">
					No player lists available. Create one on the Players page.
				</div>
			</template>

			<UFormField
				v-if="config.viewMode === 'archetype'"
				label="Sort archetypes by"
				description="Order archetypes using this metric."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.sortBy"
					:items="sortByOptions"
					class="w-48"
					@update:model-value="updateConfig({ sortBy: $event as MetagameSortBy, currentPage: 1 })"
				/>
			</UFormField>

			<template v-else>
				<UFormField
					label="Sort cards by"
					description="Order cards using this metric."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="config.cardSortBy"
						:items="cardSortByOptions"
						class="w-48"
						@update:model-value="updateConfig({ cardSortBy: $event as MetagameCardSortBy, currentPage: 1 })"
					/>
				</UFormField>

				<UFormField
					label="Card limit"
					description="Maximum number of card rows to include."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="config.limit"
						:min="1"
						:max="500"
						class="w-32"
						@update:model-value="updateConfig({ limit: Number($event), currentPage: 1 })"
					/>
				</UFormField>

				<UFormField
					label="Archetype filter"
					description="Limit cards to a single archetype. Leave empty for all archetypes."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInput
						:model-value="config.archetypeFilter ?? ''"
						placeholder="All archetypes"
						class="w-64"
						@update:model-value="updateConfig({ archetypeFilter: $event || undefined, currentPage: 1 })"
					/>
				</UFormField>
			</template>
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

			<USeparator />

			<UFormField
				label="Max table width"
				description="Optional cap in pixels. Leave empty to fill the available width."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.maxTableWidth ?? null"
					placeholder="Auto"
					:min="1"
					class="w-32"
					@update:model-value="updateMaxTableWidth($event)"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				label="Show header"
				description="Show the metagame title above the table."
				:model-value="config.showHeader"
				@update:model-value="updateConfig({ showHeader: $event })"
			/>

			<UFormField
				v-if="config.showHeader"
				label="Custom header text"
				description="Leave empty for an auto-generated title."
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
				description="Number of table rows shown per page."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.pageSize"
					:min="1"
					:max="100"
					class="w-32"
					@update:model-value="updateConfig({ pageSize: Number($event), currentPage: 1 })"
				/>
			</UFormField>

			<USeparator />

			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Automatic Paging
			</p>

			<ScreenSettingsToggle
				label="Auto-page"
				description="Automatically cycle through table pages."
				:model-value="config.autoPaging"
				@update:model-value="updateConfig({ autoPaging: $event })"
			/>

			<UFormField
				v-if="config.autoPaging"
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
					size="sm"
					:disabled="totalPages <= 1"
					@click="adminPrevPage"
				/>
				<span class="text-sm text-muted px-2">
					Page {{ currentPage }} of {{ totalPages }}
				</span>
				<UButton
					icon="i-lucide-chevron-right"
					variant="outline"
					size="sm"
					:disabled="totalPages <= 1"
					@click="adminNextPage"
				/>
			</div>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Animation">
			<ScreenSettingsToggle
				label="Animate entries"
				description="Animate row changes when the table updates."
				:model-value="config.animateEntries"
				@update:model-value="updateConfig({ animateEntries: $event })"
			/>
		</ScreenSettingsCard>
	</div>
</template>
