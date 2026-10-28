<script setup lang="ts">
import { useScreenModeReady } from '~/modules/screen-mode';

const props = withDefaults(defineProps<{
	error: string | null;
	empty?: boolean;
	/**
	 * Whether what the mode shows has settled: its first read answered or
	 * failed, and anything it stages loaded. Program keeps the outgoing mode
	 * until it is.
	 */
	ready: boolean;
}>(), {
	empty: false,
});

useScreenModeReady(() => props.ready);
</script>

<template>
	<!-- Broadcast outputs should never disappear just because fresh data is loading.
		Keep rendering the current slot so updates can happen behind the scenes. -->
	<slot v-if="!error && !empty" />
</template>
