<script lang="ts" setup>
import type { Event } from '~/types';

const props = defineProps<{
	event: Event;
}>();
</script>

<template>
	<NuxtLink
		:to="`/event/${props.event.id}`"
		class="block"
	>
		<UCard
			:key="props.event.id"
			class="hover:shadow-lg transition-shadow duration-200"
		>
			<template #header>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<h3 class="text-lg font-semibold text-highlighted truncate">
							{{ props.event.name }}
						</h3>
					</div>
					<UIcon name="i-lucide-chevron-right" class="h-5 w-5 text-muted" />
				</div>
			</template>

			<div class="flex flex-col gap-3">
				<div class="flex items-center gap-2 text-sm text-muted">
					<UIcon name="i-lucide-gamepad-2" class="h-4 w-4" />
					<span class="capitalize">{{ props.event.game }}</span>
				</div>
			</div>
		</UCard>
	</NuxtLink>
</template>
