<script setup lang="ts">
import type { Screen } from '~/types';
import { getCounterTypeConfigs, getPlayerIdentityLabel } from '~~/shared/config/games';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const featureMatchStore = useFeatureMatchStore();
const featureMatchStateStore = useFeatureMatchStateStore();
const eventStore = useEventStore();

const identityLabel = computed(() => {
	const game = eventStore.event?.game;
	return game ? getPlayerIdentityLabel(game) : 'Deck';
});

// Event-level feature gates
const matchDefaults = computed(() => toFeatureMatchDefaults(eventStore.event));
const hasCounterTypes = computed(() => {
	const game = eventStore.event?.game;
	return game ? getCounterTypeConfigs(game).length > 0 : false;
});
const hasTurnTracking = computed(
	() => matchDefaults.value.turnTrackingEnabled || matchDefaults.value.activePlayerTrackingEnabled,
);
const hasStandings = computed(() => eventStore.event?.standingsEnabled ?? true);
const hasExtraTurns = computed(() => matchDefaults.value.extraTurnsEnabled);
const hasMulliganTracking = computed(() => matchDefaults.value.mulliganTrackingEnabled);
const hasPronouns = computed(() => eventStore.event?.pronounsEnabled ?? true);
const hasLgs = computed(() => eventStore.event?.lgsEnabled ?? false);
const hasTableNumber = computed(() => eventStore.event?.tableNumberEnabled ?? false);

// Orientation-aware labels for the left-side player select
const isVerticalArena = computed(() => eventStore.event?.featureMatchOrientation === 'vertical');

const leftSidePlayerOptions = computed(() => {
	if (isVerticalArena.value) {
		return [
			{ label: 'Top player', value: 'player1' as const },
			{ label: 'Bottom player', value: 'player2' as const },
		];
	}
	return [
		{ label: 'Left player', value: 'player1' as const },
		{ label: 'Right player', value: 'player2' as const },
	];
});

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'feature-match',
);

defineExpose({ resetConfig, saving });

// Load matches on mount
onMounted(async () => {
	if (props.eventId) {
		await featureMatchStore.loadFeatureMatchesByEventId(props.eventId);
	}
});

// Match options
const matchOptions = useFeatureMatchMenuItems();

// Initialize match state when match is selected
async function handleMatchChange(matchId: number | null) {
	updateConfig({ featureMatchId: matchId });

	if (matchId && props.eventId) {
		await featureMatchStateStore.loadState(props.eventId, matchId);
	}
}
</script>

