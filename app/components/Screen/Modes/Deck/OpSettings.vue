<script setup lang="ts">
import type { PlayerSide } from '~~/shared/types/enums';
import type { DeckModeConfig, ResolvedMainboardLayout } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { DECK_MAINBOARD_LAYOUT_FIELDS } from '~~/shared/screenModeConfigs/deck';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { DEFAULT_DECK_TEXT_SIZES, DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '~~/shared/types/screenConfig';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { getOpGameData } from '~~/shared/utils/gameData';
import { lookSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';
import { useConsumedEventData } from '~/modules/event-data/resync';
import { withFollowedFeatureMatchSession } from '~/utils/featureMatchFollowedSession';

/**
 * A One Piece Card Game Event's Deck List Screen settings: its Deck Source is
 * one player side of a Feature Match Slot (ADR-0057), and its Deck List has a
 * Leader and a Mainboard only, so no Sideboard, Companion or points.
 */
const props = defineProps<{
	screen: Screen;
	config: DeckModeConfig;
	eventId: number;
}>();

const emit = defineEmits<{
	update: [patch: Partial<DeckModeConfig>];
}>();

const featureMatchStore = useFeatureMatchStore();
const featureMatchStateStore = useFeatureMatchStateStore();

const fields = screenModeConfigContract('deck').fields;
const layoutFields = DECK_MAINBOARD_LAYOUT_FIELDS;

const sideOptions: { label: string; value: PlayerSide }[] = [
	{ label: 'Player 1', value: 'player1' },
	{ label: 'Player 2', value: 'player2' },
];

const source = computed(() => props.config.deckSource.type === 'featureMatchSlot'
	? props.config.deckSource
	: null);

function selectSource(patch: { slotId?: number | null; side?: PlayerSide }) {
	emit('update', {
		deckSource: {
			type: 'featureMatchSlot',
			slotId: patch.slotId !== undefined
				? patch.slotId
				: source.value?.slotId ?? null,
			side: patch.side ?? source.value?.side ?? 'player1',
		},
	});
}

/** The output shows nothing for a side holding no Deck List, so settings say so. */
const emptySideHint = computed(() => {
	const selected = source.value;
	const slot = selected?.slotId
		? featureMatchStore.featureMatches.find(candidate => candidate.id === selected.slotId)
		: null;
	if (!selected || !slot)
		return null;
	const { data } = featureMatchSidePlayer(withFollowedFeatureMatchSession(slot, featureMatchStateStore), selected.side);
	return getOpGameData(data?.gameData).featureMatchDeckList
		? null
		: 'The player on this side has no Deck List, so the Screen shows nothing. Paste one in the Slot\'s setup.';
});

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

/** A closed card's one line: what it is set to, and how many Look overrides it holds. */
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
const mainboardSummary = computed(() => settingsSummary([
	layout.value.cardSizing === 'fixed'
		? `${layout.value.cardWidth} px cards`
		: 'Fit',
	props.config.showCostCurve !== false && 'Cost curve',
]));
const cardLookSummary = computed(() => settingsSummary([
	look('card-look'),
], 'Follows the Theme'));
const badgesSummary = computed(() => settingsSummary([
	props.config.showQuantities
		? 'Quantity badge'
		: 'No badges',
	look('quantity-badge'),
]));

// What the Slot picker loads, re-read on Reconnect Resync (#610).
useConsumedEventData(['featureMatchSlots']);

onMounted(async () => {
	if (props.eventId)
		await featureMatchStore.loadFeatureMatchesByEventId(props.eventId);
});
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard id="deck:deck-source" title="Deck Source" :collapsible="false">
			<ScreenSettingsField label="Feature Match Slot" description="The Slot whose Deck List to show.">
				<ScreenFeatureMatchSelect
					data-testid="deck-source-slot"
					:model-value="source?.slotId"
					placeholder="Select a slot…"
					@update:model-value="selectSource({ slotId: $event })"
				/>
			</ScreenSettingsField>
			<ScreenSettingsField
				label="Side"
				description="Shows whichever player sits on this side now: after Swap Players, the other player's Deck List."
			>
				<USelect
					data-testid="deck-source-side"
					:model-value="source?.side ?? 'player1'"
					:items="sideOptions"
					class="w-64"
					@update:model-value="selectSource({ side: $event as PlayerSide })"
				/>
			</ScreenSettingsField>
			<p v-if="emptySideHint" data-testid="empty-side-hint" class="text-xs text-muted">
				{{ emptySideHint }}
			</p>
		</ScreenSettingsCard>

		<ScreenSettingsCard id="deck:header" title="Header" :summary="headerCardSummary">
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
		</ScreenSettingsCard>

		<ScreenSettingsCard id="deck:mainboard" title="Mainboard" :summary="mainboardSummary">
			<p class="text-xs text-muted">
				Grouped Character, Event, Stage, each by cost, beside the Leader.
			</p>

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
		</ScreenSettingsCard>

		<ScreenSettingsCard
			id="deck:card-look"
			title="Card Look"
			subtitle="How the Deck List's cards read."
			:summary="cardLookSummary"
		>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="card-look" />
		</ScreenSettingsCard>

		<ScreenSettingsCard id="deck:card-badges" title="Card Badges" :summary="badgesSummary">
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
		</ScreenSettingsCard>
	</div>
</template>
