<script setup lang="ts">
// Control screen layout: full-viewport, touch-hardened container.
// No scroll, no zoom, no text selection — purpose-built for touch devices.
</script>

<template>
	<div class="control-layout">
		<slot />
	</div>
</template>

<style scoped>
.control-layout {
	position: fixed;
	inset: 0;
	overflow: hidden;
	background: var(--ui-bg);

	/* Touch hardening */
	touch-action: manipulation;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
	overscroll-behavior: none;
}
</style>
