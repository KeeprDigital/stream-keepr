<script setup lang="ts">
import type { Game } from '~~/shared/types/enums';
import type { MtgPlayerGameData, OpPlayerGameData } from '~~/shared/types/game';
import type { InputMenuItem } from '#ui/types';
import type { Player, PlayerData } from '~/types';
import { getMtgGameData, getOpGameData } from '~~/shared/utils/gameData';

const props = defineProps<{
	displayMode: PlayerDisplayMode;
	game: Game;
	pronounsEnabled?: boolean;
	standingsEnabled?: boolean;
	lgsEnabled?: boolean;
	players?: Player[];
	playerId?: number | null;
	formId: string;
}>();

const emit = defineEmits<{
	'update:playerId': [value: number | null];
	'submit': [];
}>();

const player = defineModel<PlayerData>({
	required: true,
});

// ──────────────── Player Picker ────────────────

const hasPlayers = computed(() => (props.players?.length ?? 0) > 0);

const playerItems = computed<(InputMenuItem & { id: number })[]>(() => {
	if (!props.players?.length)
		return [];
	return props.players.map(p => ({
		label: p.name,
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
				pronouns: selected.pronouns ?? undefined,
				externalId: selected.externalId ?? undefined,
				externalSource: selected.externalSource ?? undefined,
				wins: selected.wins ?? undefined,
				losses: selected.losses ?? undefined,
				draws: selected.draws ?? undefined,
				position: selected.position ?? undefined,
				points: selected.points ?? undefined,
				lgs: selected.lgs ?? undefined,
				gameData: selected.gameData ?? undefined,
			};
		}
	}
}

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
				:model-value="pickerValue"
				:items="playerItems"
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
		<FeatureMatchSetupMtgPlayerFields v-if="props.game === 'mtg'" v-model="mtgGameData" />
		<FeatureMatchSetupOpPlayerFields v-if="props.game === 'op'" v-model="opGameData" />

		<USeparator v-if="props.standingsEnabled || props.lgsEnabled" />

		<!-- Record -->
		<template v-if="props.standingsEnabled">
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
