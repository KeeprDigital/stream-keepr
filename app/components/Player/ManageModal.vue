<script setup lang="ts">
import type { MtgPlayerGameData, OpPlayerGameData } from '~~/shared/types/game';
import type { Player, PlayerData, UpdatePlayerInput } from '~/types';
import { playerLabel, unshownPlayerReason } from '~~/shared/utils/playerName';
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
		nickname: player.nickname,
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

function playerToGameDataForm(player: Player) {
	return {
		mtg: (player.gameData as MtgPlayerGameData)?.type === 'mtg'
			? { ...(player.gameData as MtgPlayerGameData) }
			: { type: 'mtg', deckName: null, deckColors: null } as MtgPlayerGameData,
	};
}

const saving = ref(false);

// The Player as the store holds them now: a Melee Sync or a colleague's edit
// can change them under the open modal, and `props.player` is as it was opened.
const heldPlayer = computed(() => playerStore.players.find(held => held.id === props.player.id) ?? props.player);

// The forms' baselines follow the held Player, so a field the operator left
// alone is neither shown nor saved stale. Not through this modal's own save:
// merging its optimistic value and then a refusal's rollback would take the edit back.
const playerBaseline = shallowRef(playerToFormData(heldPlayer.value));
const gameDataBaseline = shallowRef(playerToGameDataForm(heldPlayer.value));
watchEffect(() => {
	if (saving.value)
		return;
	playerBaseline.value = playerToFormData(heldPlayer.value);
	gameDataBaseline.value = playerToGameDataForm(heldPlayer.value);
});

const {
	formData,
	isDirty: isPlayerDirty,
	reset: resetPlayer,
	getChanges: getPlayerChanges,
	runSave: runPlayerSave,
} = useForm<PlayerData>({
	initialData: playerBaseline,
});

// Game-specific data (extracted from player's gameData), tracked as a form of
// its own so a deck-only edit counts as a change.
const {
	formData: gameDataForm,
	isDirty: isGameDataDirty,
	reset: resetGameData,
	runSave: runGameDataSave,
} = useForm({
	initialData: gameDataBaseline,
});

const mtgGameData = computed({
	get: () => gameDataForm.value.mtg,
	set: (value: MtgPlayerGameData) => {
		gameDataForm.value.mtg = value;
	},
});

const isDirty = computed(() => isPlayerDirty.value || isGameDataDirty.value);

function reset() {
	resetPlayer();
	resetGameData();
}

/** Set once a save or delete lands: nothing is left to lose while the modal closes. */
const settled = ref(false);
const { confirmDiscard } = useModalUnsavedChanges(computed(() => isDirty.value && !settled.value));

// ── Save ──

const formId = `edit-player-${props.player.id}-form`;

// The server's rule: a One Piece Card Game Player may go by their Nickname alone (ADR-0074).
const isValid = computed(() => unshownPlayerReason(props.game, formData.value) === null);

// Only what the operator changed is written, through `runSave` (ADR-0044): a
// field left alone keeps whatever the Player holds by the time the save lands.
async function handleSave() {
	if (!isValid.value || !eventStore.eventId)
		return;

	const changes = getPlayerChanges() as Partial<PlayerData>;
	const input: UpdatePlayerInput = {
		...toCreatePlayerInput(changes as PlayerData),
		...('name' in changes && { name: changes.name?.trim() ?? '' }),
		// A One Piece Player's game data is their Deck List's, written by the OP Deck List write (ADR-0074).
		...(props.game === 'mtg' && isGameDataDirty.value && { gameData: mtgGameData.value }),
	};
	if (Object.keys(input).length === 0)
		return;

	await runPlayerSave(() => runGameDataSave(() => runRequest(
		() => playerStore.updatePlayer(eventStore.eventId!, props.player.id, input),
		{
			loadingRef: saving,
			success: { title: 'Player updated', color: 'success' },
			error: { title: 'Failed to update player', color: 'error' },
			onSuccess: () => {
				settled.value = true;
				emit('updated');
				emit('close');
			},
		},
	)));
}

// ── Delete ──

const deleting = ref(false);

async function handleDelete() {
	if (!eventStore.eventId)
		return;

	const deleteModal = overlay.create(LazyUIConfirmDeleteModal);
	const confirmed = await deleteModal.open({
		title: 'Delete Player',
		itemName: playerLabel(props.player),
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
				settled.value = true;
				emit('deleted');
				emit('close');
			},
		},
	);
}

// ── Close ──

async function handleCancel() {
	if (await confirmDiscard())
		emit('close');
}
</script>

<template>
	<UModal
		open
		:dismissible="false"
		title="Edit Player"
		:close="false"
	>
		<!-- The built-in close sits inside DialogClose and closes whatever its
		onClick does, so this one asks first while an edit is unsaved. -->
		<template #actions>
			<UButton
				icon="i-lucide-x"
				color="neutral"
				variant="ghost"
				aria-label="Close"
				class="absolute top-4 end-4"
				@click="handleCancel"
			/>
		</template>

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
					:game="game"
					:pronouns-enabled="pronounsEnabled"
					:lgs-enabled="lgsEnabled"
					:nickname-imported="player.externalSource === 'tcgplus'"
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
