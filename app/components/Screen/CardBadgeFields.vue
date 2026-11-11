<script setup lang="ts">
import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import type { QuantityPosition } from '~~/shared/types/enums';
import { BADGE_DISABLED_POINTS } from '~/utils/cardBadges';

/**
 * One card badge's row, as Most Played Cards and Deck List badge their cards:
 * whether it shows, then while it shows, where it sits (never the card's
 * centre) and its size, Auto or a text size in px. The row is a group named
 * for the badge; each control is named by its contract field. Each edit is
 * emitted as the patch naming its field's key, in stored values: an emptied
 * size is the `null` that returns it to Auto.
 *
 * Its show control is a switch of `shownField`, or the `shown` slot's own
 * control where a badge is chosen rather than switched (a stat badge's
 * metric); with neither, the badge's showing is decided elsewhere. Without a
 * `sizeField` the badge has no size control.
 */
defineProps<{
	/** The badge's name, heading its row. */
	title: string;
	description?: string;
	shown: boolean;
	shownField?: ScreenModeConfigField;
	position: QuantityPosition;
	positionField: ScreenModeConfigField;
	/** Its set text size in px; absent is Auto. */
	size?: number;
	sizeField?: ScreenModeConfigField;
}>();

const emit = defineEmits<{
	update: [patch: Record<string, boolean | number | QuantityPosition | null>];
}>();

function write(field: ScreenModeConfigField, value: boolean | number | QuantityPosition | null) {
	emit('update', { [field.key]: value });
}
</script>

<template>
	<div
		role="group"
		:aria-label="title"
		class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
	>
		<div class="min-w-0 flex-1">
			<p class="text-sm font-medium">
				{{ title }}
			</p>
			<p v-if="description" class="text-sm text-muted">
				{{ description }}
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-4">
			<USwitch
				v-if="shownField"
				:data-config-field="shownField.key"
				:aria-label="shownField.label"
				:model-value="shown"
				@update:model-value="write(shownField, $event === true)"
			/>
			<slot v-else name="shown" />

			<template v-if="shown">
				<UINinePointPicker
					:data-config-field="positionField.key"
					:aria-label="positionField.label"
					:model-value="position"
					:disabled-points="BADGE_DISABLED_POINTS"
					@update:model-value="write(positionField, $event as QuantityPosition)"
				/>

				<ScreenSettingsNumberField
					v-if="sizeField"
					:data-config-field="sizeField.key"
					:aria-label="sizeField.label"
					:model-value="size"
					:min="sizeField.min"
					:max="sizeField.max"
					:step="sizeField.step"
					placeholder="Auto"
					@update:model-value="write(sizeField, $event)"
				/>
			</template>
		</div>
	</div>
</template>
