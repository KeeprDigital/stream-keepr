<script setup lang="ts">
import type { PlayerListSummary } from '~/types';

interface Props {
	lists: PlayerListSummary[];
	activeListId: number | null;
	loading?: boolean;
}

withDefaults(defineProps<Props>(), {
	loading: false,
});

const emit = defineEmits<{
	select: [listId: number | null];
	createList: [];
}>();
</script>

<template>
	<div class="flex items-center gap-1 overflow-x-auto">
		<!-- All Players tab -->
		<UButton
			:variant="activeListId === null ? 'soft' : 'ghost'"
			:color="activeListId === null ? 'primary' : 'neutral'"
			size="sm"
			@click="emit('select', null)"
		>
			All Players
		</UButton>

		<!-- List tabs -->
		<UButton
			v-for="list in lists"
			:key="list.id"
			:variant="activeListId === list.id ? 'soft' : 'ghost'"
			:color="activeListId === list.id ? 'primary' : 'neutral'"
			size="sm"
			@click="emit('select', list.id)"
		>
			{{ list.name }}
			<UBadge
				v-if="list.memberCount > 0"
				color="neutral"
				variant="subtle"
				size="xs"
			>
				{{ list.memberCount }}
			</UBadge>
		</UButton>

		<!-- Create new list button -->
		<UButton
			variant="ghost"
			color="neutral"
			size="sm"
			icon="i-lucide-plus"
			aria-label="Create new list"
			@click="emit('createList')"
		/>
	</div>
</template>
