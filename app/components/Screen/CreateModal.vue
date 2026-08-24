<script setup lang="ts">
import type { CreateScreenInput, Screen } from '~/types';
import { getScreenModeDefinition } from '~/modules/screen-mode';

const props = defineProps<{
	eventId: number;
	editScreen?: Screen | null;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
	(e: 'created', screen: Screen): void;
	(e: 'updated', screen: Screen): void;
}>();

const SLUG_NON_ALNUM_RE = /[^a-z0-9]+/g;
const SLUG_TRIM_DASH_RE = /^-|-$/g;

const screenStore = useScreenStore();
const toast = useToast();
const { runRequest } = useRequestFeedback();

const isSubmitting = ref(false);

const isEditMode = computed(() => !!props.editScreen);
const modalTitle = computed(() => isEditMode.value ? 'Edit Screen' : 'Create Screen');
const formId = computed(() => props.editScreen ? `edit-screen-${props.editScreen.id}-form` : 'create-screen-form');

const formData = ref<CreateScreenInput>({
	name: props.editScreen?.name ?? '',
	slug: props.editScreen?.slug ?? '',
	currentMode: props.editScreen?.currentMode ?? 'background',
	modeConfigs: props.editScreen?.modeConfigs ?? null,
});

const derivedDisplayType = computed(() => {
	const mode = formData.value.currentMode ?? 'background';
	return getScreenModeDefinition(mode);
});

watch(() => formData.value.name, (name) => {
	if (!isEditMode.value && name) {
		formData.value.slug = name
			.toLowerCase()
			.replace(SLUG_NON_ALNUM_RE, '-')
			.replace(SLUG_TRIM_DASH_RE, '')
			.slice(0, 50);
	}
});

async function submit() {
	if (!formData.value.name.trim() || !formData.value.slug.trim()) {
		toast.add({
			title: 'Validation Error',
			description: 'Name and slug are required',
			color: 'error',
		});
		return;
	}

	await runRequest(
		async () => {
			let savedScreen: Screen | null;
			if (isEditMode.value && props.editScreen) {
				savedScreen = await screenStore.updateScreen(
					props.eventId,
					props.editScreen.id,
					formData.value,
				);
			}
			else {
				savedScreen = await screenStore.createScreen(props.eventId, formData.value);
			}

			if (!savedScreen)
				throw new Error(isEditMode.value ? 'Failed to update screen' : 'Failed to create screen');

			return savedScreen;
		},
		{
			loadingRef: isSubmitting,
			success: savedScreen => ({
				title: isEditMode.value ? 'Screen Updated' : 'Screen Created',
				description: `Screen "${savedScreen.name}" has been ${isEditMode.value ? 'updated' : 'created'}`,
				color: 'success',
			}),
			error: {
				title: 'Error',
				description: isEditMode.value ? 'Failed to update screen' : 'Failed to create screen',
				color: 'error',
			},
			onSuccess: (savedScreen) => {
				if (isEditMode.value)
					emit('updated', savedScreen);
				else
					emit('created', savedScreen);
				emit('close');
			},
			onFailure: ({ error }) => {
				console.error('Failed to save screen:', error);
			},
		},
	);
}
</script>

<template>
	<UModal
		:title="modalTitle"
		:close="{ onClick: () => emit('close') }"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<UForm
				:id="formId"
				:state="formData"
				@submit="submit"
			>
				<div class="w-full flex flex-col gap-4">
					<UFormField
						required
						name="name"
						label="Screen Name"
						description="A friendly name for this screen."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInput v-model="formData.name" class="w-64" />
					</UFormField>

					<UFormField
						required
						name="slug"
						label="URL Slug"
						description="Used in the screen URL. Lowercase letters, numbers, and hyphens only."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInput
							v-model="formData.slug"
							class="w-64"
							placeholder="main-screen"
							:disabled="isEditMode"
						/>
					</UFormField>

					<USeparator />

					<UFormField
						name="currentMode"
						label="Mode"
						description="The screen mode determines what is displayed and how."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<div class="flex flex-col gap-2">
							<USelect
								v-model="formData.currentMode"
								class="w-64"
								:items="SCREEN_MODE_SELECT_OPTIONS"
							/>
							<ScreenTypeBadge :display-type="derivedDisplayType.displayType" class="self-start" />
						</div>
					</UFormField>
				</div>
			</UForm>
		</template>

		<template #footer>
			<UButton
				variant="ghost"
				color="neutral"
				@click="emit('close')"
			>
				Cancel
			</UButton>
			<UButton
				type="submit"
				:form="formId"
				color="primary"
				:loading="isSubmitting"
			>
				{{ isEditMode ? 'Update Screen' : 'Create Screen' }}
			</UButton>
		</template>
	</UModal>
</template>
