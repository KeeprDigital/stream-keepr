<script setup lang="ts">
import type { MtgPlayerGameData, OpPlayerGameData } from '~~/shared/types/game';
import type { PlayerData } from '~/types';

defineProps<{
	game: 'mtg' | 'op';
	pronounsEnabled?: boolean;
	lgsEnabled?: boolean;
}>();

const formData = defineModel<PlayerData>({ required: true });
const mtgGameData = defineModel<MtgPlayerGameData>('mtgGameData', { required: true });
const opGameData = defineModel<OpPlayerGameData>('opGameData', { required: true });
</script>

<template>
	<UFormField label="Name" required>
		<UInput
			v-model="formData.name"
			placeholder="Player name"
			autofocus
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

	<!-- Game-specific fields -->
	<FeatureMatchSetupMtgPlayerFields v-if="game === 'mtg'" v-model="mtgGameData" />
	<FeatureMatchSetupOpPlayerFields v-if="game === 'op'" v-model="opGameData" />
</template>
