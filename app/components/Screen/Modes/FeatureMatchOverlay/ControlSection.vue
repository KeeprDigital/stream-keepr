<script setup lang="ts">
import GraphicsInspectorSection from '~/components/Graphics/InspectorSection.vue';

/**
 * A Frame or Source Item property section: the shared inspector section, so the
 * host-owned panels collapse, summarise, and remember their state the same way
 * the Graphic Item panel does. Remembered by title, under this host's own prefix.
 */
const props = withDefaults(defineProps<{
	title: string;
	defaultOpen?: boolean;
	summary?: string;
}>(), {
	defaultOpen: false,
});

const id = computed(() => `feature-match-overlay-${props.title.toLowerCase().replace(/\W+/g, '-')}`);
</script>

<template>
	<GraphicsInspectorSection
		:id="id"
		:title="title"
		:summary="summary"
		:default-open="defaultOpen"
	>
		<slot />
	</GraphicsInspectorSection>
</template>
