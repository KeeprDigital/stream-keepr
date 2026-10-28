<script setup lang="ts">
const { screenId, card, error, ready } = useCardModeData();
</script>

<template>
	<ScreenModeBase
		:error="error"
		:ready="ready"
		:empty="!screenId"
	>
		<MtgCardDisplay
			v-if="screenId"
			:card="card"
		/>
	</ScreenModeBase>
</template>
