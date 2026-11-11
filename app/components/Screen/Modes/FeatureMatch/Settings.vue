<script setup lang="ts">
import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import type { Screen } from '~/types';
import { getCounterTypeConfigs, getFeatureMatchStateTracking, getGameConfig, getPlayerIdentityLabel } from '~~/shared/config/games';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { useConsumedEventData } from '~/modules/event-data/resync';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const featureMatchStore = useFeatureMatchStore();
const featureMatchStateStore = useFeatureMatchStateStore();
const eventStore = useEventStore();

// Each control's label, read from the mode's config contract (#498).
const fields = screenModeConfigContract('feature-match').fields;

const identityLabel = computed(() => {
	const game = eventStore.event?.game;
	return game
		? getPlayerIdentityLabel(game)
		: 'Deck';
});

// Event-level feature gates
const matchDefaults = computed(() => toFeatureMatchDefaults(eventStore.event));
const hasCounterTypes = computed(() => {
	const game = eventStore.event?.game;
	return game
		? getCounterTypeConfigs(game).length > 0
		: false;
});
const hasTurnTracking = computed(
	() => matchDefaults.value.turnTrackingEnabled || matchDefaults.value.activePlayerTrackingEnabled,
);
const hasStandings = computed(() => eventStore.event?.standingsEnabled ?? true);
// What the Card Game tracks bounds what the Event's toggles can turn on.
const tracks = computed(() => {
	const game = eventStore.event?.game;
	return game
		? getFeatureMatchStateTracking(game)
		: null;
});
const notTracked = computed(() => {
	const game = eventStore.event?.game;
	return game
		? `Not tracked in ${getGameConfig(game).label}.`
		: undefined;
});
const hasLifeTracking = computed(() => tracks.value?.life ?? true);
const hasExtraTurns = computed(() => (tracks.value?.overtime ?? true) && matchDefaults.value.extraTurnsEnabled);
const hasMulliganTracking = computed(() => (tracks.value?.mulligan ?? true) && matchDefaults.value.mulliganTrackingEnabled);
const hasPronouns = computed(() => eventStore.event?.pronounsEnabled ?? true);
const hasLgs = computed(() => eventStore.event?.lgsEnabled ?? false);
const hasTableNumber = computed(() => eventStore.event?.tableNumberEnabled ?? false);

// Orientation-aware labels for the left-side player select
const isVerticalArena = computed(() => eventStore.event?.featureMatchOrientation === 'vertical');

