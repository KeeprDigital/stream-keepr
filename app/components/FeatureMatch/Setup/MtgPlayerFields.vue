<script setup lang="ts">
import type { MtgPlayerGameData } from '~~/shared/types/game';
import { mtgColorsFromString, mtgColorsToString } from '~~/shared/utils/mtgData';

const modelValue = defineModel<MtgPlayerGameData>({
	required: true,
});

const deckColorsArray = computed({
	get: () => {
		if (!modelValue.value?.deckColors) {
			return [];
		}
		return mtgColorsFromString(modelValue.value.deckColors);
	},
	set: (value: string[]) => {
		modelValue.value = {
			...modelValue.value,
			deckColors: value.length > 0 ? mtgColorsToString(value) : null,
		};
	},
});
</script>

<template>
	<div class="flex items-end gap-4">
		<UFormField label="Deck Name" name="deckName" class="flex-1">
			<UInput
				:model-value="modelValue.deckName ?? ''"
				class="w-full"
				@update:model-value="modelValue = { ...modelValue, deckName: ($event) || null }"
			/>
		</UFormField>
		<MtgManaColorPicker v-model="deckColorsArray" class="pb-1" />
	</div>
</template>
