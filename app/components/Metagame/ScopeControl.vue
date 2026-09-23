<script setup lang="ts">
const props = defineProps<{
	scope: MetagameScope;
	topN: number;
	minPoints: number;
	playerListId?: number;
	playerLists: Array<{ id: number; name: string; memberCount: number }>;
}>();

const emit = defineEmits<{
	(e: 'update:scope', scope: MetagameScope): void;
	(e: 'update:topN', topN: number): void;
	(e: 'update:minPoints', minPoints: number): void;
	(e: 'update:playerListId', id: number | undefined): void;
}>();

const TOP_N_PRESETS = [8, 16, 32];

// Build combined scope options: All, Top N presets, custom scopes, then player lists
const scopeItems = computed(() => {
	const items: Array<{ label: string; value: string }> = [
		{ label: 'All Players', value: 'all' },
		...TOP_N_PRESETS.map(n => ({ label: `Top ${n}`, value: `topN:${n}` })),
		{ label: 'Top N…', value: 'topN' },
		{ label: 'Minimum Points…', value: 'minPoints' },
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

// A preset Top N and a custom Top N are the same scope underneath; this only
// remembers which face of it the operator picked, so typing a preset value
// into the custom input does not collapse the input away.
const customTopN = ref(false);

// Derive current combined value
const currentValue = computed(() => {
	if (props.scope === 'topN')
		return !customTopN.value && TOP_N_PRESETS.includes(props.topN) ? `topN:${props.topN}` : 'topN';
	if (props.scope === 'minPoints')
		return 'minPoints';
	if (props.scope === 'playerList' && props.playerListId)
		return `playerList:${props.playerListId}`;
	return 'all';
});

const showTopNInput = computed(() => props.scope === 'topN' && currentValue.value === 'topN');
const showMinPointsInput = computed(() => props.scope === 'minPoints');

function onScopeChange(value: string) {
	customTopN.value = value === 'topN';

	if (value === 'all') {
		emit('update:scope', 'all');
	}
	else if (value === 'topN') {
		emit('update:scope', 'topN');
	}
	else if (value === 'minPoints') {
		emit('update:scope', 'minPoints');
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
	<div class="flex items-center gap-2">
		<USelect
			:model-value="currentValue"
			:items="scopeItems"
			class="w-56"
			@update:model-value="onScopeChange"
		/>

		<UInputNumber
			v-if="showTopNInput"
			:model-value="topN"
			:min="1"
			:max="500"
			class="w-28"
			aria-label="Top N players"
			@update:model-value="emit('update:topN', Number($event))"
		/>

		<UInputNumber
			v-if="showMinPointsInput"
			:model-value="minPoints"
			:min="0"
			:max="999"
			class="w-28"
			aria-label="Minimum points"
			@update:model-value="emit('update:minPoints', Number($event))"
		/>
	</div>
</template>
