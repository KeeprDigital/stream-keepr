<script setup lang="ts">
import type { BoardSelection, MetagameConversionMetric } from '~~/shared/types/enums';
import type { CardTypeBucket } from '~~/shared/utils/metagame';
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { CARD_TYPE_BUCKET_ORDER } from '~~/shared/utils/metagame';
import { useConsumedEventData } from '~/modules/event-data/resync';
import { useMetagameClient } from '~/modules/metagame/client';
import { useRotationConfigWrites } from '~/modules/screen-mode/rotationWrites';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig: saveConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'archetype-spotlight',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498).
// Edits still go through the Page Rotation's `updateConfig` below (ADR-0039).
const fields = screenModeConfigContract('archetype-spotlight').fields;

const archetypeStore = useArchetypeStore();
const playerListStore = usePlayerListStore();
const metagameClient = useMetagameClient();

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['archetypes', 'playerLists']);

onMounted(async () => {
	if (!props.eventId)
		return;

	if (!archetypeStore.isLoaded)
		await archetypeStore.loadByEventId(props.eventId);

	if (!playerListStore.isLoaded)
		await playerListStore.loadByEventId(props.eventId);
});

const archetypeOptions = computed(() => [
	{ label: 'Select an archetype…', value: null },
	...archetypeStore.archetypes.map(archetype => ({ label: archetype.name, value: archetype.id })),
]);

const conversionMetricOptions = [
	{ label: 'Top N', value: 'topN' },
	{ label: 'Minimum Points', value: 'minPoints' },
];

const boardOptions = [
	{ label: 'Full Deck', value: 'full' },
	{ label: 'Mainboard', value: 'mainboard' },
	{ label: 'Sideboard', value: 'sideboard' },
];

// How many pilots the Archetype has in the scope, for the manual page controls:
// the archetype page's own read for the same scope.
const pilotCount = ref(0);
const loadingPilots = ref(false);
let requestId = 0;

watch(
	() => [config.value.archetypeId, config.value.scope, config.value.topN, config.value.minPoints, config.value.playerListId] as const,
	async ([archetypeId, scope, topN, minPoints, playerListId]) => {
		const id = ++requestId;
		pilotCount.value = 0;

		if (archetypeId == null || !props.eventId)
			return;

		loadingPilots.value = true;
		try {
			const detail = await metagameClient.loadArchetypeDetail(props.eventId, archetypeId, { scope, topN, minPoints, playerListId });
			if (id === requestId)
				pilotCount.value = detail.playerCount ?? 0;
		}
		catch (error) {
			// The count only enables the manual page controls; without it they stay on one page.
			console.error('Failed to count the Archetype\'s pilots', error);
		}
		finally {
			if (id === requestId)
				loadingPilots.value = false;
		}
	},
	{ immediate: true },
);

// The live Page Rotation projection and the anchor writes an operator makes.
// Every edit below goes through its `updateConfig`, which restarts the
// rotation from page 1 when the edit changes the rotation's shape. An edit
// changing which pilots show returns to page 1 as well.
const {
	currentPage,
	totalPages,
	updateConfig,
	setAutoPageEnabled,
	adminNextPage,
	adminPrevPage,
} = useRotationConfigWrites({ mode: 'archetype-spotlight', config, rowCount: pilotCount, saveConfig });

function isTypeExcluded(bucket: CardTypeBucket): boolean {
	return config.value.excludedCardTypes.includes(bucket);
}

function toggleType(bucket: CardTypeBucket) {
	const excluded = isTypeExcluded(bucket)
		? config.value.excludedCardTypes.filter(type => type !== bucket)
		: [...config.value.excludedCardTypes, bucket];

	updateConfig({ excludedCardTypes: excluded });
}

