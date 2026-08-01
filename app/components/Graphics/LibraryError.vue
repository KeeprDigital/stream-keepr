<script setup lang="ts">
/**
 * The one message a graphics library's author is looking at, or nothing.
 *
 * All three libraries in the reusable-library scope report the same way: one refusal at
 * a time, held until the author has seen it, stated where they are already reading
 * rather than as a toast that leaves. The title is the library's, because "Template
 * library action failed" and "Graphic Style Set action failed" are different pieces of
 * news; everything else about how a refusal is presented is not.
 */
defineProps<{
	title: string;
	/** The refusal an author is looking at, or none — which renders nothing at all. */
	message: string | null;
	testId: string;
}>();
</script>

<template>
	<UAlert
		v-if="message"
		color="error"
		variant="soft"
		icon="i-lucide-triangle-alert"
		:title="title"
		:description="message"
		:data-testid="testId"
	/>
</template>
