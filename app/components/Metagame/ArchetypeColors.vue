<script setup lang="ts">
import type { Game } from '~~/shared/types/enums';
import { parseOpColors } from '~~/shared/utils/card/op';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * An Archetype's colours in its Card Game's pips: Magic's mana symbols, or a
 * One Piece Leader's colours, which its Archetype holds as `Red/Green`
 * (ADR-0074).
 */
const props = withDefaults(defineProps<{
	colors: string;
	game: Game | undefined;
	size?: Size;
}>(), {
	size: 'md',
});

const opColors = computed(() => parseOpColors(props.colors));
</script>

<template>
	<OpColorDisplay v-if="game === 'op'" :colors="opColors" :size="size" />
	<MtgManaColorDisplay v-else :colors="colors" :size="size" />
</template>
