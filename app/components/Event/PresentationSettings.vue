<script setup lang="ts">
import type { ThemeSummary } from '~~/shared/types/theme';
import type { Event } from '~/types';
import { EVENT_CANVAS_SIDE_BOUNDS } from '~~/shared/eventCanvas';
import { fromFeatureMatchDefaults, toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';

// Event Presentation Settings: what an Event sets once for every Screen it has.
// Its Theme, its Event Canvas, and its on-air wording and formatting, which stay
// on the Event so one Theme serves Events that word things differently (ADR-0051).

const props = defineProps<{
	event: Event;
	loading?: boolean;
}>();

/** The picker's value for no Theme, which renders the Default Theme. */
const DEFAULT_THEME = 'default';

const errors = ref<Record<string, string>>({});

const initialData = computed(() => {
	const defaults = toFeatureMatchDefaults(props.event);
	return {
		themeId: props.event.themeId ?? DEFAULT_THEME,
		canvasWidth: props.event.canvasWidth,
		canvasHeight: props.event.canvasHeight,
		displayRecordSeparator: props.event.displayRecordSeparator,
		displayHideZeroDraws: props.event.displayHideZeroDraws,
		displayPositionFormat: props.event.displayPositionFormat,
		holdingText: props.event.holdingText ?? '',
		extraTurnsLabel: defaults.extraTurnsLabel,
		untimedLabel: defaults.untimedLabel,
	};
});

const { formData, isDirty, reset, save, saving } = useEventConfigForm({
	initialData,
	clearOnReset: errors,
	validate,
	toUpdate: ({ themeId, holdingText, extraTurnsLabel, untimedLabel, ...changes }) => ({
		...changes,
		...fromFeatureMatchDefaults({ extraTurnsLabel, untimedLabel }),
		...(holdingText === undefined
			? {}
			: { holdingText: holdingText.trim() || null }),
		...(themeId === undefined
			? {}
			: {
					themeId: themeId === DEFAULT_THEME
						? null
						: themeId,
				}),
	}),
});

const CANVAS_SIDES = [
	['canvasWidth', 'Canvas width'],
	['canvasHeight', 'Canvas height'],
] as const;

function validate(): boolean {
	errors.value = {};
	for (const [side, label] of CANVAS_SIDES) {
		const value = formData.value[side];
		if (typeof value !== 'number' || !Number.isInteger(value) || value < EVENT_CANVAS_SIDE_BOUNDS.min || value > EVENT_CANVAS_SIDE_BOUNDS.max)
			errors.value[side] = `${label} must be between ${EVENT_CANVAS_SIDE_BOUNDS.min} and ${EVENT_CANVAS_SIDE_BOUNDS.max} pixels`;
	}
	return Object.keys(errors.value).length === 0;
}

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

				<div class="flex max-sm:flex-col justify-between items-start gap-4">
					<div>
						<p class="text-sm font-medium">
							Canvas
						</p>
						<p class="text-sm text-muted">
							The coordinate space every Screen of this Event is laid out in. Each Screen Output scales it to fit its window, so a 4K browser source renders the same layout sharper.
						</p>
					</div>
					<div class="flex gap-2 w-64">
						<UFormField
							name="canvasWidth"
							label="Width"
							:error="errors.canvasWidth"
							class="flex-1"
						>
							<UInputNumber
								v-model="formData.canvasWidth"
								:min="EVENT_CANVAS_SIDE_BOUNDS.min"
								:max="EVENT_CANVAS_SIDE_BOUNDS.max"
							/>
						</UFormField>
						<UFormField
							name="canvasHeight"
							label="Height"
							:error="errors.canvasHeight"
							class="flex-1"
						>
							<UInputNumber
								v-model="formData.canvasHeight"
								:min="EVENT_CANVAS_SIDE_BOUNDS.min"
								:max="EVENT_CANVAS_SIDE_BOUNDS.max"
							/>
						</UFormField>
					</div>
				</div>

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

				<USeparator />

				<UFormField
					name="holdingText"
					label="Holding Text"
					description="The message a Screen shows while coverage is paused."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UTextarea
						v-model="formData.holdingText"
						class="w-64"
						autoresize
						:rows="3"
						placeholder="Coverage resumes shortly."
					/>
				</UFormField>

				<UFormField
					name="extraTurnsLabel"
					label="Extra Turns Label"
					description="Shown for the extra turns indicator (e.g. 'Extra Turns', 'Overtime')."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInput v-model="formData.extraTurnsLabel" class="w-64" />
				</UFormField>

				<UFormField
					name="untimedLabel"
					label="Untimed Label"
					description="Shown where an untimed match's clock would be. Leave blank to show nothing."
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<UInput v-model="formData.untimedLabel" class="w-64" />
				</UFormField>
			</div>
			<template #footer>
				<EventConfigFormFooter :is-dirty="isDirty" :loading="loading || saving" @reset="reset" />
			</template>
		</UCard>
	</UForm>
</template>
