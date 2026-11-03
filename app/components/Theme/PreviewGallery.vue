<script setup lang="ts">
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { Game } from '~~/shared/types/enums';
import { GAME_CONFIGS, isOfferedToCardGame } from '~~/shared/config/games';
import { SCREEN_MODES, THEME_PREVIEW_SCREEN_MODES } from '~~/shared/screenModes';
import { GAME_VALUES } from '~~/shared/types/enums';

defineProps<{
	/** The Theme previewed, as stored. */
	tokens: StoredThemeTokens;
}>();

/**
 * A Theme serves Events of every Card Game, and each previews its own sample:
 * the operator picks which, and sees the modes its Events are offered.
 */
const game = ref<Game>('mtg');
const games = GAME_VALUES.map(value => ({ label: GAME_CONFIGS[value].label, value }));
const modes = computed(() => THEME_PREVIEW_SCREEN_MODES.filter(mode =>
	isOfferedToCardGame(SCREEN_MODES[mode].cardGames, game.value)));
</script>

<template>
	<div class="flex flex-col gap-4">
		<UISegmentedTabs
			:model-value="game"
			:items="games"
			aria-label="Card Game"
			@update:model-value="value => game = value as Game"
		/>
		<!-- Every Screen Mode a Theme preview shows, read off its definition: a newly themed mode appears with no change here. -->
		<div class="grid gap-4 sm:grid-cols-2">
			<ThemePreviewTile
				v-for="mode in modes"
				:key="`${game}:${mode}`"
				:mode="mode"
				:game="game"
				:label="SCREEN_MODES[mode].label"
				:tokens="tokens"
			/>
		</div>
	</div>
</template>
