<script setup lang="ts">
import type { MtgPlayerGameData, OpPlayerGameData } from '~~/shared/types/game';
import type { Player, PlayerData } from '~/types';
import { LazyUIConfirmDeleteModal } from '#components';
import { toCreatePlayerInput, toPlayerData } from '~/types/player';

const props = defineProps<{
	player: Player;
	game: 'mtg' | 'op';
	pronounsEnabled?: boolean;
	lgsEnabled?: boolean;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
	(e: 'updated'): void;
	(e: 'deleted'): void;
}>();

const playerStore = usePlayerStore();
const eventStore = useEventStore();
const overlay = useOverlay();
const { runRequest } = useRequestFeedback();

// ── Form State ──

function playerToFormData(player: Player): PlayerData {
	return toPlayerData({
		name: player.name,
		pronouns: player.pronouns,
		lgs: player.lgs,
		wins: player.wins,
		losses: player.losses,
		draws: player.draws,
		position: player.position,
		points: player.points,
		externalId: player.externalId,
		externalSource: player.externalSource,
		gameData: player.gameData as MtgPlayerGameData | OpPlayerGameData | null,
	});
}

const { formData, isDirty, reset } = useForm<PlayerData>({
	initialData: playerToFormData(props.player),
});

// Game-specific data (extracted from player's gameData)
const mtgGameData = ref<MtgPlayerGameData>(
	(props.player.gameData as MtgPlayerGameData)?.type === 'mtg'
		? { ...(props.player.gameData as MtgPlayerGameData) }
		: { type: 'mtg', deckName: null, deckColors: null },
);

const opGameData = ref<OpPlayerGameData>(
	(props.player.gameData as OpPlayerGameData)?.type === 'op'
		? { ...(props.player.gameData as OpPlayerGameData) }
		: { type: 'op', leader: null },
);

// ── Save ──

const saving = ref(false);
const formId = `edit-player-${props.player.id}-form`;

async function handleSave() {
	const name = formData.value.name?.trim();
	if (!name || !eventStore.eventId)
		return;

	const input = toCreatePlayerInput({
		...formData.value,
		name,
		gameData: props.game === 'mtg' ? mtgGameData.value : opGameData.value,
	});

	await runRequest(
		() => playerStore.updatePlayer(eventStore.eventId!, props.player.id, input),
		{
			loadingRef: saving,
			success: { title: 'Player updated', color: 'success' },
			error: { title: 'Failed to update player', color: 'error' },
			onSuccess: () => {
				emit('updated');
				emit('close');
			},
		},
	);
}

// ── Delete ──

const deleting = ref(false);

async function handleDelete() {
	if (!eventStore.eventId)
		return;

	const deleteModal = overlay.create(LazyUIConfirmDeleteModal);
	const confirmed = await deleteModal.open({
		title: 'Delete Player',
		itemName: props.player.name,
	}).result;

	if (!confirmed)
		return;

	await runRequest(
		() => playerStore.removePlayer(eventStore.eventId!, props.player.id),
		{
			loadingRef: deleting,
			success: { title: 'Player deleted', color: 'success' },
			error: { title: 'Failed to delete player', color: 'error' },
			onSuccess: () => {
				emit('deleted');
				emit('close');
			},
		},
	);
}

// ── Close ──

function handleCancel() {
	emit('close');
}

const isValid = computed(() => (formData.value.name?.trim().length ?? 0) > 0);
</script>

<template>
	<UModal
		open
		:dismissible="false"
		title="Edit Player"
		:close="{ onClick: handleCancel }"
	>
		<template #body>
			<UForm
				:id="formId"
				:state="formData"
				class="flex flex-col gap-4"
				@submit="handleSave"
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
			<div class="flex justify-between items-center gap-4 w-full">
				<UButton
					label="Reset"
					color="error"
					variant="ghost"
					:disabled="!isDirty"
					@click="reset"
				/>
				<div class="flex items-center gap-2">
					<UButton
						type="submit"
						:form="formId"
						label="Save"
						color="primary"
						:loading="saving"
						:disabled="!isDirty || !isValid"
					/>
					<UDropdownMenu
						:items="[[{
							label: 'Delete Player',
							icon: 'i-lucide-trash-2',
							color: 'error' as const,
							loading: deleting,
							onSelect: handleDelete,
						}]]"
						:content="{ align: 'end' }"
					>
						<UButton
							icon="i-lucide-ellipsis-vertical"
							color="neutral"
							variant="ghost"
							aria-label="More actions"
						/>
					</UDropdownMenu>
				</div>
			</div>
		</template>
	</UModal>
</template>
