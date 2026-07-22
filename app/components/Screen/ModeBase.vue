<script setup lang="ts">
withDefaults(defineProps<{
	error: string | null;
	empty?: boolean;
}>(), {
	empty: false,
});
</script>

<template>
	<!-- Broadcast outputs should never disappear just because fresh data is loading.
		Keep rendering the current slot so updates can happen behind the scenes. -->
	<slot v-if="!error && !empty" />
</template>
