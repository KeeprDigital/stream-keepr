<script setup lang="ts">
import type { ModeSettingsExposed } from '~/modules/screen-mode/settingsPage';
import type { Screen } from '~/types';
import { isColumnVisible } from '~~/shared/screenModeConfigs/subShapes';
import { passOnRendererExposed } from '~/modules/screen-mode/settingsPage';

/**
 * The Standings settings page: the generic renderer (#1094), with the reveal
 * controls in its Live card and the Position Change warning under its table.
 */
defineProps<{
	screen: Screen;
	eventId: number;
}>();

const renderer = useTemplateRef<ModeSettingsExposed>('renderer');

defineExpose(passOnRendererExposed(renderer));

/** The Position Change column shows, yet the Screen's own read found no previous Round to compare with (#905). */
function warnsPositionChangeHasNoData(config: Readonly<Record<string, any>>, noPreviousRoundStandings: boolean | undefined): boolean {
	return isColumnVisible(config.columns ?? [], 'positionChange') && noPreviousRoundStandings === true;
}
</script>

<template>
	<ScreenModeSettings ref="renderer" :screen="screen" :event-id="eventId">
		<template #reveal="{ config, update }">
			<ScreenModesStandingsRevealControls
				:revealed-count="config.revealedCount"
				:reveal-count="config.revealCount"
				@update="update"
			/>
		</template>

		<template #after:table="{ config, data }">
			<UAlert
				v-if="warnsPositionChangeHasNoData(config, data?.noPreviousRoundStandings?.value)"
				data-testid="position-change-no-data"
				color="warning"
				variant="soft"
				icon="i-lucide-triangle-alert"
				title="Position Change has no data for this Event yet"
				description="No Round before this Screen's Round holds Round Standings to compare with, so every Position Change cell is blank until Melee Sync stores them."
			/>
		</template>
	</ScreenModeSettings>
</template>