function typeLabel(bucket: CardTypeBucket): string {
	return bucket === 'Land' ? 'Nonbasic Land' : bucket;
}
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Data">
			<UFormField
				label="Archetype"
				description="The archetype to spotlight."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.archetypeId ?? null"
					:items="archetypeOptions"
					class="w-64"
					@update:model-value="updateConfig({ archetypeId: $event ?? null, currentPage: 1 })"
				/>
			</UFormField>

			<ScreenMetagameScopeFields
				:config="config"
				:fields="fields"
				description="Which players count towards the pilots, meta share and Conversion Rate."
				@update="updateConfig({ ...$event, currentPage: 1 })"
			/>

			<UFormField
				:label="fields.conversionMetric.label"
				description="What a player in the scope must reach to count as converted. It never narrows the scope. The Screen keeps its own target: match the Metagame page's to show the same Conversion Rate."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.conversionMetric"
					:items="conversionMetricOptions"
					class="w-48"
					@update:model-value="updateConfig({ conversionMetric: $event as MetagameConversionMetric })"
				/>
			</UFormField>

			<UFormField
				:label="fields.conversionThreshold.label"
				:description="config.conversionMetric === 'topN' ? 'Converted at this placement or better.' : 'Converted at this many match points or more.'"
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.conversionThreshold"
					:min="fields.conversionThreshold.min"
					:max="fields.conversionThreshold.max"
					class="w-32"
					@update:model-value="updateConfig({ conversionThreshold: Number($event) })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Top Cards">
			<UFormField
				:label="fields.cardLimit.label"
				description="How many of the archetype's most-included cards to show."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.cardLimit"
					:min="fields.cardLimit.min"
					:max="fields.cardLimit.max"
					class="w-32"
					@update:model-value="updateConfig({ cardLimit: Number($event) })"
				/>
			</UFormField>

			<UFormField
				:label="fields.board.label"
				description="Count cards from this part of each deck."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.board"
					:items="boardOptions"
					class="w-48"
					@update:model-value="updateConfig({ board: $event as BoardSelection })"
				/>
			</UFormField>

			<UFormField
				label="Card types"
				description="Toggle which card types appear among the top cards. Basic lands are always excluded."
				class="flex flex-col gap-3"
			>
				<div class="flex flex-wrap gap-2">
					<UButton
						v-for="bucket in CARD_TYPE_BUCKET_ORDER"
						:key="bucket"
						:label="typeLabel(bucket)"
						:variant="isTypeExcluded(bucket) ? 'outline' : 'solid'"
						:color="isTypeExcluded(bucket) ? 'neutral' : 'primary'"
						size="xs"
						:data-testid="`archetype-spotlight-type-${bucket}`"
						@click="toggleType(bucket)"
					/>
				</div>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				:label="fields.showHeader.label"
				description="Show the title above the spotlight."
				:model-value="config.showHeader"
				@update:model-value="updateConfig({ showHeader: $event })"
			/>

			<UFormField
				v-if="config.showHeader"
				:label="fields.headerText.label"
				description="Leave empty for the archetype's name and scope."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInput
					:model-value="config.headerText ?? ''"
					placeholder="Auto"
					class="w-64"
					@update:model-value="updateConfig({ headerText: $event || null })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Pagination">
			<UFormField
				:label="fields.rowsPerPage.label"
				description="Number of pilots shown per page."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.rowsPerPage"
					:min="fields.rowsPerPage.min"
					:max="fields.rowsPerPage.max"
					class="w-32"
					@update:model-value="updateConfig({ rowsPerPage: Number($event) })"
				/>
			</UFormField>

			<USeparator />

			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Automatic Paging
			</p>

			<ScreenSettingsToggle
				:label="fields.autoPageEnabled.label"
				description="Automatically cycle through pages of pilots."
				:model-value="config.autoPageEnabled"
				@update:model-value="setAutoPageEnabled($event === true)"
			/>

			<UFormField
				v-if="config.autoPageEnabled"
				:label="fields.autoPageIntervalMs.label"
				description="Time between page transitions."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="Math.round(config.autoPageIntervalMs / fields.autoPageIntervalMs.displayScale)"
					:min="fields.autoPageIntervalMs.min"
					:max="fields.autoPageIntervalMs.max"
					class="w-32"
					@update:model-value="updateConfig({ autoPageIntervalMs: Number($event) * fields.autoPageIntervalMs.displayScale })"
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
					:disabled="totalPages <= 1 || loadingPilots"
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
					:disabled="totalPages <= 1 || loadingPilots"
					@click="adminNextPage"
				>
					Next
				</UButton>
			</div>
		</ScreenSettingsCard>
	</div>
</template>
