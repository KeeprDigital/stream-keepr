<script setup lang="ts">
import type { Event } from '~/types';

const props = defineProps<{
	event: Event;
	loading?: boolean;
}>();

const errors = ref<Record<string, string>>({});

const initialData = computed(() => ({
	numFeatureMatches: props.event.numFeatureMatches,
	featureMatchOrientation: props.event.featureMatchOrientation,
}));

const { formData, isDirty, reset, save, saving } = useEventConfigForm({
	initialData,
	clearOnReset: errors,
	validate,
	toUpdate: changes => changes,
});

function validate(): boolean {
	errors.value = {};
	if (formData.value.numFeatureMatches !== undefined) {
		if (formData.value.numFeatureMatches < 1) {
			errors.value.numFeatureMatches = 'Must have at least 1 feature match';
		}
		else if (formData.value.numFeatureMatches > 10) {
			errors.value.numFeatureMatches = 'Cannot exceed 10 feature matches';
		}
	}
	return Object.keys(errors.value).length === 0;
}
</script>

<template>
	<UForm :state="formData" @submit="save">
		<UCard variant="subtle">
			<div class="w-full flex flex-col gap-4">
				<UFormField
					name="numFeatureMatches"
					label="Number of Feature Matches"
					description="The number of feature matches to track for this event."
					class="flex max-sm:flex-col justify-between items-start gap-4"
					:error="errors.numFeatureMatches"
				>
					<UInputNumber
						v-model="formData.numFeatureMatches"
						:min="1"
						:max="10"
						class="w-64"
					/>
				</UFormField>

				<UFormField
					name="featureMatchOrientation"
					label="Match Orientation"
					description="Physical orientation of the match arena. Labels players as Top/Bottom when vertical."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect v-model="formData.featureMatchOrientation" class="w-64" :items="FEATURE_MATCH_ORIENTATION_SELECT_OPTIONS" />
				</UFormField>
			</div>
			<template #footer>
				<EventConfigFormFooter :is-dirty="isDirty" :loading="loading || saving" @reset="reset" />
			</template>
		</UCard>
	</UForm>
</template>
