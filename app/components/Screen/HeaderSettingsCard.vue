<script setup lang="ts">
import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';

/**
 * The Header card every Screen Mode carrying `headerConfigShape` renders: the
 * header toggle, and while it shows, the custom header text, whose empty value
 * is the mode's own title. Clearing the text emits the `null` that deletes it
 * (ADR-0041). Its default slot, after the fields, takes the title Mode Tokens.
 */
withDefaults(defineProps<{
	config: { showHeader: boolean; headerText?: string | null };
	/** The mode's contract field views of `headerConfigShape`. */
	fields: { showHeader: ScreenModeConfigField; headerText: ScreenModeConfigField };
	/** What the header shows, in the mode's own words. */
	showDescription: string;
	/** What an empty custom text shows instead. */
	autoDescription: string;
	/** The card's title. */
	title?: string;
	/** `mode:card`; remembers the open state per browser. */
	id?: string;
	/** One line shown in the header while closed. */
	summary?: string;
}>(), { title: 'Header' });

const emit = defineEmits<{
	update: [patch: { showHeader?: boolean; headerText?: string | null }];
}>();
</script>

<template>
	<ScreenSettingsSection :id="id" :title="title" :summary="summary">
		<ScreenConfigField
			:field="fields.showHeader"
			:model-value="config.showHeader"
			:description="showDescription"
			@update:model-value="emit('update', { showHeader: $event === true })"
		/>

		<ScreenConfigField
			v-if="config.showHeader"
			:field="fields.headerText"
			:model-value="config.headerText"
			:description="autoDescription"
			placeholder="Auto"
			nullable
			@update:model-value="emit('update', { headerText: $event === null ? null : String($event) })"
		/>

		<slot />
	</ScreenSettingsSection>
</template>
