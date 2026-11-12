<script setup lang="ts">
import type { DeckModeConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { patchedBoardLayout, sideboardOwnFields } from '~~/shared/screenModeConfigs/deck';
import { resolveDeckBoards } from '~~/shared/types/screenConfig';
import { useModeSettingsRenderer } from '~/composables/screen/useModeSettingsRenderer';

/**
 * The Deck List Screen's settings: the generic renderer (#1094), with the two
 * widgets no plain control is: the board show toggles, writing the one `board`
 * selection (`board-toggles`), and, heading the Sideboard group while the
 * sideboard shows, whether it takes the mainboard's layout or holds its own
 * (`before:sideboard`, #1091). Customise stores the mainboard's layout values
 * as the sideboard's own; following again keeps only its view and reveal.
 */
defineProps<{
	screen: Screen;
	eventId: number;
}>();

defineExpose(useModeSettingsRenderer());

function boardsOf(config: Readonly<Record<string, any>>) {
	return resolveDeckBoards(config as Partial<DeckModeConfig>);
}

/** The sideboard block that follows the mainboard's layout, or that holds a copy of it as its own. */
function sideboardFollowing(config: Readonly<Record<string, any>>, follows: boolean) {
	const { sideboard } = boardsOf(config);
	return follows
		? sideboardOwnFields(sideboard)
		: patchedBoardLayout(sideboard, {});
}
</script>

<template>
	<ScreenModeSettings ref="renderer" :screen="screen" :event-id="eventId">
		<template #board-toggles="{ config, update }">
			<ScreenModesDeckBoardToggles
				:config="config"
				:event-id="eventId"
				@update="update($event)"
			/>
		</template>

		<template #before:sideboard="{ config, update }">
			<div
				v-if="boardsOf(config).board !== 'mainboard'"
				:data-board-layout="boardsOf(config).sideboardCustomised ? 'own' : 'mainboard'"
				class="flex items-center justify-between gap-3"
			>
				<ScreenSettingsHint>
					{{ boardsOf(config).sideboardCustomised
						? 'Has its own layout.'
						: 'Uses the mainboard\'s layout.' }}
				</ScreenSettingsHint>
				<UButton
					size="xs"
					color="neutral"
					variant="outline"
					:label="boardsOf(config).sideboardCustomised ? 'Use mainboard\'s' : 'Customise'"
					@click="update({ sideboard: sideboardFollowing(config, boardsOf(config).sideboardCustomised) })"
				/>
			</div>
		</template>
	</ScreenModeSettings>
</template>
