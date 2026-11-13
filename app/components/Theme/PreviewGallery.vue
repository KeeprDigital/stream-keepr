<script setup lang="ts">
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { Game, Variant } from '~~/shared/types/enums';
import { eventKind, GAME_CONFIGS, isOfferedToEvent } from '~~/shared/config/games';
import { SCREEN_MODES, THEME_PREVIEW_SCREEN_MODES } from '~~/shared/screenModes';
import { GAME_VALUES } from '~~/shared/types/enums';

defineProps<{
	/** The Theme previewed, as stored. */
	tokens: StoredThemeTokens;
}>();

/**
 * A Theme serves Events of every Card Game, and each previews its own sample:
 * the operator picks which, and sees the modes its Events are offered. A
 * Commander Event is a pick beside the Card Games, as its Feature Match Overlay
 * seats four (ADR-0087).
 */
type PreviewPick = Game | 'commander';
const PICKS: Record<PreviewPick, { label: string; game: Game; variant?: Variant }> = {
	...Object.fromEntries(GAME_VALUES.map(value => [
		value,
		{ label: GAME_CONFIGS[value].label, game: value },
	])) as Record<Game, { label: string; game: Game }>,
	commander: { label: 'Commander', game: 'mtg', variant: 'commander' },
};
const PICK_ORDER: readonly PreviewPick[] = [
	'mtg',
	'commander',
	...GAME_VALUES.filter(value => value !== 'mtg'),
];

const pick = ref<PreviewPick>('mtg');
const picks = PICK_ORDER.map(value => ({ label: PICKS[value].label, value }));
const picked = computed(() => PICKS[pick.value]);
const modes = computed(() => THEME_PREVIEW_SCREEN_MODES.filter(mode =>
	isOfferedToEvent(SCREEN_MODES[mode].offeredTo, eventKind(picked.value))));
</script>

<template>
	<div class="flex flex-col gap-4">
		<UISegmentedTabs
			:model-value="pick"
			:items="picks"
			aria-label="Card Game"
			@update:model-value="value => pick = value as PreviewPick"
		/>
		<!-- Every Screen Mode a Theme preview shows, read off its definition: a newly themed mode appears with no change here. -->
		<div class="grid gap-4 sm:grid-cols-2">
			<ThemePreviewTile
				v-for="mode in modes"
				:key="`${pick}:${mode}`"
				:mode="mode"
				:game="picked.game"
				:variant="picked.variant"
				:label="SCREEN_MODES[mode].label"
				:tokens="tokens"
			/>
		</div>
	</div>
</template>
