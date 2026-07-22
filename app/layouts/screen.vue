<script setup lang="ts">
useHead({
	bodyAttrs: {
		class: 'transparent-body-override',
	},
});
</script>

<template>
	<div class="h-screen w-screen overflow-hidden flex items-center justify-center">
		<slot />
	</div>
</template>
