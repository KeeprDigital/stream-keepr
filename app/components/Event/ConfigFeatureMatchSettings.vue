<script setup lang="ts">
import type { Event, UpdateEventInput } from '~/types';
import { fromFeatureMatchDefaults, toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';

const props = defineProps<{
	event: Event;
	loading?: boolean;
}>();

const initialData = computed(() => {
	const defaults = toFeatureMatchDefaults(props.event);
	return {
		pronounsEnabled: props.event.pronounsEnabled,
		standingsEnabled: props.event.standingsEnabled,
		turnTrackingEnabled: defaults.turnTrackingEnabled,
		activePlayerTrackingEnabled: defaults.activePlayerTrackingEnabled,
		mulliganTrackingEnabled: defaults.mulliganTrackingEnabled,
		extraTurnsLabel: defaults.extraTurnsLabel,
		lgsEnabled: props.event.lgsEnabled,
		tableNumberEnabled: props.event.tableNumberEnabled,
		featureMatchNotesEnabled: props.event.featureMatchNotesEnabled,
	};
});

const { formData, isDirty, reset, save } = useEventConfigForm({
	initialData,
	toUpdate,
});

function toUpdate(changes: Partial<typeof initialData.value>): UpdateEventInput {
	const { pronounsEnabled, standingsEnabled, lgsEnabled, tableNumberEnabled, featureMatchNotesEnabled, ...matchDefaults } = changes;
	const eventToggles = Object.fromEntries(
		Object.entries({
			pronounsEnabled,
			standingsEnabled,
			lgsEnabled,
			tableNumberEnabled,
			featureMatchNotesEnabled,
		}).filter(([key]) => key in changes),
	);
	return {
		...eventToggles,
		...fromFeatureMatchDefaults(matchDefaults),
	} as UpdateEventInput;
}
</script>

<template>
	<UForm :state="formData" @submit="save">
		<UCard variant="subtle">
			<div class="w-full flex flex-col gap-4">
				<UFormField
					name="pronounsEnabled"
					label="Player Pronouns"
					description="Show a pronouns field on player forms and match panels."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.pronounsEnabled" />
				</UFormField>

				<UFormField
					name="standingsEnabled"
					label="Player Standings"
					description="Show player record (W-L-D) and position inputs on match setup forms."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.standingsEnabled" />
				</UFormField>

				<UFormField
					name="turnTrackingEnabled"
					label="Turn Tracking"
					description="Show a turn counter on match panels to track the current turn number."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.turnTrackingEnabled" />
				</UFormField>

				<UFormField
					name="mulliganTrackingEnabled"
					label="Mulligan Tracking"
					description="Record the number of cards each player kept in their opening hand. Shown during turn 0 before the game begins."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.mulliganTrackingEnabled" />
				</UFormField>

				<UFormField
					name="activePlayerTrackingEnabled"
					label="Active Player Tracking"
					description="Track whose turn it is. When combined with turn tracking, the active player swaps automatically on turn change."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.activePlayerTrackingEnabled" />
				</UFormField>

				<UFormField
					name="lgsEnabled"
					label="LGS Tracking"
					description="Show a Local Game Store field on player forms."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.lgsEnabled" />
				</UFormField>

				<UFormField
					name="tableNumberEnabled"
					label="Table Numbers"
					description="Show a table number field on match setup forms."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.tableNumberEnabled" />
				</UFormField>

				<UFormField
					name="featureMatchNotesEnabled"
					label="Feature Match Notes"
					description="Show a production note on each Feature Match for the crew to share."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.featureMatchNotesEnabled" />
				</UFormField>

				<UFormField
					v-if="event.featureMatchDefaultExtraTurnsEnabled"
					name="extraTurnsLabel"
					label="Extra Turns Label"
					description="Label shown for the extra turns indicator (e.g. 'Extra Turns', 'Overtime')."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInput v-model="formData.extraTurnsLabel" class="w-64" />
				</UFormField>
			</div>
			<template #footer>
				<EventConfigFormFooter :is-dirty="isDirty" :loading="loading" @reset="reset" />
			</template>
		</UCard>
	</UForm>
</template>
