<script setup lang="ts">
import { useInspectorSections } from '~/composables/ui/useInspectorSections';

/**
 * One collapsible group of a graphics property panel: a title, a one-line summary
 * of what it holds while collapsed, and its fields.
 *
 * Whether it is open is remembered per browser by `id`, so a section an author
 * has no use for stays out of the way on every item that follows.
 */
const props = withDefaults(defineProps<{
	id: string;
	title: string;
	icon?: string;
	/** Shown under the title while collapsed. */
	summary?: string;
	defaultOpen?: boolean;
}>(), { defaultOpen: true });

const sections = useInspectorSections();

const open = computed({
	get: () => sections.isOpen(props.id, props.defaultOpen),
	set: value => sections.setOpen(props.id, value),
});
</script>

<template>
	<section class="border-b border-default/70 last:border-b-0" :data-inspector-section="id">
		<button
			type="button"
			class="flex w-full items-center gap-2 py-2.5 text-left"
			:aria-expanded="open"
			:data-testid="`inspector-section-${id}-toggle`"
			@click="open = !open"
		>
			<UIcon v-if="icon" :name="icon" class="size-4 shrink-0 text-muted" />
			<span class="min-w-0 flex-1">
				<span class="block text-sm font-medium">{{ title }}</span>
				<span v-if="summary && !open" class="block truncate text-xs text-muted">{{ summary }}</span>
			</span>
			<slot name="actions" />
			<UIcon
				name="i-lucide-chevron-down"
				class="size-4 shrink-0 text-muted transition-transform"
				:class="{ 'rotate-180': open }"
			/>
		</button>
		<div v-show="open" class="space-y-3 pb-4" :data-testid="`inspector-section-${id}`">
			<slot />
		</div>
	</section>
</template>
