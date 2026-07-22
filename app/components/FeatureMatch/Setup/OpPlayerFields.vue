<script setup lang="ts">
import type { OpPlayerGameData } from '~~/shared/types/game';

const modelValue = defineModel<OpPlayerGameData>({
	required: true,
});
</script>

<template>
	<UFormField
		label="Leader"
		name="leader"
		description="The leader card for this deck."
		class="w-full"
	>
		<UInput
			:model-value="modelValue.leader ?? ''"
			class="w-full"
			@update:model-value="modelValue = { ...modelValue, leader: ($event) || null }"
		/>
	</UFormField>
</template>
