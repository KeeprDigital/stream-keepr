<script setup lang="ts">
const _config = useScreenModeConfig('topCut');
</script>

<template>
	<ScreenModeBase
		:error="null"
	>
		<div class="topcut-display flex flex-col items-center justify-center w-full h-full">
			<UIcon name="i-lucide-git-branch" class="text-6xl text-muted mb-4" />
			<p class="text-xl text-muted">
				Top Cut / Bracket
			</p>
			<p class="text-sm text-muted mt-2">
				Coming soon
			</p>
		</div>
	</ScreenModeBase>
</template>
