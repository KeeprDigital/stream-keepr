<script setup lang="ts">
import type { DeckModeConfig, ResolvedMainboardLayout } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { DECK_MAINBOARD_LAYOUT_FIELDS } from '~~/shared/screenModeConfigs/deck';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { DEFAULT_DECK_TEXT_SIZES, DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '~~/shared/types/screenConfig';
import { FOLLOWS_THE_THEME, lookSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';

/**
 * A One Piece Card Game Event's Deck List Screen settings: its Deck Source is
 * one player side of a Feature Match Slot (ADR-0057) or a Player (ADR-0074),
 * and its Deck List has a Leader and a Mainboard only, so no Sideboard,
 * Companion or points.
 */
const props = defineProps<{
	screen: Screen;
	config: DeckModeConfig;
	eventId: number;
}>();

const emit = defineEmits<{
	update: [patch: Partial<DeckModeConfig>];
}>();

const fields = screenModeConfigContract('deck').fields;
const layoutFields = DECK_MAINBOARD_LAYOUT_FIELDS;

const layout = computed(() => resolveDeckBoards(props.config).mainboard);

// The mode-config PATCH replaces a board block wholesale.
function updateLayout(patch: Partial<ResolvedMainboardLayout>) {
	emit('update', {
		mainboard: {
			...layout.value,
			...patch,
		},
	});
}

const layoutDescriptions = {
	cardSizing: 'Fit shrinks the cards until every one fits the screen; Fixed takes the card width below, shows the Leader at twice it, and may run off the screen.',
	alignment: 'Where the cards sit when they don\'t fill their space; a Fixed grid places them across only.',
	columns: 'Number of columns in each group\'s grid.',
};

/** For a closed card's summary: how many Screen Theme Overrides the Looks of mounted `groups` hold. */
function look(...groups: string[]) {
	return lookSummary('deck', props.screen.themeOverrides, groups);
}

const headerCardSummary = computed(() => settingsSummary([
	[
		props.config.showPlayerName !== false && 'Player name',
		props.config.showDeckName !== false && 'Leader',
		props.config.showDeckColors !== false && 'colours',
	].filter(Boolean).join(', ') || 'Nothing shown',
	look('header'),
]));
const detailsSummary = computed(() => settingsSummary([
	look('deck-details', 'pointed-cards'),
], FOLLOWS_THE_THEME));
const mainboardSummary = computed(() => settingsSummary([
	layout.value.cardSizing === 'fixed'
		? `${layout.value.cardWidth} px cards`
		: 'Fit',
	props.config.showCostCurve !== false && 'Cost curve',
]));
const cardLookSummary = computed(() => settingsSummary([
	look('card-look'),
], FOLLOWS_THE_THEME));
const badgesSummary = computed(() => settingsSummary([
	props.config.showQuantities
		? 'Quantity badge'
		: 'No badges',
	look('quantity-badge', 'points-badge'),
]));
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsSection id="deck:deck-source" title="Deck Source" :collapsible="false">
			<ScreenDeckSourceField
				:model-value="config.deckSource"
				:event-id="eventId"
				@update:model-value="emit('update', { deckSource: $event })"
			/>
		</ScreenSettingsSection>

		<ScreenSettingsSection id="deck:header" title="Header" :summary="headerCardSummary">
			<ScreenConfigField
				:field="fields.showPlayerName"
				:model-value="config.showPlayerName !== false"
				description="The player's name, on the first line."
				@update:model-value="emit('update', { showPlayerName: $event === true })"
			/>
			<ScreenConfigField
				:field="fields.showDeckName"
				:model-value="config.showDeckName !== false"
				description="The Leader's name, which names the deck."
				@update:model-value="emit('update', { showDeckName: $event === true })"
			/>
			<ScreenConfigField
				:field="fields.showDeckColors"
				:model-value="config.showDeckColors !== false"
				description="The Leader's colours, beside its name."
				@update:model-value="emit('update', { showDeckColors: $event === true })"
			/>

			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="header" />
		</ScreenSettingsSection>

		<!-- No One Piece control sits in these groups, but their Mode Tokens are the Deck List's, so their Looks are here. -->
		<ScreenSettingsSection
			id="deck:deck-details"
			title="Deck Details"
			subtitle="The cost curve's bars take the accent; the rest styles a Magic Deck List's details row."
			:summary="detailsSummary"
		>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="deck-details" />
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="pointed-cards" />
		</ScreenSettingsSection>

		<ScreenSettingsSection id="deck:mainboard" title="Mainboard" :summary="mainboardSummary">
			<ScreenSettingsHint>
				Grouped Character, Event, Stage, each by cost, beside the Leader.
			</ScreenSettingsHint>

			<ScreenConfigField
				:field="fields.showCostCurve"
				:model-value="config.showCostCurve !== false"
				description="Cards by cost, under the Leader."
				@update:model-value="emit('update', { showCostCurve: $event === true })"
			/>

			<USeparator />

			<ScreenCardGridLayoutFields
				:layout="layout"
				:fields="layoutFields"
				:show="{ alignment: true }"
				:descriptions="layoutDescriptions"
				grid-name="Mainboard"
				@update="updateLayout($event)"
			/>
		</ScreenSettingsSection>

		<ScreenSettingsSection
			id="deck:card-look"
			title="Card Look"
			subtitle="How the Deck List's cards read."
			:summary="cardLookSummary"
		>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="card-look" />
		</ScreenSettingsSection>

		<ScreenSettingsSection id="deck:card-badges" title="Card Badges" :summary="badgesSummary">
			<ScreenCardBadgeFields
				title="Quantity Badge"
				:shown="!!config.showQuantities"
				:shown-field="fields.showQuantities"
				shown-description="Show quantity badges on cards with multiple copies."
				:position="config.quantityPosition ?? DEFAULT_QUANTITY_POSITION"
				:position-field="fields.quantityPosition"
				:text-size="config.quantityBadgeSize ?? DEFAULT_DECK_TEXT_SIZES.quantityBadgeSize"
				:size-field="fields.quantityBadgeSize"
				@update="emit('update', $event)"
			>
				<template #look>
					<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="quantity-badge" />
				</template>
			</ScreenCardBadgeFields>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="points-badge" />
		</ScreenSettingsSection>
	</div>
</template>
