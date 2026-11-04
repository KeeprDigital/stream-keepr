<script setup lang="ts">
import type { CardSizing, PlayerSide, QuantityPosition } from '~~/shared/types/enums';
import type { DeckModeConfig, ResolvedMainboardLayout } from '~~/shared/types/screenConfig';
import type { NinePoint } from '~~/shared/utils/ninePoints';
import { DECK_MAINBOARD_LAYOUT_FIELDS } from '~~/shared/screenModeConfigs/deck';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { DEFAULT_DECK_TEXT_SIZES, DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '~~/shared/types/screenConfig';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { getOpGameData } from '~~/shared/utils/gameData';
import { CARD_SIZING_SELECT_OPTIONS } from '~~/shared/utils/selectOptions';
import { useConsumedEventData } from '~/modules/event-data/resync';
import { withFollowedFeatureMatchSession } from '~/utils/featureMatchFollowedSession';

/**
 * A One Piece Card Game Event's Deck List Screen settings: its Deck Source is one
 * player side of a Feature Match Slot (ADR-0057), and its Deck List has a
 * Leader and a Mainboard only, so no Sideboard, Companion or points.
 */
const props = defineProps<{
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
const BADGE_DISABLED_POINTS: readonly NinePoint[] = ['center'];

const slotOptions = useFeatureMatchMenuItems();
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

// What the Slot picker loads, re-read on Reconnect Resync (#610).
useConsumedEventData(['featureMatchSlots']);

onMounted(async () => {
	if (props.eventId)
		await featureMatchStore.loadFeatureMatchesByEventId(props.eventId);
});
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Deck Source">
			<UFormField
				label="Feature Match Slot"
				description="The Slot whose Deck List to show."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					data-testid="deck-source-slot"
					:model-value="source?.slotId ?? undefined"
					:items="slotOptions"
					value-key="value"
					placeholder="Select a slot…"
					class="w-64"
					@update:model-value="selectSource({ slotId: $event ?? null })"
				/>
			</UFormField>
			<UFormField
				label="Side"
				description="Shows whichever player sits on this side now: after Swap Players, the other player's Deck List."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					data-testid="deck-source-side"
					:model-value="source?.side ?? 'player1'"
					:items="sideOptions"
					class="w-64"
					@update:model-value="selectSource({ side: $event as PlayerSide })"
				/>
			</UFormField>
			<p v-if="emptySideHint" data-testid="empty-side-hint" class="text-xs text-muted">
				{{ emptySideHint }}
			</p>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				:label="fields.showPlayerName.label"
				description="The player's name, on the first line."
				:model-value="config.showPlayerName !== false"
				@update:model-value="emit('update', { showPlayerName: $event })"
			/>
			<ScreenSettingsToggle
				:label="fields.showDeckName.label"
				description="The Leader's name, which names the deck."
				:model-value="config.showDeckName !== false"
				@update:model-value="emit('update', { showDeckName: $event })"
			/>
			<ScreenSettingsToggle
				:label="fields.showDeckColors.label"
				description="The Leader's colours, beside its name."
				:model-value="config.showDeckColors !== false"
				@update:model-value="emit('update', { showDeckColors: $event })"
			/>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Mainboard">
			<p class="text-xs text-muted">
				Grouped Character, Event, Stage, each by cost, beside the Leader.
			</p>

			<ScreenSettingsToggle
				:label="fields.showCostCurve.label"
				description="Cards by cost, under the Leader."
				:model-value="config.showCostCurve !== false"
				@update:model-value="emit('update', { showCostCurve: $event })"
			/>

			<USeparator />

			<UFormField
				:label="layoutFields.cardSizing.label"
				description="Fit shrinks the cards until every one fits the screen. Fixed takes the card width below, shows the Leader at twice it, and may run off the screen."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="layout.cardSizing"
					:items="CARD_SIZING_SELECT_OPTIONS"
					class="w-48"
					@update:model-value="updateLayout({ cardSizing: $event as CardSizing })"
				/>
			</UFormField>

			<UFormField
				:label="layoutFields.alignment.label"
				description="Where the cards sit when they don't fill their space. A Fixed grid places them across only."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UINinePointPicker
					:model-value="layout.alignment"
					aria-label="Mainboard alignment"
					@update:model-value="updateLayout({ alignment: $event as NinePoint })"
				/>
			</UFormField>

			<UFormField
				v-if="layout.cardSizing === 'fixed'"
				:label="layoutFields.cardWidth.label"
				description="Each card's width in px."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="layout.cardWidth"
					:min="layoutFields.cardWidth.min"
					:max="layoutFields.cardWidth.max"
					class="w-32"
					@update:model-value="updateLayout({ cardWidth: Number($event) })"
				/>
			</UFormField>

			<ScreenSettingsToggle
				:label="layoutFields.autoColumns.label"
				description="Choose the columns from the card count and the screen's size."
				:model-value="layout.autoColumns"
				@update:model-value="updateLayout({ autoColumns: $event })"
			/>

			<UFormField
				v-if="!layout.autoColumns"
				:label="layoutFields.columns.label"
				description="Number of columns in each group's grid."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="layout.columns"
					:min="layoutFields.columns.min"
					:max="layoutFields.columns.max"
					class="w-32"
					@update:model-value="updateLayout({ columns: Number($event) })"
				/>
			</UFormField>

			<UFormField
				:label="layoutFields.cardGap.label"
				description="The space between cards in px."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="layout.cardGap"
					:min="layoutFields.cardGap.min"
					:max="layoutFields.cardGap.max"
					class="w-32"
					@update:model-value="updateLayout({ cardGap: Number($event) })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Card Badges">
			<ScreenSettingsToggle
				:label="fields.showQuantities.label"
				description="Show quantity badges on cards with multiple copies."
				:model-value="config.showQuantities"
				@update:model-value="emit('update', { showQuantities: $event })"
			/>

			<template v-if="config.showQuantities">
				<USeparator />

				<UFormField
					:label="fields.quantityPosition.label"
					description="Where the badge appears on the card."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UINinePointPicker
						:model-value="config.quantityPosition ?? DEFAULT_QUANTITY_POSITION"
						:disabled-points="BADGE_DISABLED_POINTS"
						aria-label="Quantity badge position"
						@update:model-value="emit('update', { quantityPosition: $event as QuantityPosition })"
					/>
				</UFormField>

				<UFormField
					:label="fields.quantityBadgeSize.label"
					description="The badge's text size in px; the badge sizes itself around it."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInputNumber
						:model-value="config.quantityBadgeSize ?? DEFAULT_DECK_TEXT_SIZES.quantityBadgeSize"
						:min="fields.quantityBadgeSize.min"
						:max="fields.quantityBadgeSize.max"
						class="w-32"
						@update:model-value="emit('update', { quantityBadgeSize: Number($event) })"
					/>
				</UFormField>
			</template>
		</ScreenSettingsCard>
	</div>
</template>
