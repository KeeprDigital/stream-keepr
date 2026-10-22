<script setup lang="ts">
import type {
	BoardSelection,
	DeckCardSize,
	MetagameCardSortBy,
	QuantitySize,
	TopCardsStat,
} from '~~/shared/types/enums';
import type { CardTypeBucket } from '~~/shared/utils/metagame';
import type { Screen } from '~/types';
import { topCardsGridRowCount } from '~~/shared/screenModeConfigs/topCards';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { CARD_TYPE_BUCKET_ORDER } from '~~/shared/utils/metagame';
import { useConsumedEventData } from '~/modules/event-data/resync';
import { useRotationConfigWrites } from '~/modules/screen-mode/rotationWrites';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig: saveConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'top-cards',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498).
// Edits still go through the Page Rotation's `updateConfig` below (ADR-0039).
const fields = screenModeConfigContract('top-cards').fields;

const playerStore = usePlayerStore();
const playerListStore = usePlayerListStore();

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['players', 'playerLists']);

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

// The grid rows the Screen would show at its full card count: a page holds
// `rowsPerPage` of them.
const estimatedGridRowCount = computed(() => topCardsGridRowCount(config.value.limit, config.value.columns));

// The live Page Rotation projection and the anchor writes an operator makes.
// Every edit below goes through its `updateConfig`, which restarts the
// rotation from page 1 when the edit changes the rotation's shape. An edit
// changing which cards each page holds returns to page 1 as well.
const rotation = useRotationConfigWrites({ mode: 'top-cards', config, rowCount: estimatedGridRowCount, saveConfig });
const { updateConfig } = rotation;

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

	updateConfig({ excludedCardTypes: excluded, currentPage: 1 });
}

function typeLabel(bucket: CardTypeBucket): string {
	return bucket === 'Land' ? 'Nonbasic Land' : bucket;
}
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Data">
			<ScreenMetagameScopeFields
				:config="config"
				:fields="fields"
				description="Which players to include in the ranking."
				@update="updateConfig({ ...$event, currentPage: 1 })"
			/>

			<UFormField
				:label="fields.board.label"
				description="Count cards from this part of each deck."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.board"
					:items="boardOptions"
					class="w-48"
					@update:model-value="updateConfig({ board: $event as BoardSelection, currentPage: 1 })"
				/>
			</UFormField>

			<UFormField
				:label="fields.sortBy.label"
				description="Order cards using this metric."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.sortBy"
					:items="sortByOptions"
					class="w-48"
					@update:model-value="updateConfig({ sortBy: $event as MetagameCardSortBy, currentPage: 1 })"
				/>
			</UFormField>

			<UFormField
				:label="fields.limit.label"
				description="How many top cards to show."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.limit"
					:min="fields.limit.min"
					:max="fields.limit.max"
					class="w-32"
					@update:model-value="updateConfig({ limit: Number($event), currentPage: 1 })"
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
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Layout">
			<UFormField
				:label="fields.columns.label"
				description="Number of cards per row."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.columns"
					:min="fields.columns.min"
					:max="fields.columns.max"
					class="w-32"
					@update:model-value="updateConfig({ columns: Number($event), currentPage: 1 })"
				/>
			</UFormField>

			<ScreenSettingsToggle
				:label="fields.dynamicCardSize.label"
				description="Stretch cards to fill the available width."
				:model-value="config.dynamicCardSize"
				@update:model-value="updateConfig({ dynamicCardSize: $event })"
			/>

			<UFormField
				v-if="!config.dynamicCardSize"
				:label="fields.cardSize.label"
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
				:label="fields.cardGap.label"
				description="Space between cards in pixels."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.cardGap"
					:min="fields.cardGap.min"
					:max="fields.cardGap.max"
					class="w-32"
					@update:model-value="updateConfig({ cardGap: Number($event) })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenPaginationSettingsCard
			:rotation="rotation"
			page-size-description="Grid rows shown per page, each holding one card per column."
			auto-page-description="Automatically cycle through pages of cards."
		/>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				:label="fields.showHeader.label"
				description="Show the title above the card grid."
				:model-value="config.showHeader"
				@update:model-value="updateConfig({ showHeader: $event })"
			/>

			<UFormField
				v-if="config.showHeader"
				:label="fields.headerText.label"
				description="Leave empty for an auto-generated title."
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

		<ScreenSettingsCard title="Badges & Labels">
			<ScreenSettingsToggle
				:label="fields.showCardNames.label"
				description="Show each card's name under its image."
				:model-value="config.showCardNames"
				@update:model-value="updateConfig({ showCardNames: $event })"
			/>

			<ScreenSettingsToggle
				:label="fields.showRankBadges.label"
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
							:aria-label="fields.rankBadgeTextColor.label"
							@update:model-value="updateConfig({ rankBadgeTextColor: $event })"
						/>
						<UIColorPicker
							:model-value="config.rankBadgeBgColor"
							placeholder="Background"
							:aria-label="fields.rankBadgeBgColor.label"
							@update:model-value="updateConfig({ rankBadgeBgColor: $event })"
						/>
					</div>
				</UFormField>
			</template>

			<USeparator />

			<UFormField
				:label="fields.statBadge.label"
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
					:label="fields.statBadgeSize.label"
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
							:aria-label="fields.statBadgeTextColor.label"
							@update:model-value="updateConfig({ statBadgeTextColor: $event })"
						/>
						<UIColorPicker
							:model-value="config.statBadgeBgColor"
							placeholder="Background"
							:aria-label="fields.statBadgeBgColor.label"
							@update:model-value="updateConfig({ statBadgeBgColor: $event })"
						/>
					</div>
				</UFormField>
			</template>
		</ScreenSettingsCard>
	</div>
</template>
