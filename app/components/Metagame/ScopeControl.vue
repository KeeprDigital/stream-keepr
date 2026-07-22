<script setup lang="ts">
const props = defineProps<{
	scope: MetagameScope;
	topN: number;
	playerListId?: number;
	playerLists: Array<{ id: number; name: string; memberCount: number }>;
}>();

const emit = defineEmits<{
	(e: 'update:scope', scope: MetagameScope): void;
	(e: 'update:topN', topN: number): void;
	(e: 'update:playerListId', id: number | undefined): void;
}>();

// Build combined scope options: All, Top N presets, then player lists
const scopeItems = computed(() => {
	const items: Array<{ label: string; value: string }> = [
		{ label: 'All Players', value: 'all' },
		{ label: 'Top 8', value: 'topN:8' },
		{ label: 'Top 16', value: 'topN:16' },
		{ label: 'Top 32', value: 'topN:32' },
	];

	if (props.playerLists.length > 0) {
		for (const list of props.playerLists) {
			items.push({
				label: `${list.name} (${list.memberCount})`,
				value: `playerList:${list.id}`,
			});
		}
	}

	return items;
});

// Derive current combined value
const currentValue = computed(() => {
	if (props.scope === 'topN')
		return `topN:${props.topN}`;
	if (props.scope === 'playerList' && props.playerListId)
		return `playerList:${props.playerListId}`;
	return 'all';
});

function onScopeChange(value: string) {
	if (value === 'all') {
		emit('update:scope', 'all');
	}
	else if (value.startsWith('topN:')) {
		const n = Number.parseInt(value.split(':')[1]!);
		emit('update:scope', 'topN');
		emit('update:topN', n);
	}
	else if (value.startsWith('playerList:')) {
		const id = Number.parseInt(value.split(':')[1]!);
		emit('update:scope', 'playerList');
		emit('update:playerListId', id);
	}
}
</script>

<template>
	<USelect
		:model-value="currentValue"
		:items="scopeItems"
		class="w-56"
		@update:model-value="onScopeChange"
	/>
</template>
