<script setup lang="ts">
withDefaults(defineProps<{
	title: string;
	defaultOpen?: boolean;
	badge?: string;
	summary?: string;
}>(), {
	defaultOpen: false,
});
</script>

<template>
	<UCollapsible :default-open="defaultOpen" class="border-b border-default/70 last:border-b-0">
		<template #default="{ open }">
			<button type="button" class="flex w-full items-center justify-between gap-3 py-3 text-left">
				<div class="min-w-0">
					<p class="font-medium">
						{{ title }}
					</p>
					<p v-if="summary" class="text-xs text-muted">
						{{ summary }}
					</p>
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<UBadge v-if="badge" variant="soft">
						{{ badge }}
					</UBadge>
					<UIcon name="i-lucide-chevron-down" class="size-4 transition-transform" :class="{ 'rotate-180': open }" />
				</div>
			</button>
		</template>
		<template #content>
			<div class="pb-4 pt-1">
				<slot />
			</div>
		</template>
	</UCollapsible>
</template>
