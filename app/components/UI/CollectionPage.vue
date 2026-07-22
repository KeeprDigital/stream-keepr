<script setup lang="ts">
type CollectionPageState = 'loading' | 'ready' | 'empty' | 'empty-filtered';
type ToolbarMode = 'auto' | 'always' | 'never';
type ContentWidth = 'default' | 'narrow' | 'full';

const props = withDefaults(defineProps<{
	state: CollectionPageState;
	flush?: boolean;
	toolbarMode?: ToolbarMode;
	contentWidth?: ContentWidth;
	emptyIcon: string;
	emptyTitle: string;
	emptyDescription?: string;
	reserveToolbarSpace?: boolean;
}>(), {
	flush: false,
	toolbarMode: 'auto',
	contentWidth: 'default',
	emptyDescription: undefined,
	reserveToolbarSpace: true,
});

const isEmptyState = computed(() => props.state === 'empty' || props.state === 'empty-filtered');
const showContent = computed(() => props.state === 'loading' || props.state === 'ready');
const showToolbar = computed(() => {
	if (props.toolbarMode === 'always')
		return true;
	if (props.toolbarMode === 'never')
		return false;
	return props.state === 'ready' || props.state === 'empty-filtered';
});
const reserveEmptyToolbarSpace = computed(() => isEmptyState.value && !showToolbar.value && props.reserveToolbarSpace);
const hasToolbarRegion = computed(() => showToolbar.value || reserveEmptyToolbarSpace.value);

const contentOuterClass = computed(() => props.flush ? undefined : 'p-4 sm:p-6');
const contentClass = computed(() => {
	if (props.contentWidth === 'full')
		return undefined;
	if (props.contentWidth === 'narrow')
		return 'mx-auto w-full max-w-3xl';
	return 'mx-auto w-full max-w-7xl';
});
</script>

<template>
	<NuxtLayout name="default" flush>
		<template v-if="$slots.actions && state === 'ready'" #actions>
			<slot name="actions" />
		</template>

		<template v-if="hasToolbarRegion" #toolbar>
			<slot v-if="showToolbar" name="toolbar" />
			<div v-else class="h-12" aria-hidden="true" />
		</template>

		<div v-if="showContent" :class="contentOuterClass">
			<div :class="contentClass">
				<slot />
			</div>
		</div>

		<UIEmptyState
			v-else-if="isEmptyState"
			variant="page"
			:icon="emptyIcon"
			:title="emptyTitle"
			:description="emptyDescription"
		>
			<template v-if="$slots['empty-actions']" #actions>
				<slot name="empty-actions" />
			</template>
		</UIEmptyState>
	</NuxtLayout>
</template>
