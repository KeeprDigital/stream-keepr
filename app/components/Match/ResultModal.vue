<script setup lang="ts">
import type { Match } from '~/types';

const props = defineProps<{
	match: Match;
	bestOf: number;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
	(e: 'saved'): void;
}>();

const eventStore = useEventStore();
const matchStore = useMatchStore();
const { runRequest } = useRequestFeedback();

const saving = ref(false);
const formId = `match-result-${props.match.id}-form`;

const formData = ref({
	player1GameWins: props.match.player1GameWins ?? 0,
	player2GameWins: props.match.player2GameWins ?? 0,
	gameDraws: props.match.gameDraws ?? 0,
});

const totalGames = computed(() => formData.value.player1GameWins + formData.value.player2GameWins + formData.value.gameDraws);
const isValid = computed(() => totalGames.value > 0 && totalGames.value <= props.bestOf);
const resultString = computed(() => `${formData.value.player1GameWins}-${formData.value.player2GameWins}${formData.value.gameDraws > 0 ? `-${formData.value.gameDraws}` : ''}`);

async function handleSave() {
	if (!eventStore.eventId || !isValid.value) {
		return;
	}

	await runRequest(
		() => matchStore.updateMatch(eventStore.eventId!, props.match.id, {
			hasResult: true,
			player1GameWins: formData.value.player1GameWins,
			player2GameWins: formData.value.player2GameWins,
			gameDraws: formData.value.gameDraws,
			resultString: resultString.value,
		}),
		{
			loadingRef: saving,
			success: false,
			error: { title: 'Failed to Save Result', color: 'error' },
			onSuccess: () => {
				emit('saved');
				emit('close');
			},
		},
	);
}

async function handleClear() {
	if (!eventStore.eventId) {
		return;
	}

	await runRequest(
		() => matchStore.updateMatch(eventStore.eventId!, props.match.id, {
			hasResult: false,
			player1GameWins: null,
			player2GameWins: null,
			gameDraws: null,
			resultString: null,
		}),
		{
			loadingRef: saving,
			success: false,
			error: { title: 'Failed to Clear Result', color: 'error' },
			onSuccess: () => {
				emit('saved');
				emit('close');
			},
		},
	);
}

function handleClose() {
	emit('close');
}
</script>

<template>
	<UModal
		open
		title="Match Result"
		:close="{ onClick: handleClose }"
		@update:open="value => !value && handleClose()"
	>
		<template #body>
			<UForm
				:id="formId"
				:state="formData"
				class="flex flex-col gap-4"
				@submit="handleSave"
			>
				<UCard variant="subtle" :ui="{ body: 'text-sm' }">
					<div class="font-medium">
						{{ match.player1Data?.name || 'Player 1' }} vs {{ match.player2Data?.name || 'Player 2' }}
					</div>
					<div class="mt-1 text-muted">
						Enter the final game score summary for this match. Drawn or unfinished finals like 1-1 and 0-0-3 are allowed.
					</div>
				</UCard>

				<div class="grid gap-4 sm:grid-cols-3">
					<UFormField :label="match.player1Data?.name || 'Player 1'">
						<UInputNumber
							v-model="formData.player1GameWins"
							:min="0"
							:max="bestOf"
							class="w-full"
						/>
					</UFormField>
					<UFormField :label="match.player2Data?.name || 'Player 2'">
						<UInputNumber
							v-model="formData.player2GameWins"
							:min="0"
							:max="bestOf"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Game Draws">
						<UInputNumber
							v-model="formData.gameDraws"
							:min="0"
							:max="bestOf"
							class="w-full"
						/>
					</UFormField>
				</div>

				<UAlert
					:color="isValid ? 'success' : 'warning'"
					:icon="isValid ? 'i-lucide-check-circle-2' : 'i-lucide-circle-alert'"
					:title="isValid ? `Final score: ${resultString}` : 'Score needs attention'"
					:description="isValid ? `This result uses ${totalGames} of ${bestOf} available games.` : `Enter at least one game result and keep the total at or below best-of-${bestOf}.`"
				/>
			</UForm>
		</template>

		<template #footer>
			<div class="flex justify-between items-center gap-4 w-full">
				<UButton
					color="error"
					variant="ghost"
					:disabled="!match.hasResult || saving"
					@click="handleClear"
				>
					Clear Result
				</UButton>
				<div class="flex items-center gap-2">
					<UButton color="neutral" variant="ghost" @click="handleClose">
						Cancel
					</UButton>
					<UButton
						type="submit"
						:form="formId"
						color="primary"
						:loading="saving"
						:disabled="!isValid"
					>
						Save Result
					</UButton>
				</div>
			</div>
		</template>
	</UModal>
</template>
