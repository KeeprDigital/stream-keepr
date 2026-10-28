<script setup lang="ts">
import type {
	BoardSelection,
	CardSizing,
	MetagameCardSortBy,
	QuantityPosition,
	TopCardsStat,
} from '~~/shared/types/enums';
import type { CardTypeBucket } from '~~/shared/utils/metagame';
import type { NinePoint } from '~~/shared/utils/ninePoints';
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { CARD_TYPE_BUCKET_ORDER } from '~~/shared/utils/metagame';
import { CARD_SIZING_SELECT_OPTIONS } from '~~/shared/utils/selectOptions';
import { useConsumedEventData } from '~/modules/event-data/resync';
import { useEditedScreenModeData } from '~/modules/screen-mode/editorModeData';
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

// The grid rows the Screen pages — the cards it reads, once the filters have
// applied, in rows of `columns` — read and followed as its Screen Output reads
// and follows them, so the page count is the one it renders (#780).
const { rowCount, loading: loadingCards } = useEditedScreenModeData(
	{
		screen: () => props.screen,
		eventId: () => props.eventId,
		saving: () => saving.value,
	},
	useTopCardsModeData,
);

// The live Page Rotation projection and the anchor writes an operator makes.
// Every edit below goes through its `updateConfig`, which restarts the
// rotation from page 1 when the edit changes the rotation's shape. An edit
// changing which cards each page holds returns to page 1 as well.
const rotation = useRotationConfigWrites({
	mode: 'top-cards',
	config,
	rowCount,
	saveConfig,
});
const { updateConfig } = rotation;

// Paging is the ranking split into pages: on while a page holds fewer cards
// than the ranking does. Off stores the most a page can hold, so the ranking
// stays one page whatever its card count becomes.
const paged = computed(() => config.value.cardsPerPage < config.value.limit);

/** The page count is the one the Screen renders, from the cards it reads. */
const pageSizeDescription = computed(() => {
	const pages = rotation.totalPages.value;
	return `Cards on each page, laid out in as many columns as the Screen fits: ${pages} ${pages === 1
		? 'page'
		: 'pages'}.`;
});

function setPaged(enabled: boolean) {
	rotation.setPageSize(enabled
		? Math.ceil(config.value.limit / 2)
		: fields.cardsPerPage.max!);
}

// A badge in the centre of a card would cover its art, so the badge position
// pickers offer every point but this one — which is why what they emit is
// always a `QuantityPosition`, and why the casts below are safe.
const BADGE_DISABLED_POINTS: readonly NinePoint[] = ['center'];

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

const statBadgeOptions = [
	{ label: 'None', value: 'none' },
	{ label: 'Inclusion Rate', value: 'inclusionRate' },
	{ label: 'Avg Copies', value: 'avgCopies' },
	{ label: 'Total Copies', value: 'totalCopies' },
	{ label: 'Deck Count', value: 'deckCount' },
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
	return bucket === 'Land'
		? 'Nonbasic Land'
		: bucket;
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

		<ScreenSettingsCard title="Cards">
			<UFormField
				:label="fields.limit.label"
				description="How many of the top cards the ranking shows."
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

			<ScreenSettingsToggle
				label="Split into pages"
				description="Show the cards a page at a time. Off, every card is on one page."
				:model-value="paged"
				:enabled="config.limit > 1"
				disabled-description="A ranking of one card is one page."
				@update:model-value="setPaged($event === true)"
			/>

			<template v-if="paged">
				<UFormField
					:label="fields.cardsPerPage.label"
					:description="pageSizeDescription"
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="config.cardsPerPage"
						:min="fields.cardsPerPage.min"
						:max="config.limit - 1"
						class="w-32"
						@update:model-value="rotation.setPageSize(Number($event))"
					/>
				</UFormField>

				<USeparator />

				<ScreenPaginationRotationControls
					:rotation="rotation"
					auto-page-description="Automatically cycle through pages of cards."
					:loading="loadingCards"
				/>
			</template>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Layout">
			<UFormField
				:label="fields.cardSizing.label"
				description="Fit shrinks the cards until every one on the page fits the screen. Fixed takes the card width below and may run off the screen."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.cardSizing"
					:items="CARD_SIZING_SELECT_OPTIONS"
					class="w-48"
					@update:model-value="updateConfig({ cardSizing: $event as CardSizing })"
				/>
			</UFormField>

			<UFormField
				v-if="config.cardSizing === 'fixed'"
				:label="fields.cardWidth.label"
				description="Each card's width in px."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.cardWidth"
					:min="fields.cardWidth.min"
					:max="fields.cardWidth.max"
					class="w-32"
					@update:model-value="updateConfig({ cardWidth: Number($event) })"
				/>
			</UFormField>

			<UFormField
				:label="fields.cardGap.label"
				description="The space between cards in px."
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

			<ScreenSettingsToggle
				:label="fields.autoColumns.label"
				description="Choose the columns from the space the cards have on the Screen."
				:model-value="config.autoColumns"
				@update:model-value="updateConfig({ autoColumns: $event })"
			/>

			<UFormField
				v-if="!config.autoColumns"
				:label="fields.columns.label"
				description="Number of cards per row."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.columns"
					:min="fields.columns.min"
					:max="fields.columns.max"
					class="w-32"
					@update:model-value="updateConfig({ columns: Number($event) })"
				/>
			</UFormField>
		</ScreenSettingsCard>

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

		<ScreenSettingsCard title="Card Badges">
			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Rank Badge
			</p>

			<ScreenSettingsToggle
				:label="fields.showRankBadges.label"
				description="Number each card by its position in the ranking."
				:model-value="config.showRankBadges"
				@update:model-value="updateConfig({ showRankBadges: $event })"
			/>

			<template v-if="config.showRankBadges">
				<USeparator />

				<UFormField
					:label="fields.rankBadgePosition.label"
					description="Where the badge appears on the card."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UINinePointPicker
						:model-value="config.rankBadgePosition"
						:disabled-points="BADGE_DISABLED_POINTS"
						aria-label="Rank badge position"
						@update:model-value="updateConfig({ rankBadgePosition: $event as QuantityPosition })"
					/>
				</UFormField>

				<UFormField
					:label="fields.rankBadgeTextSize.label"
					description="The badge's text size in px; the badge sizes itself around it."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="config.rankBadgeTextSize"
						:min="fields.rankBadgeTextSize.min"
						:max="fields.rankBadgeTextSize.max"
						class="w-32"
						aria-label="Rank badge text size"
						@update:model-value="updateConfig({ rankBadgeTextSize: Number($event) })"
					/>
				</UFormField>
			</template>

			<USeparator />

			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Stat Badge
			</p>

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
				<USeparator />

				<UFormField
					:label="fields.statBadgePosition.label"
					description="Where the badge appears on the card."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UINinePointPicker
						:model-value="config.statBadgePosition"
						:disabled-points="BADGE_DISABLED_POINTS"
						aria-label="Stat badge position"
						@update:model-value="updateConfig({ statBadgePosition: $event as QuantityPosition })"
					/>
				</UFormField>

				<UFormField
					:label="fields.statBadgeTextSize.label"
					description="The badge's text size in px; the badge sizes itself around it."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="config.statBadgeTextSize"
						:min="fields.statBadgeTextSize.min"
						:max="fields.statBadgeTextSize.max"
						class="w-32"
						aria-label="Stat badge text size"
						@update:model-value="updateConfig({ statBadgeTextSize: Number($event) })"
					/>
				</UFormField>
			</template>
		</ScreenSettingsCard>
	</div>
</template>
