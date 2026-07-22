<script setup lang="ts">
import { LazyUIConfirmActionModal } from '#components';

const props = defineProps<{
	eventId: number;
}>();

const eventRepo = useEventRepository();
const eventStore = useEventStore();
const overlay = useOverlay();
const { runRequest } = useRequestFeedback();
const { refreshAfterMeleeReset } = useMeleeDataRefresh();

const loading = ref(false);
const fetching = ref(false);
const fetchError = ref<string | null>(null);
const credentialsConfigured = ref(false);

const initialData = ref({
	meleeEnabled: false,
	meleeEventId: '',
	meleeClientId: '',
	// Secret is never pre-filled from the server — leave blank to keep the stored secret.
	meleeClientSecret: '',
});

const { formData, originalFormData, isDirty, reset, updateOriginal } = useForm({
	initialData,
});

useRegisterDirtyState(isDirty);

async function fetchConfig() {
	await runRequest(
		() => eventRepo.getMeleeConfig(props.eventId),
		{
			loadingRef: fetching,
			errorRef: fetchError,
			success: false,
			error: false,
			onSuccess: (config) => {
				credentialsConfigured.value = config.meleeConfigured;
				updateOriginal({
					meleeEnabled: config.meleeEnabled,
					meleeEventId: config.meleeEventId || '',
					meleeClientId: config.meleeClientId || '',
					// Server no longer returns meleeClientSecret — keep empty so the field is never pre-filled.
					// Submitting an empty secret tells the server to preserve the existing stored value.
					meleeClientSecret: '',
				});
			},
			onFailure: () => {
				fetchError.value = 'Failed to load Melee configuration';
			},
		},
	);
}

async function submit() {
	const meleeEventIdChanged = originalFormData.value.meleeEventId.trim() !== formData.value.meleeEventId.trim();
	const meleeDataWillReset = !formData.value.meleeEnabled
		|| meleeEventIdChanged;
	const meleeWillBeDisabled = originalFormData.value.meleeEnabled && !formData.value.meleeEnabled;
	const meleeEventWillChange = originalFormData.value.meleeEnabled
		&& formData.value.meleeEnabled
		&& meleeEventIdChanged;

	if (meleeWillBeDisabled || meleeEventWillChange) {
		const modal = overlay.create(LazyUIConfirmActionModal);
		const confirmed = await modal.open({
			title: meleeWillBeDisabled ? 'Disable Melee Integration' : 'Change Melee Event',
			message: meleeWillBeDisabled
				? 'Disable Melee integration for this event? Imported Melee phases, rounds, matches, standings, players, and deck data will be removed. Linked feature match pairings from Melee will also be cleared.'
				: 'Switch this event to a different Melee event? Imported Melee phases, rounds, matches, standings, players, and deck data from the current event will be removed. Linked feature match pairings from Melee will also be cleared.',
			description: 'This destructive reset cannot be undone.',
			confirmLabel: meleeWillBeDisabled ? 'Disable and Clear Data' : 'Change Event and Clear Data',
			confirmColor: 'error',
			icon: 'i-lucide-triangle-alert',
			iconColor: 'text-error',
		}).result;

		if (!confirmed) {
			return;
		}
	}

	await runRequest(
		async () => {
			const updatedEvent = await eventRepo.updateMeleeConfig(props.eventId, {
				meleeEnabled: formData.value.meleeEnabled,
				meleeEventId: formData.value.meleeEventId || null,
				meleeClientId: formData.value.meleeClientId || null,
				// Only send meleeClientSecret if the user typed a new value.
				// Omitting it tells the server to preserve the existing secret.
				...(formData.value.meleeClientSecret
					? { meleeClientSecret: formData.value.meleeClientSecret }
					: {}),
			});
			eventStore.setEvent(updatedEvent);

			let localRefreshFailed = false;
			if (meleeDataWillReset) {
				try {
					await refreshAfterMeleeReset(props.eventId);
				}
				catch {
					// Persistence has committed. Do not report the configuration request as
					// failed (which would encourage a destructive retry) just because a
					// follow-up projection reload failed in this browser.
					localRefreshFailed = true;
					console.warn(`[Melee] Local data refresh failed after configuration reset for event ${props.eventId}`);
				}
			}
			// Reset secret field and update original so isDirty resets correctly
			formData.value.meleeClientSecret = '';
			updateOriginal({ ...formData.value });
			credentialsConfigured.value = updatedEvent.meleeConfigured;
			return { localRefreshFailed };
		},
		{
			loadingRef: loading,
			success: ({ localRefreshFailed }) => localRefreshFailed
				? {
						title: 'Melee configuration updated',
						description: 'Local synced data could not be refreshed. Reload this page before continuing.',
						color: 'warning',
					}
				: {
						title: 'Success',
						description: 'Melee configuration updated',
						color: 'success',
					},
			error: {
				title: 'Error',
				description: 'Failed to update Melee configuration',
				color: 'error',
			},
		},
	);
}

onMounted(fetchConfig);
</script>

<template>
	<UForm v-if="!fetching && !fetchError" :state="formData" @submit="submit">
		<UCard variant="subtle">
			<div class="w-full flex flex-col gap-4">
				<UFormField
					name="meleeEnabled"
					label="Melee.gg Integration"
					description="Enable Melee.gg integration to sync players and standings."
					class="flex max-sm:flex-col justify-between gap-4 items-center"
				>
					<USwitch v-model="formData.meleeEnabled" />
				</UFormField>

				<template v-if="formData.meleeEnabled">
					<USeparator />

					<UFormField
						name="meleeEventId"
						label="Melee.gg Event ID"
						description="Your tournament ID from Melee.gg"
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInput v-model="formData.meleeEventId" class="w-64" placeholder="e.g., 12345" />
					</UFormField>

					<USeparator />

					<UFormField
						name="meleeClientId"
						label="Client ID"
						description="Your Melee.gg API client ID"
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInput v-model="formData.meleeClientId" class="w-64" />
					</UFormField>

					<USeparator />

					<UFormField
						name="meleeClientSecret"
						label="Client Secret"
						:description="credentialsConfigured ? 'Credentials configured. Leave blank to keep the current secret.' : 'Your Melee.gg API client secret'"
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInput
							v-model="formData.meleeClientSecret"
							type="password"
							class="w-64"
							:placeholder="credentialsConfigured ? '••••••••' : 'Enter secret'"
						/>
					</UFormField>
				</template>
			</div>
			<template #footer>
				<EventConfigFormFooter :is-dirty="isDirty" :loading="loading" @reset="reset" />
			</template>
		</UCard>
	</UForm>
	<UCard v-else-if="fetching" variant="subtle">
		<div class="flex justify-center py-8">
			<UIcon name="i-lucide-loader-circle" class="animate-spin text-2xl" />
		</div>
	</UCard>
	<UCard v-else variant="subtle">
		<div class="text-center text-error py-4">
			{{ fetchError }}
		</div>
	</UCard>
</template>
