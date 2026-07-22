<script setup lang="ts">
import type { MtgPlayerGameData, OpPlayerGameData } from '~~/shared/types/game';
import type { PlayerData } from '~/types';
import { DEFAULT_PLAYER_DATA, toCreatePlayerInput } from '~/types/player';

const props = defineProps<{
	game: 'mtg' | 'op';
	pronounsEnabled?: boolean;
	lgsEnabled?: boolean;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
	(e: 'created'): void;
}>();

const playerStore = usePlayerStore();
const eventStore = useEventStore();
const { runRequest } = useRequestFeedback();

const formData = ref<PlayerData>({ ...DEFAULT_PLAYER_DATA });
const saving = ref(false);
const formId = 'create-player-form';

// Game-specific data
const mtgGameData = ref<MtgPlayerGameData>({ type: 'mtg', deckName: null, deckColors: null });
const opGameData = ref<OpPlayerGameData>({ type: 'op', leader: null });

async function handleSubmit() {
	const name = formData.value.name?.trim();
	if (!name || !eventStore.eventId)
		return;

	const input = toCreatePlayerInput({
		...formData.value,
		name,
		gameData: props.game === 'mtg' ? mtgGameData.value : opGameData.value,
	});

	await runRequest(
		() => playerStore.createPlayer(eventStore.eventId!, input),
		{
			loadingRef: saving,
			success: false,
			error: { title: 'Failed to create player', color: 'error' },
			onSuccess: () => {
				emit('created');
				emit('close');
			},
		},
	);
}

function handleCancel() {
	emit('close');
}

const isValid = computed(() => {
	return (formData.value.name?.trim().length ?? 0) > 0;
});
</script>

<template>
	<UModal
		open
		title="Create Player"
		:close="{ onClick: handleCancel }"
		:ui="{ footer: 'justify-end' }"
		@update:open="val => !val && handleCancel()"
	>
		<template #body>
			<UForm
				:id="formId"
				:state="formData"
				class="flex flex-col gap-4"
				@submit="handleSubmit"
			>
				<PlayerFormFields
					v-model="formData"
					v-model:mtg-game-data="mtgGameData"
					v-model:op-game-data="opGameData"
					:game="game"
					:pronouns-enabled="pronounsEnabled"
					:lgs-enabled="lgsEnabled"
				/>
			</UForm>
		</template>

		<template #footer>
			<UButton
				variant="ghost"
				color="neutral"
				label="Cancel"
				@click="handleCancel"
			/>
			<UButton
				type="submit"
				:form="formId"
				color="primary"
				label="Create Player"
				:loading="saving"
				:disabled="!isValid"
			/>
		</template>
	</UModal>
</template>
