<script setup lang="ts">
import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import type { QuantityPosition } from '~~/shared/types/enums';
import { BADGE_DISABLED_POINTS } from '~/utils/cardBadges';

/**
 * One card badge's settings, as Most Played Cards and Deck List badge their
 * cards: whether it shows, then while it shows, where it sits (never the
 * card's centre) and its text size. Each edit is emitted as the patch naming
 * its contract field's key, in stored values.
 *
 * Its show control is a toggle of `shownField`, or the `shown` slot's own
 * control where a badge is chosen rather than switched (a stat badge's
 * metric); with neither, the badge's showing is decided elsewhere. Without a
 * `sizeField` the badge has no text size. The `look` slot, after the fields,
 * takes the badge's Mode Tokens.
 */
withDefaults(defineProps<{
	/** The badge's name, heading its fields. */
	title: string;
	shown: boolean;
	shownField?: ScreenModeConfigField;
	shownDescription?: string;
	position: QuantityPosition;
	positionField: ScreenModeConfigField;
	positionDescription?: string;
	textSize?: number;
	sizeField?: ScreenModeConfigField;
	sizeDescription?: string;
}>(), {
	positionDescription: 'Where the badge appears on the card.',
	sizeDescription: 'The badge\'s text size in px; the badge sizes itself around it.',
});

const emit = defineEmits<{
	update: [patch: Record<string, boolean | number | QuantityPosition>];
}>();

function write(field: ScreenModeConfigField, value: boolean | number | QuantityPosition) {
	emit('update', { [field.key]: value });
}
</script>

<template>
	<div class="flex flex-col gap-4">
		<p class="text-xs font-semibold uppercase tracking-wider text-muted">
			{{ title }}
		</p>

		<ScreenConfigField
			v-if="shownField"
			:field="shownField"
			:model-value="shown"
			:description="shownDescription"
			@update:model-value="write(shownField, $event === true)"
		/>
		<slot v-else name="shown" />

		<template v-if="shown">
			<USeparator v-if="shownField || $slots.shown" />

			<ScreenSettingsField
				:data-config-field="positionField.key"
				:label="positionField.label"
				:description="positionDescription"
			>
				<UINinePointPicker
					:model-value="position"
					:disabled-points="BADGE_DISABLED_POINTS"
					:aria-label="`${title} position`"
					@update:model-value="write(positionField, $event as QuantityPosition)"
				/>
			</ScreenSettingsField>

			<ScreenConfigField
				v-if="sizeField"
				:field="sizeField"
				:model-value="textSize"
				:description="sizeDescription"
				@update:model-value="$event !== null && write(sizeField, Number($event))"
			/>
		</template>

		<slot name="look" />
	</div>
</template>
