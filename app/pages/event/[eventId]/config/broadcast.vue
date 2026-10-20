<script setup lang="ts">
import type { SocialProfiles } from '~~/shared/socialProfiles';
import { applyTalentUpdates } from '~/modules/event-data/talentUpdates';

const eventStore = useEventStore();
const { runRequest } = useRequestFeedback();
const { handleSubmit } = useEventConfigSubmit();

const event = computed(() => eventStore.event!);
const loading = computed(() => eventStore.loading);

const talentsRef = useTemplateRef<{ resetForm: () => void }>('talents');

async function handleSaveTalents(newTalents: { id?: number; name: string; socialProfiles: SocialProfiles }[]) {
	const currentEvent = eventStore.event;
	if (!currentEvent)
		return;

	await runRequest(async () => {
		try {
			await applyTalentUpdates({
				currentTalents: currentEvent.talents || [],
				requestedTalents: newTalents,
				removeTalent: talentId => eventStore.removeTalent(talentId),
				addTalent: input => eventStore.addTalent(input),
				updateTalent: (talentId, input) => eventStore.updateTalent(talentId, input),
			});
		}
		finally {
			// Reset to the event once the mutations settle, failed or not. The card
			// merges each landed Talent in beside the row with no id that asked for
			// it (#612), so a staged list left after a failure would add it again
			// on retry.
			await nextTick();
			talentsRef.value?.resetForm();
		}

		return true;
	}, {
		success: {
			title: 'Success',
			description: 'Talents updated successfully',
			color: 'success',
		},
		error: {
			title: 'Error',
			description: 'Failed to update talents',
			color: 'error',
		},
		onFailure: ({ error }) => {
			console.error('Failed to update talents:', error);
		},
	});
}
</script>

<template>
	<div class="flex flex-col gap-6">
		<EventConfigBroadcastSettings :event="event" :loading="loading" @submit="handleSubmit" />
		<EventBroadcastDeckListLibrary :event="event" />

		<h2 class="text-xl font-semibold">
			Talents
		</h2>
		<EventConfigTalents
			ref="talents"
			:talents="event.talents"
			:loading="loading"
			@submit="handleSaveTalents"
		/>
	</div>
</template>
