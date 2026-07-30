<script setup lang="ts">
import type { FeatureMatchGameWinsGraphicItemConfig } from '~~/shared/types/screenConfig';

withDefaults(defineProps<{
	boxes: boolean[];
	wins: number;
	displayMode?: FeatureMatchGameWinsGraphicItemConfig['displayMode'];
	boxStyle: (won: boolean, index: number) => Record<string, string | number | undefined>;
}>(), {
	displayMode: 'boxes',
});
</script>

<template>
	<div class="game-wins-graphic-item" :class="{ 'game-wins-graphic-item--number': displayMode === 'number' }">
		<span v-if="displayMode === 'number'" class="game-wins-number">{{ wins }}</span>
		<template v-else>
			<span
				v-for="(won, index) in boxes"
				:key="index"
				class="game-win-box"
				:style="boxStyle(won, index)"
			/>
		</template>
	</div>
</template>

<style scoped>
.game-wins-graphic-item {
	display: flex;
	flex-direction: var(--game-win-direction, row);
	align-items: center;
	justify-content: center;
	gap: var(--game-win-gap, 6px);
	width: 100%;
	height: 100%;
}

.game-win-box {
	display: block;
	box-sizing: border-box;
	flex: 0 0 auto;
}

.game-wins-graphic-item--number {
	gap: 0;
}

.game-wins-number {
	display: block;
	line-height: 1;
	white-space: nowrap;
}
</style>
