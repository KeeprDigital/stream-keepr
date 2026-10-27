<script setup lang="ts">
const { screenId, error } = useCardModeData();
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="!screenId"
	>
		<MtgCardDisplay
			v-if="screenId"
			:screen-id="screenId"
		/>
	</ScreenModeBase>
</template>
