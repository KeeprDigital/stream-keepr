<script setup lang="ts">
import type { Game, PlayerSide } from '~~/shared/types/enums';
import type { MtgPlayerGameData, OpPlayerGameData } from '~~/shared/types/game';
import type { InputMenuItem } from '#ui/types';
import type { Player, PlayerData } from '~/types';
import { getMtgGameData, getOpGameData } from '~~/shared/utils/gameData';
import { playerLabel, playerMatchesSearch } from '~~/shared/utils/playerName';

const props = defineProps<{
	displayMode: PlayerDisplayMode;
	game: Game;
	pronounsEnabled?: boolean;
	standingsEnabled?: boolean;
	lgsEnabled?: boolean;
	players?: Player[];
	playerId?: number | null;
	formId: string;
	/**
	 * A Commander Event's Seat (ADR-0086): the Event has no Players, so the Seat
	 * is typed, and it holds Commanders in place of a deck name and a record.
	 */
	commanders?: boolean;
	/** The Slot and its side this form edits, for the side's Feature Match Deck List. */
	slotId?: number;
	side?: PlayerSide;
	/** While the setup form holds unsaved changes, a Deck List waits for them. */
	deckListLocked?: boolean;
}>();

const emit = defineEmits<{
	'update:playerId': [value: number | null];
	'submit': [];
}>();

const player = defineModel<PlayerData>({
	required: true,
});

// ──────────────── Player Picker ────────────────

const hasPlayers = computed(() => !props.commanders && (props.players?.length ?? 0) > 0);

// The picker finds a Player by name, Nickname or Bandai member number (ADR-0074).
const searchTerm = ref('');

const playerItems = computed<(InputMenuItem & { id: number })[]>(() => {
	if (!props.players?.length)
		return [];
	return props.players
		.filter(p => playerMatchesSearch(p, searchTerm.value))
		.map(p => ({
			label: playerLabel(p),
			id: p.id,
		}));
});

const pickerValue = computed(() => props.playerId ?? undefined);

function onPlayerSelected(value: number | null) {
	emit('update:playerId', value);

	if (value) {
		const selected = props.players?.find(p => p.id === value);
		if (selected) {
			player.value = {
				name: selected.name,
				nickname: selected.nickname ?? undefined,
				pronouns: selected.pronouns ?? undefined,
				externalId: selected.externalId ?? undefined,
				externalSource: selected.externalSource ?? undefined,
				wins: selected.wins ?? undefined,
				losses: selected.losses ?? undefined,
				draws: selected.draws ?? undefined,
				position: selected.position ?? undefined,
				points: selected.points ?? undefined,
				lgs: selected.lgs ?? undefined,
				// A linked One Piece side shows the Player's Deck List and its Leader,
				// which the save fills in, in place of the side's own (ADR-0074).
				gameData: props.game === 'op'
					? { type: 'op', leader: null, deckList: getOpGameData(selected.gameData).deckList ?? null }
					: selected.gameData ?? undefined,
			};
		}
	}
}

/** A typed Seat has no record: nothing on a Commander Event produces one. */
const showsRecord = computed(() => props.standingsEnabled && !props.commanders);

// ──────────────── Game-Specific Data ────────────────

const mtgGameData = computed({
	get: () => getMtgGameData(player.value?.gameData),
	set: (value: MtgPlayerGameData) => {
		player.value.gameData = value;
	},
});

const opGameData = computed({
	get: () => getOpGameData(player.value?.gameData),
	set: (value: OpPlayerGameData) => {
		player.value.gameData = value;
	},
});

// ──────────────── Linked One Piece Side ────────────────

/**
 * A One Piece side linked to a Player shows that Player's Leader and Deck List
 * and holds none of its own (ADR-0074), so it offers the Player's Deck List
 * editor in place of its own paste and Leader picker. The edit is a Player
 * write, which reaches this side and every other Slot showing the Player.
 */
const linkedPlayer = computed(() => props.game === 'op' && props.playerId != null
	? props.players?.find(p => p.id === props.playerId) ?? null
	: null);
const linkedDeckList = computed(() => opGameData.value.deckList ?? null);
const editingPlayerDeckList = ref(false);
</script>

