<script setup lang="ts">
import type { FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayGraphicItemRender } from '~/modules/feature-match-overlay/renderModel';
import FeatureMatchOverlayGameWinsGraphicItem from './GameWinsWidget.vue';
import FeatureMatchOverlayStatusGraphicItem from './StatusWidget.vue';
import FeatureMatchOverlayTemplateLines from './TemplateLines.vue';

const props = defineProps<{
	render: FeatureMatchOverlayGraphicItemRender;
	output: FeatureMatchOverlayOutput;
}>();

// Template-narrowing does not flow into the closure prop, so resolve here.
function gameWinBoxStyle(won: boolean) {
	if (props.render.type !== 'game-wins')
		return {};
	return won ? props.render.boxStyles.won : props.render.boxStyles.lost;
}
</script>

<template>
	<FeatureMatchOverlayTemplateLines
		v-if="render.type === 'text'"
		:lines="render.lines"
		:deck-colors="render.deckColors"
		:output="output"
	/>
	<img
		v-else-if="render.type === 'image'"
		:src="render.src"
		:alt="render.alt"
		:style="render.imageStyle"
	>
	<span v-else-if="render.type === 'clock'">{{ render.displayTime }}</span>
	<FeatureMatchOverlayStatusGraphicItem
		v-else-if="render.type === 'player-life'"
		:life-total="render.lifeTotal"
		:animation="render.animation"
		:duration-ms="render.durationMs"
		:accent-color="render.accentColor"
	/>
	<FeatureMatchOverlayGameWinsGraphicItem
		v-else-if="render.type === 'game-wins'"
		:boxes="render.boxes"
		:wins="render.wins"
		:display-mode="render.displayMode"
		:box-style="gameWinBoxStyle"
		:style="render.containerStyle"
	/>
</template>
