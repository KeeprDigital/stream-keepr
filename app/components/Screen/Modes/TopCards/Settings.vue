<script setup lang="ts">
import type {
	BoardSelection,
	DeckCardSize,
	MetagameCardSortBy,
	MetagameScope,
	QuantitySize,
	TopCardsStat,
} from '~~/shared/types/enums';
import type { CardTypeBucket } from '~~/shared/utils/metagame';
import type { Screen } from '~/types';
import { CARD_TYPE_BUCKET_ORDER } from '~~/shared/utils/metagame';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'top-cards',
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

const boardOptions = [
	{ label: 'Full Deck', value: 'full' },
	{ label: 'Mainboard', value: 'mainboard' },
	{ label: 'Sideboard', value: 'sideboard' },
];

const sortByOptions = [
	{ label: 'Inclusion Rate', value: 'inclusionRate' },
	{ label: 'Avg Copies', value: 'avgCopies' },
	{ label: 'Total Copies', value: 'totalCopies' },
];

const cardSizeOptions = [
	{ label: 'Small', value: 'small' },
	{ label: 'Medium', value: 'medium' },
	{ label: 'Large', value: 'large' },
];

const statBadgeOptions = [
	{ label: 'None', value: 'none' },
	{ label: 'Inclusion Rate', value: 'inclusionRate' },
	{ label: 'Avg Copies', value: 'avgCopies' },
	{ label: 'Total Copies', value: 'totalCopies' },
	{ label: 'Deck Count', value: 'deckCount' },
];

const badgeSizeOptions = [
	{ label: 'Small', value: 'small' },
	{ label: 'Medium', value: 'medium' },
	{ label: 'Large', value: 'large' },
];

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
				label="Player scope"
				description="Which players to include in the ranking."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.scope"
					:items="scopeOptions"
					class="w-48"
					@update:model-value="updateConfig({ scope: $event as MetagameScope })"
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
					@update:model-value="updateConfig({ topN: Number($event) })"
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
							@update:model-value="updateConfig({ playerListId: $event ?? undefined })"
						/>
					</UFormField>
				</template>
				<div v-else class="text-sm text-muted text-center py-2">
					No player lists available. Create one on the Players page.
				</div>
			</template>

			<UFormField
				label="Board"
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
				label="Rank by"
				description="Order cards using this metric."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.sortBy"
					:items="sortByOptions"
					class="w-48"
					@update:model-value="updateConfig({ sortBy: $event as MetagameCardSortBy })"
				/>
			</UFormField>

			<UFormField
				label="Card count"
				description="How many top cards to show."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.limit"
					:min="1"
					:max="60"
					class="w-32"
					@update:model-value="updateConfig({ limit: Number($event) })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Filters">
			<UFormField
				label="Card types"
				description="Toggle which card types appear in the ranking. Basic lands are always excluded."
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
						:data-testid="`top-cards-type-${bucket}`"
						@click="toggleType(bucket)"
					/>
				</div>
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
					@update:model-value="updateConfig({ archetypeFilter: $event || undefined })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Layout">
			<UFormField
				label="Columns"
				description="Number of cards per row."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.columns"
					:min="1"
					:max="12"
					class="w-32"
					@update:model-value="updateConfig({ columns: Number($event) })"
				/>
			</UFormField>

			<ScreenSettingsToggle
				label="Dynamic card size"
				description="Stretch cards to fill the available width."
				:model-value="config.dynamicCardSize"
				@update:model-value="updateConfig({ dynamicCardSize: $event })"
			/>

			<UFormField
				v-if="!config.dynamicCardSize"
				label="Card size"
				description="Fixed size for each card."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.cardSize"
					:items="cardSizeOptions"
					class="w-48"
					@update:model-value="updateConfig({ cardSize: $event as DeckCardSize })"
				/>
			</UFormField>

			<UFormField
				label="Card gap"
				description="Space between cards in pixels."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.cardGap"
					:min="0"
					:max="100"
					class="w-32"
					@update:model-value="updateConfig({ cardGap: Number($event) })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				label="Show header"
				description="Show the title above the card grid."
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

		<ScreenSettingsCard title="Badges & Labels">
			<ScreenSettingsToggle
				label="Show card names"
				description="Show each card's name under its image."
				:model-value="config.showCardNames"
				@update:model-value="updateConfig({ showCardNames: $event })"
			/>

			<ScreenSettingsToggle
				label="Show rank badges"
				description="Number each card by its position in the ranking."
				:model-value="config.showRankBadges"
				@update:model-value="updateConfig({ showRankBadges: $event })"
			/>

			<template v-if="config.showRankBadges">
				<UFormField
					label="Rank badge colors"
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<div class="flex items-center gap-2">
						<UIColorPicker
							:model-value="config.rankBadgeTextColor"
							placeholder="Text"
							@update:model-value="updateConfig({ rankBadgeTextColor: $event })"
						/>
						<UIColorPicker
							:model-value="config.rankBadgeBgColor"
							placeholder="Background"
							@update:model-value="updateConfig({ rankBadgeBgColor: $event })"
						/>
					</div>
				</UFormField>
			</template>

			<USeparator />

			<UFormField
				label="Stat badge"
				description="Show one metric on each card."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.statBadge"
					:items="statBadgeOptions"
					class="w-48"
					@update:model-value="updateConfig({ statBadge: $event as TopCardsStat })"
				/>
			</UFormField>

			<template v-if="config.statBadge !== 'none'">
				<UFormField
					label="Badge size"
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						:model-value="config.statBadgeSize ?? 'medium'"
						:items="badgeSizeOptions"
						class="w-48"
						@update:model-value="updateConfig({ statBadgeSize: $event as QuantitySize })"
					/>
				</UFormField>

				<UFormField
					label="Stat badge colors"
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<div class="flex items-center gap-2">
						<UIColorPicker
							:model-value="config.statBadgeTextColor"
							placeholder="Text"
							@update:model-value="updateConfig({ statBadgeTextColor: $event })"
						/>
						<UIColorPicker
							:model-value="config.statBadgeBgColor"
							placeholder="Background"
							@update:model-value="updateConfig({ statBadgeBgColor: $event })"
						/>
					</div>
				</UFormField>
			</template>
		</ScreenSettingsCard>
	</div>
</template>
