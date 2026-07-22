<script setup lang="ts">
const { displayConfig, screenId, error } = useCardModeData();
</script>

<template>
	<ScreenModeBase
		:error="error"
		:empty="!screenId"
	>
		<MtgCardDisplay
			v-if="screenId"
			:config="displayConfig"
			:screen-id="screenId"
		/>
	</ScreenModeBase>
</template>