const leftSidePlayerItems = computed(() => {
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

const NO_COUNTER_TYPES = 'No counter types available for this game.';

type ToggleKey = Exclude<keyof typeof fields, 'leftSidePlayer'>;

/** One toggle of a card: its contract field, and the feature gate the Event and Card Game put on it. */
interface ToggleSetting {
	key: ToggleKey;
	field: ScreenModeConfigField;
	description: string;
	enabled?: boolean;
	disabledDescription?: string;
}

function toggleSetting(key: ToggleKey, setting: Omit<ToggleSetting, 'key' | 'field'>): ToggleSetting {
	return { key, field: fields[key], ...setting };
}

const playerInfo = computed(() => [
	toggleSetting('showPronouns', {
		description: 'Show player pronouns next to their name.',
		enabled: hasPronouns.value,
		disabledDescription: 'Enable player pronouns in event settings to use this.',
	}),
	{
		...toggleSetting('showDeckNames', {
			description: `Show player ${identityLabel.value.toLowerCase()} names below their name.`,
		}),
		// The contract labels it for Magic; each Card Game names its own player identity.
		field: {
			...fields.showDeckNames,
			label: fields.showDeckNames.label.replace('Deck', identityLabel.value),
		},
	},
	toggleSetting('showRecords', {
		description: 'Show the player record or position next to their name.',
		enabled: hasStandings.value,
		disabledDescription: 'Enable player standings in event settings to use this.',
	}),
	toggleSetting('showLgs', {
		description: 'Show the player\'s Local Game Store.',
		enabled: hasLgs.value,
		disabledDescription: 'Enable LGS tracking in event settings to use this.',
	}),
]);

const matchDisplay = computed(() => [
	toggleSetting('showClock', { description: 'Show the match clock.' }),
	toggleSetting('showTableNumber', {
		description: 'Show the match table number in the header.',
		enabled: hasTableNumber.value,
		disabledDescription: 'Enable table numbers in event settings to use this.',
	}),
	toggleSetting('showSeatLabels', {
		description: `Show ${isVerticalArena.value ? 'Top/Bottom' : 'Left/Right'} labels next to player names.`,
	}),
]);

const gameState = computed(() => [
	toggleSetting('showCounters', {
		description: 'Show player counters (poison, energy, etc.).',
		enabled: hasCounterTypes.value,
		disabledDescription: NO_COUNTER_TYPES,
	}),
	toggleSetting('showTurnControls', {
		description: 'Show the turn counter and active player controls.',
		enabled: hasTurnTracking.value,
		disabledDescription: 'Enable turn or active player tracking in event settings to use this.',
	}),
	toggleSetting('showOvertime', {
		description: 'Show the extra turns tracker when overtime begins.',
		enabled: hasExtraTurns.value,
		disabledDescription: tracks.value?.overtime === false
			? notTracked.value
			: 'Enable extra turns in event format settings to use this.',
	}),
	toggleSetting('showMulliganInfo', {
		description: 'Show the cards kept indicator during mulligan phase.',
		enabled: hasMulliganTracking.value,
		disabledDescription: tracks.value?.mulligan === false
			? notTracked.value
			: 'Enable mulligan tracking in event settings to use this.',
	}),
]);

const controlPermissions = computed(() => [
	toggleSetting('allowLifeControls', {
		description: 'Allow players to adjust life totals.',
		enabled: hasLifeTracking.value,
		disabledDescription: notTracked.value,
	}),
	toggleSetting('allowGameWinControls', { description: 'Allow players to record and undo game wins.' }),
	toggleSetting('allowCounterControls', {
		description: 'Allow players to add, remove, and adjust counters.',
		enabled: hasCounterTypes.value,
		disabledDescription: NO_COUNTER_TYPES,
	}),
]);

/** On as the Screen shows it: a gated-off toggle is off whatever its saved value. */
function isOn(setting: ToggleSetting): boolean {
	return setting.enabled !== false && config.value[setting.key] === true;
}

/** The labels of the toggles that are on, `Show` dropped: a closed card's summary. */
function onLabels(settings: ToggleSetting[]): string[] {
	return settings.filter(isOn).map(setting => setting.field.label.replace(/^Show /, ''));
}

const MATCH_DISPLAY_CARD = 'feature-match:match-display';

/** A card of toggles, summarised by those that are on, or `none`. */
interface ToggleCard {
	id: string;
	title: string;
	subtitle?: string;
	settings: ToggleSetting[];
	summary: string;
}

function toggleCard(card: Omit<ToggleCard, 'summary'>, none: string, ...extra: string[]): ToggleCard {
	return {
		...card,
		summary: [
			...onLabels(card.settings),
			...extra,
		].join(' · ') || none,
	};
}

const toggleCards = computed(() => {
	const leftSide = leftSidePlayerItems.value.find(item => item.value === config.value.leftSidePlayer);
	return [
		toggleCard({ id: 'feature-match:player-info', title: 'Player Info', settings: playerInfo.value }, 'Nothing shown'),
		// Match Display ends with the left side select, so its summary does too.
		toggleCard({ id: MATCH_DISPLAY_CARD, title: 'Match Display', settings: matchDisplay.value }, 'Nothing shown', `${fields.leftSidePlayer.label}: ${leftSide?.label}`),
		toggleCard({ id: 'feature-match:game-state', title: 'Game State', settings: gameState.value }, 'Nothing shown'),
		toggleCard({
			id: 'feature-match:control-permissions',
			title: 'Control Permissions',
			subtitle: 'Controls that players can use from the match screen. Disabled controls are still visible as read-only information.',
			settings: controlPermissions.value,
		}, 'None allowed'),
	];
});

function writeToggle(key: ToggleKey, value: unknown) {
	updateConfig({ [key]: value === true } as Partial<Record<ToggleKey, boolean>>);
}

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['featureMatchSlots']);

// Load matches on mount
onMounted(async () => {
	if (props.eventId) {
		await featureMatchStore.loadFeatureMatchesByEventId(props.eventId);
	}
});

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
		<ScreenSettingsSection title="Feature Match Slot" :collapsible="false">
			<ScreenSettingsField label="Feature Match Slot" description="The Slot whose Match this Screen controls.">
				<ScreenFeatureMatchSelect
					:model-value="config.featureMatchId"
					placeholder="Select a slot…"
					detailed
					@update:model-value="handleMatchChange($event)"
				/>
			</ScreenSettingsField>
		</ScreenSettingsSection>

		<ScreenSettingsSection
			v-for="card in toggleCards"
			:id="card.id"
			:key="card.id"
			:title="card.title"
			:subtitle="card.subtitle"
			:summary="card.summary"
		>
			<ScreenConfigField
				v-for="setting in card.settings"
				:key="setting.key"
				:field="setting.field"
				:model-value="config[setting.key]"
				:description="setting.description"
				:enabled="setting.enabled"
				:disabled-description="setting.disabledDescription"
				@update:model-value="writeToggle(setting.key, $event)"
			/>
			<ScreenConfigField
				v-if="card.id === MATCH_DISPLAY_CARD"
				:field="fields.leftSidePlayer"
				:model-value="config.leftSidePlayer"
				:items="leftSidePlayerItems"
				description="Which player seat appears on the left side of the match screen."
				@update:model-value="$event && updateConfig({ leftSidePlayer: $event })"
			/>
		</ScreenSettingsSection>
	</div>
</template>
