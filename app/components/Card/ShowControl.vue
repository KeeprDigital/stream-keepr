<script lang="ts" setup>
/**
 * Show or Replace the previewed card on the selected Card Spotlight Screen, with
 * the auto-show switch and the Event's Card Timeout beside it. Either Card Game.
 */
const props = defineProps<{
	/** A card is on screen, so showing replaces it. */
	replacing: boolean;
	/** The previewed card is the one on screen already. */
	matches: boolean;
}>();

const emit = defineEmits<{
	(e: 'show'): void;
}>();

const cardStore = useCardStore();
const eventStore = useEventStore();

const canShow = computed(() => cardStore.activeScreenId !== null);
const timeoutDraft = ref(eventStore.event?.cardTimeout ?? 0);

watch(() => eventStore.event?.cardTimeout, (value) => {
	timeoutDraft.value = value ?? 0;
});

const timeoutLabel = computed(() => {
	const seconds = eventStore.event?.cardTimeout ?? 0;
	return seconds > 0
		? `${seconds}s timeout`
		: 'No timeout';
});

async function saveTimeout() {
	const cardTimeout = Math.max(0, timeoutDraft.value ?? 0);
	timeoutDraft.value = cardTimeout;
	await eventStore.updateEvent({ cardTimeout });
}
</script>

<template>
	<UFieldGroup class="w-full">
		<UButton
			v-if="props.replacing"
			variant="subtle"
			icon="i-lucide-replace"
			class="flex-1 justify-center"
			color="warning"
			:disabled="props.matches || !canShow"
			@click="emit('show')"
		>
			Replace
		</UButton>
		<UButton
			v-else
			variant="subtle"
			icon="i-lucide-eye"
			class="flex-1 justify-center"
			:disabled="!canShow"
			@click="emit('show')"
		>
			Show
		</UButton>
		<UPopover arrow :content="{ align: 'end', side: 'bottom' }">
			<UButton
				variant="subtle"
				:color="props.replacing ? 'warning' : 'primary'"
				icon="i-lucide-chevron-down"
				:disabled="!canShow"
				aria-label="Show options"
			/>

			<template #content>
				<div class="w-64 space-y-3 p-3">
					<label class="flex items-center justify-between gap-3 text-sm">
						<span>Auto-show selections</span>
						<USwitch v-model="cardStore.autoShowSelectedCard" size="sm" />
					</label>

					<USeparator />

					<UFormField label="Timeout" :description="timeoutLabel" size="sm">
						<UFieldGroup class="w-full">
							<UInputNumber
								v-model="timeoutDraft"
								:min="0"
								size="sm"
								class="flex-1"
							/>
							<UButton
								size="sm"
								variant="outline"
								:loading="eventStore.loading"
								@click="saveTimeout"
							>
								Save
							</UButton>
						</UFieldGroup>
					</UFormField>
				</div>
			</template>
		</UPopover>
	</UFieldGroup>
	<UAlert
		v-if="!canShow"
		color="warning"
		variant="subtle"
		icon="i-lucide-triangle-alert"
		title="No Card Spotlight Screen configured"
		description="Add a Screen in Card Spotlight mode to show cards."
	/>
</template>
