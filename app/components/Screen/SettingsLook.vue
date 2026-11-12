<script setup lang="ts">
import type { SettingsPageLook } from '~/modules/screen-mode/settingsPage';

/**
 * A settings card's Look (#1060, ADR-0072): the Mode Tokens of the card's
 * Screen Settings Groups, each group under its heading, collapsed until the
 * operator opens it. Closed, it says how many the Screen overrides; open, it
 * offers to clear them all in one write. Each row reads and writes through the
 * one Screen Theme Override instance the Screen's page provides.
 */
const props = defineProps<{
	/** `mode:card`; remembers the open state per browser. */
	id: string;
	eventId: number;
	looks: readonly SettingsPageLook[];
}>();

const overrides = useScreenThemeOverrides();

const names = computed(() => props.looks.flatMap(look => look.tokens));
const overridden = computed(() => names.value.filter(name => overrides.overrides.value[name] !== undefined).length);
const summary = computed(() => {
	if (overridden.value === 0)
		return 'Default';
	return overridden.value === 1
		? '1 Screen Theme Override'
		: `${overridden.value} Screen Theme Overrides`;
});
</script>

<template>
	<div data-settings-look :data-overridden="overridden">
		<ScreenSettingsSection
			:id="id"
			density="row"
			title="Look"
			icon="i-lucide-palette"
			:summary="summary"
			:default-open="false"
		>
			<ScreenThemeTokenRows
				v-for="look in looks"
				:key="look.group"
				:event-id="eventId"
				:heading="look.title"
				:names="look.tokens"
				:data-settings-group="look.group"
			/>
			<div v-if="overridden > 0" class="flex justify-end">
				<UButton
					color="neutral"
					variant="outline"
					size="sm"
					icon="i-lucide-rotate-ccw"
					:label="overridden === 1 ? 'Clear the override' : `Clear ${overridden} overrides`"
					@click="overrides.clearAll(names)"
				/>
			</div>
		</ScreenSettingsSection>
	</div>
</template>
