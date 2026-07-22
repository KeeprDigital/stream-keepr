<script setup lang="ts">
import type { Game } from '~~/shared/types/enums';
import type { FeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { getGameDefaults } from '~~/shared/config/games';
import { fromFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';

const emit = defineEmits<{
	(e: 'close'): void;
}>();

const eventStore = useEventStore();
const router = useRouter();
const { runRequest } = useRequestFeedback();

const isCreating = ref(false);
const formId = 'create-event-form';

const formData = ref({
	name: '',
	game: 'mtg' as Game,
	featureMatchOrientation: 'horizontal' as const,
	...getGameDefaults('mtg'),
});

// Seed defaults when game changes
watch(() => formData.value.game, (game) => {
	Object.assign(formData.value, getGameDefaults(game));
});

async function submit() {
	if (!formData.value.name.trim()) {
		return;
	}

	const { name, game, featureMatchOrientation, ...matchDefaults } = formData.value;
	const payload = {
		name,
		game,
		featureMatchOrientation,
		...fromFeatureMatchDefaults(matchDefaults as Partial<FeatureMatchDefaults>),
	};

	await runRequest(
		async () => {
			const newEvent = await eventStore.createEvent(payload);
			if (!newEvent)
				throw new Error('Failed to create event');
			return newEvent;
		},
		{
			loadingRef: isCreating,
			success: false,
			error: { title: 'Failed to create event', color: 'error' },
			onSuccess: async (newEvent) => {
				emit('close');
				await router.push(`/event/${newEvent.id}`);
			},
		},
	);
}
</script>

<template>
	<UModal
		title="Create Event"
		:close="{ onClick: () => emit('close') }"
		:ui="{ footer: 'justify-end' }"
		:dismissible="false"
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
						label="Event Name"
						description="The name of the event."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInput v-model="formData.name" class="w-64" />
					</UFormField>
					<USeparator />
					<UFormField
						name="game"
						label="Game"
						description="The game being played."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<USelect v-model="formData.game" class="w-64" :items="GAME_SELECT_OPTIONS" />
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
				:loading="isCreating"
				color="primary"
			>
				Create
			</UButton>
		</template>
	</UModal>
</template>
