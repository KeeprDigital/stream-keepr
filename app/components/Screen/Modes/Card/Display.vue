<script setup lang="ts">
const { screenId, card, error } = useCardModeData();
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="!screenId"
	>
		<MtgCardDisplay
			v-if="screenId"
			:card="card"
		/>
	</ScreenModeBase>
</template>