<template>
	<div class="flex flex-col gap-6">
		<!-- Match Selection -->
		<ScreenSettingsCard title="Match Selection">
			<UFormField
				label="Match"
				description="Select a feature match to show."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.featureMatchId ?? undefined"
					:items="matchOptions"
					value-key="value"
					placeholder="Select a match..."
					class="w-72"
					:ui="{ content: 'min-w-fit' }"
					@update:model-value="handleMatchChange($event)"
				>
					<template #item-label="{ item }">
						<div class="flex flex-col gap-0.5">
							<span class="font-medium">{{ item.label }}</span>
							<div v-if="item.player1DeckName || item.player2DeckName" class="flex items-center gap-1 text-xs text-muted">
								<template v-if="item.player1DeckName">
									<MtgManaColorDisplay v-if="item.player1Colors" :colors="item.player1Colors" size="xs" />
									<span>{{ item.player1DeckName }}</span>
								</template>
								<template v-if="item.player1DeckName && item.player2DeckName">
									<span class="text-dimmed">vs</span>
								</template>
								<template v-if="item.player2DeckName">
									<MtgManaColorDisplay v-if="item.player2Colors" :colors="item.player2Colors" size="xs" />
									<span>{{ item.player2DeckName }}</span>
								</template>
							</div>
						</div>
					</template>
				</USelect>
			</UFormField>
		</ScreenSettingsCard>

		<!-- Show Options -->
		<ScreenSettingsCard title="Show Options">
			<!-- Player Info -->
			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Player Info
			</p>

			<ScreenSettingsToggle
				label="Show Pronouns"
				description="Show player pronouns next to their name."
				disabled-description="Enable player pronouns in event settings to use this."
				:enabled="hasPronouns"
				:model-value="config.showPronouns"
				@update:model-value="updateConfig({ showPronouns: $event })"
			/>
			<ScreenSettingsToggle
				:label="`Show ${identityLabel} Names`"
				:description="`Show player ${identityLabel.toLowerCase()} names below their name.`"
				:model-value="config.showDeckNames"
				@update:model-value="updateConfig({ showDeckNames: $event })"
			/>
			<ScreenSettingsToggle
				label="Show Player Record"
				description="Show the player record or position next to their name."
				disabled-description="Enable player standings in event settings to use this."
				:enabled="hasStandings"
				:model-value="config.showRecords"
				@update:model-value="updateConfig({ showRecords: $event })"
			/>
			<ScreenSettingsToggle
				label="Show LGS"
				description="Show the player's Local Game Store."
				disabled-description="Enable LGS tracking in event settings to use this."
				:enabled="hasLgs"
				:model-value="config.showLgs"
				@update:model-value="updateConfig({ showLgs: $event })"
			/>

			<USeparator />

			<!-- Match Display -->
			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Match Display
			</p>

			<ScreenSettingsToggle
				label="Show Clock"
				description="Show the match clock."
				:model-value="config.showClock"
				@update:model-value="updateConfig({ showClock: $event })"
			/>
			<ScreenSettingsToggle
				label="Show Table Number"
				description="Show the match table number in the header."
				disabled-description="Enable table numbers in event settings to use this."
				:enabled="hasTableNumber"
				:model-value="config.showTableNumber"
				@update:model-value="updateConfig({ showTableNumber: $event })"
			/>
			<ScreenSettingsToggle
				label="Show Seat Labels"
				:description="`Show ${isVerticalArena ? 'Top/Bottom' : 'Left/Right'} labels next to player names.`"
				:model-value="config.showSeatLabels"
				@update:model-value="updateConfig({ showSeatLabels: $event })"
			/>

			<USeparator />

			<!-- Game State -->
			<p class="text-xs font-semibold uppercase tracking-wider text-muted">
				Game State
			</p>

			<ScreenSettingsToggle
				label="Show Counters"
				description="Show player counters (poison, energy, etc.)."
				disabled-description="No counter types available for this game."
				:enabled="hasCounterTypes"
				:model-value="config.showCounters"
				@update:model-value="updateConfig({ showCounters: $event })"
			/>
			<ScreenSettingsToggle
				label="Show Turn Controls"
				description="Show the turn counter and active player controls."
				disabled-description="Enable turn or active player tracking in event settings to use this."
				:enabled="hasTurnTracking"
				:model-value="config.showTurnControls"
				@update:model-value="updateConfig({ showTurnControls: $event })"
			/>
			<ScreenSettingsToggle
				label="Show Overtime"
				description="Show the extra turns tracker when overtime begins."
				disabled-description="Enable extra turns in event format settings to use this."
				:enabled="hasExtraTurns"
				:model-value="config.showOvertime"
				@update:model-value="updateConfig({ showOvertime: $event })"
			/>
			<ScreenSettingsToggle
				label="Show Mulligan Info"
				description="Show the cards kept indicator during mulligan phase."
				disabled-description="Enable mulligan tracking in event settings to use this."
				:enabled="hasMulliganTracking"
				:model-value="config.showMulliganInfo"
				@update:model-value="updateConfig({ showMulliganInfo: $event })"
			/>
		</ScreenSettingsCard>

		<!-- Layout -->
		<ScreenSettingsCard title="Layout">
			<UFormField
				label="Left Side of Screen"
				description="Which player seat appears on the left side of the match screen."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.leftSidePlayer ?? 'player1'"
					:items="leftSidePlayerOptions"
					value-key="value"
					class="w-48"
					@update:model-value="updateConfig({ leftSidePlayer: $event })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<!-- Control Permissions -->
		<ScreenSettingsCard
			title="Control Permissions"
			subtitle="Controls that players can use from the match screen. Disabled controls are still visible as read-only information."
			:saving="saving"
		>
			<ScreenSettingsToggle
				label="Life Total Controls"
				description="Allow players to adjust life totals."
				:model-value="config.allowLifeControls"
				@update:model-value="updateConfig({ allowLifeControls: $event })"
			/>
			<ScreenSettingsToggle
				label="Game Win Controls"
				description="Allow players to record and undo game wins."
				:model-value="config.allowGameWinControls"
				@update:model-value="updateConfig({ allowGameWinControls: $event })"
			/>
			<ScreenSettingsToggle
				label="Counter Controls"
				description="Allow players to add, remove, and adjust counters."
				disabled-description="No counter types available for this game."
				:enabled="hasCounterTypes"
				:model-value="config.allowCounterControls"
				@update:model-value="updateConfig({ allowCounterControls: $event })"
			/>
		</ScreenSettingsCard>
	</div>
</template>
