<script setup lang="ts">
/**
 * The one hint of a settings surface: a line of muted text telling the operator
 * something no single field's description can, such as why a section is empty.
 */
</script>

<template>
	<p class="text-xs text-muted">
		<slot />
	</p>
</template>
