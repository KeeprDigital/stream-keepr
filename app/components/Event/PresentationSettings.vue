<script setup lang="ts">
import type { ThemeSummary } from '~~/shared/types/theme';
import type { Event } from '~/types';

// Event Presentation Settings: what an Event sets once for every Screen it has.
// Its Theme, and its on-air wording and formatting, which stay on the Event so
// one Theme serves Events that word things differently (ADR-0051).

const props = defineProps<{
	event: Event;
	loading?: boolean;
}>();

/** The picker's value for no Theme, which renders the Default Theme. */
const DEFAULT_THEME = 'default';

const initialData = computed(() => ({
	themeId: props.event.themeId ?? DEFAULT_THEME,
	displayRecordSeparator: props.event.displayRecordSeparator,
	displayHideZeroDraws: props.event.displayHideZeroDraws,
	displayPositionFormat: props.event.displayPositionFormat,
}));

const { formData, isDirty, reset, save, saving } = useEventConfigForm({
	initialData,
	toUpdate: ({ themeId, ...changes }) => ({
		...changes,
		...(themeId === undefined
			? {}
			: {
					themeId: themeId === DEFAULT_THEME
						? null
						: themeId,
				}),
	}),
});

const themes = ref<ThemeSummary[]>([]);
const themesUnavailable = ref(false);
const repository = useThemeRepository();
onMounted(async () => {
	try {
		themes.value = await repository.list();
	}
	catch (error) {
		console.error('Failed to load Themes:', error);
		themesUnavailable.value = true;
	}
});

const themeItems = computed(() => {
	const items = [
		{ label: 'Default Theme', value: DEFAULT_THEME },
		...themes.value.map(theme => ({ label: theme.name, value: theme.id })),
	];
	// The Event's own Theme stays nameable while the library loads.
	const selected = formData.value.themeId;
	return selected && !items.some(item => item.value === selected)
		? [
				...items,
				{ label: 'Selected Theme', value: selected },
			]
		: items;
});
</script>

<template>
	<UForm :state="formData" @submit="save">
		<UCard variant="subtle">
			<div class="w-full flex flex-col gap-4">
				<UFormField
					name="themeId"
					label="Theme"
					description="How every Screen of this Event looks. Switching restyles every Screen Output at once."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<div class="flex flex-col items-end gap-1">
						<USelect v-model="formData.themeId" class="w-64" :items="themeItems" />
						<NuxtLink to="/themes" class="text-xs text-muted hover:underline">
							Manage Themes
						</NuxtLink>
						<p v-if="themesUnavailable" class="text-xs text-error">
							The Theme library could not be loaded.
						</p>
					</div>
				</UFormField>

				<USeparator />

				<UFormField
					name="displayRecordSeparator"
					label="Record Separator"
					description="Character(s) to use between wins, losses, and draws."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect v-model="formData.displayRecordSeparator" class="w-64" :items="RECORD_SEPARATOR_SELECT_OPTIONS" />
				</UFormField>

				<UFormField
					name="displayPositionFormat"
					label="Position Format"
					description="How player positions are shown."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect v-model="formData.displayPositionFormat" class="w-64" :items="POSITION_FORMAT_SELECT_OPTIONS" />
				</UFormField>

				<USeparator />

				<UFormField
					name="displayHideZeroDraws"
					label="Hide Zero Draws"
					description="Don't show draws in the record when the value is 0."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.displayHideZeroDraws" />
				</UFormField>
			</div>
			<template #footer>
				<EventConfigFormFooter :is-dirty="isDirty" :loading="loading || saving" @reset="reset" />
			</template>
		</UCard>
	</UForm>
</template>