<template>
	<UForm
		:id="formId"
		:state="player"
		class="w-full flex flex-col gap-4"
		@submit="emit('submit')"
	>
		<!-- Player Picker -->
		<UFormField v-if="hasPlayers" label="Player" name="player">
			<UInputMenu
				v-model:search-term="searchTerm"
				:model-value="pickerValue"
				:items="playerItems"
				ignore-filter
				value-key="id"
				icon="i-lucide-user-search"
				placeholder="Link player..."
				class="w-full"
				clear
				@update:model-value="onPlayerSelected"
			/>
		</UFormField>

		<!-- Identity -->
		<div class="flex gap-4">
			<UFormField label="Name" name="name" :class="props.pronounsEnabled ? 'flex-2' : 'flex-1'">
				<UInput
					v-model="player.name"
					:placeholder="player.nickname"
					class="w-full"
				/>
			</UFormField>
			<UFormField
				v-if="props.pronounsEnabled"
				label="Pronouns"
				name="pronouns"
				class="flex-1"
			>
				<UInput
					v-model="player.pronouns"
					class="w-full"
				/>
			</UFormField>
		</div>

		<USeparator />

		<!-- Game-Specific Fields -->
		<FeatureMatchSetupCommanderFields v-if="props.commanders" v-model="mtgGameData" />
		<FeatureMatchSetupMtgPlayerFields v-else-if="props.game === 'mtg'" v-model="mtgGameData" />
		<UFormField
			v-if="linkedPlayer"
			label="Leader and Deck List"
			name="deckList"
			description="The linked Player's."
			class="w-full"
		>
			<div
				class="flex items-center gap-3 rounded-md border border-default p-2"
				data-linked-deck-list
				:data-mainboard-count="linkedDeckList?.mainboardCount"
			>
				<img
					v-if="opGameData.leader"
					:src="opGameData.leader.imageUrl"
					:alt="opGameData.leader.name"
					class="h-14 rounded-sm"
					style="aspect-ratio: 600 / 838"
					loading="lazy"
				>
				<div class="min-w-0 flex-1" data-leader>
					<p class="truncate font-medium">
						{{ opGameData.leader?.name ?? linkedDeckList?.leaderNumber ?? 'No Leader' }}
					</p>
					<p class="flex items-center gap-2 text-sm text-muted">
						{{ linkedDeckList ? `${linkedDeckList.mainboardCount} Mainboard cards` : 'No Deck List' }}
						<OpColorDisplay v-if="opGameData.leader" :colors="opGameData.leader.colors" size="sm" />
					</p>
				</div>
				<UButton
					label="Edit"
					icon="i-lucide-pencil"
					color="neutral"
					variant="outline"
					size="sm"
					aria-label="Edit the Player's Deck List"
					@click="editingPlayerDeckList = true"
				/>
			</div>
		</UFormField>
		<template v-else-if="props.game === 'op'">
			<FeatureMatchSetupOpPlayerFields v-model="opGameData" />
			<FeatureMatchSetupDeckListField
				v-if="props.slotId && props.side"
				:slot-id="props.slotId"
				:side="props.side"
				:deck-list="opGameData.featureMatchDeckList ?? null"
				:locked="props.deckListLocked ?? false"
			/>
		</template>
		<PlayerOpDeckListModal
			v-if="linkedPlayer && editingPlayerDeckList"
			:player="linkedPlayer"
			@close="editingPlayerDeckList = false"
		/>

		<USeparator v-if="showsRecord || props.lgsEnabled" />

		<!-- Record -->
		<template v-if="showsRecord">
			<div v-if="props.displayMode === 'score'" class="flex gap-4">
				<UFormField label="Wins" name="wins" class="w-full">
					<UInputNumber
						v-model="player.wins"
						class="w-full"
						:increment="false"
						:decrement="false"
					/>
				</UFormField>
				<UFormField label="Losses" name="losses" class="w-full">
					<UInputNumber
						v-model="player.losses"
						class="w-full"
						:decrement="false"
						:increment="false"
					/>
				</UFormField>
				<UFormField label="Draws" name="draws" class="w-full">
					<UInputNumber
						v-model="player.draws"
						class="w-full"
						:decrement="false"
						:increment="false"
					/>
				</UFormField>
			</div>
			<UFormField
				v-if="props.displayMode === 'position'"
				label="Position"
				name="position"
				class="w-full"
			>
				<UInputNumber
					v-model="player.position"
					class="w-full"
					:min="1"
					:decrement="false"
					:increment="false"
				/>
			</UFormField>
		</template>
		<UFormField
			v-if="props.lgsEnabled"
			label="LGS"
			name="lgs"
			class="w-full"
		>
			<UInput
				v-model="player.lgs"
				class="w-full"
			/>
		</UFormField>
	</UForm>
</template>
