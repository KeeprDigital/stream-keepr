<script setup lang="ts">
const { displayConfig, screenId, card, error } = useCardModeData();
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="!screenId"
	>
		<MtgCardDisplay
			v-if="screenId"
			:config="displayConfig"
			:card="card"
		/>
	</ScreenModeBase>
</template>
