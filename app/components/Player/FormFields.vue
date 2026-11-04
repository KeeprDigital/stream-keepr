<script setup lang="ts">
import type { MtgPlayerGameData } from '~~/shared/types/game';
import type { PlayerData } from '~/types';

defineProps<{
	game: 'mtg' | 'op';
	pronounsEnabled?: boolean;
	lgsEnabled?: boolean;
	/** The TCG+ Import owns an imported Player's Nickname, so it is not edited here (ADR-0074). */
	nicknameImported?: boolean;
}>();

const formData = defineModel<PlayerData>({ required: true });
const mtgGameData = defineModel<MtgPlayerGameData>('mtgGameData', { required: true });
</script>

<template>
	<UFormField
		label="Name"
		:required="game !== 'op'"
		:hint="game === 'op' ? 'Shown instead of the Nickname' : undefined"
	>
		<UInput
			v-model="formData.name"
			:placeholder="game === 'op' ? formData.nickname || 'Player name' : 'Player name'"
			autofocus
			class="w-full"
		/>
	</UFormField>

	<UFormField
		v-if="game === 'op'"
		label="Nickname"
		:help="nicknameImported ? 'From the TCG+ Import' : undefined"
	>
		<UInput
			v-model="formData.nickname"
			placeholder="Bandai TCG+ Nickname"
			:disabled="nicknameImported"
			class="w-full"
		/>
	</UFormField>

	<UFormField v-if="pronounsEnabled" label="Pronouns">
		<UInput
			v-model="formData.pronouns"
			placeholder="e.g. he/him, she/her, they/them"
			class="w-full"
		/>
	</UFormField>

	<UFormField v-if="lgsEnabled" label="LGS">
		<UInput
			v-model="formData.lgs"
			placeholder="Local game store"
			class="w-full"
		/>
	</UFormField>

	<!-- Game-specific fields. A One Piece Player's Leader is their Deck List's, edited with it (ADR-0074). -->
	<FeatureMatchSetupMtgPlayerFields v-if="game === 'mtg'" v-model="mtgGameData" />
</template>
