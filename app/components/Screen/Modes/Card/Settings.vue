<script setup lang="ts">
import type { Screen } from '~/types';
import {
	CARD_ANIMATION_SPEED_SELECT_OPTIONS,
	HORIZONTAL_ALIGN_SELECT_OPTIONS,
	VERTICAL_ALIGN_SELECT_OPTIONS,
} from '~~/shared/utils/selectOptions';
import { useScreenConfigUpdate } from '~/composables/screen/useScreenConfigUpdate';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const featureMatchStore = useFeatureMatchStore();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'card',
);

const { screenConfig, updateScreenConfig } = useScreenConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
);

defineExpose({ resetConfig, saving });

onMounted(async () => {
	if (props.eventId) {
		await featureMatchStore.loadFeatureMatchesByEventId(props.eventId);
	}
});

const matchOptions = useFeatureMatchMenuItems();

const hasMatchBinding = computed(() => !!config.value.featureMatchId);
</script>

<template>
	<div class="flex flex-col gap-6">
		<!-- Match Binding (Optional) -->
		<ScreenSettingsCard title="Match Binding">
			<UFormField
				label="Linked Match"
				description="Optionally link to a match. When selected in the card search page, the linked match's decklists will auto-load."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.featureMatchId ?? undefined"
					:items="matchOptions"
					value-key="value"
					placeholder="No match linked"
					class="w-72"
					:ui="{ content: 'min-w-fit' }"
					@update:model-value="updateConfig({ featureMatchId: ($event ?? null) })"
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

			<p v-if="!hasMatchBinding" class="text-sm text-muted">
				No match linked. Cards can still be pushed to this screen from the card search page.
			</p>
		</ScreenSettingsCard>

		<!-- Display Settings -->
		<ScreenSettingsCard title="Screen Settings">
			<UFormField
				label="Card Scale"
				description="Scale multiplier for the card size (0.5 - 2.0)."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.scale"
					:min="0.5"
					:max="2"
					:step="0.1"
					class="w-32"
					@update:model-value="updateConfig({ scale: Number($event) })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<!-- Animation Settings -->
		<ScreenSettingsCard title="Animation">
			<ScreenSettingsToggle
				label="Enable Animation"
				description="Animate card transitions with zoom/fade effect."
				:model-value="config.animationEnabled"
				@update:model-value="updateConfig({ animationEnabled: $event })"
			/>

			<UFormField
				v-if="config.animationEnabled"
				label="Animation Speed"
				description="Speed of the transition animation."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.animationSpeed"
					:items="CARD_ANIMATION_SPEED_SELECT_OPTIONS"
					class="w-32"
					@update:model-value="updateConfig({ animationSpeed: $event })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<!-- Position Settings -->
		<ScreenSettingsCard title="Position">
			<UFormField
				label="Horizontal Alignment"
				description="Horizontal position of the card on screen."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="screenConfig.horizontalAlign"
					:items="HORIZONTAL_ALIGN_SELECT_OPTIONS"
					class="w-32"
					@update:model-value="updateScreenConfig({ horizontalAlign: $event })"
				/>
			</UFormField>

			<UFormField
				label="Vertical Alignment"
				description="Vertical position of the card on screen."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="screenConfig.verticalAlign"
					:items="VERTICAL_ALIGN_SELECT_OPTIONS"
					class="w-32"
					@update:model-value="updateScreenConfig({ verticalAlign: $event })"
				/>
			</UFormField>
		</ScreenSettingsCard>
	</div>
</template>
