<script setup lang="ts">
import type { FeatureMatchOverlayBoxStyle, FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import { resolveFeatureMatchOverlayFontFamily } from '~~/shared/featureMatchOverlayFonts';

interface FeatureMatchOverlayTemplateSegment {
	text: string;
	deckColors: boolean;
	spacer?: boolean;
	spacerWidth?: string;
	token?: string;
	style?: FeatureMatchOverlayBoxStyle;
}

const props = defineProps<{
	lines: FeatureMatchOverlayTemplateSegment[][];
	deckColors: string;
	output: FeatureMatchOverlayOutput;
}>();

const manaColorCount = computed(() => props.deckColors
	.toUpperCase()
	.split('')
	.filter(color => ['W', 'U', 'B', 'R', 'G', 'C'].includes(color))
	.length);

function segmentStyle(segment: FeatureMatchOverlayTemplateSegment) {
	const style = segment.style;
	if (!style)
		return undefined;
	return {
		color: style.textColor,
		fontSize: style.fontSize != null ? `${style.fontSize}px` : undefined,
		fontFamily: resolveFeatureMatchOverlayFontFamily(style.fontFamily),
		fontWeight: style.fontWeight,
		fontStyle: style.fontStyle,
		textTransform: style.textTransform,
		letterSpacing: style.letterSpacing != null ? `${style.letterSpacing}px` : undefined,
		lineHeight: style.lineHeight,
	};
}

function spacerStyle(segment: FeatureMatchOverlayTemplateSegment) {
	return {
		width: segment.spacerWidth ?? '32px',
	};
}
</script>

<template>
	<div v-for="(line, lineIndex) in lines" :key="lineIndex" class="template-line">
		<template v-for="(segment, segmentIndex) in line" :key="segmentIndex">
			<span
				v-if="segment.spacer"
				class="template-spacer"
				:style="spacerStyle(segment)"
				aria-hidden="true"
			/>
			<span
				v-else-if="segment.deckColors && output === 'key'"
				class="template-deck-colors template-deck-colors--key text-lg"
			>
				<span
					v-for="index in manaColorCount"
					:key="index"
					class="key-mana-circle"
				/>
			</span>
			<MtgManaColorDisplay
				v-else-if="segment.deckColors"
				:colors="deckColors"
				size="lg"
				class="template-deck-colors"
				cost
			/>
			<span v-else :style="segmentStyle(segment)">{{ segment.text }}</span>
		</template>
	</div>
</template>

<style scoped>
.template-line {
	display: flex;
	align-items: center;
	gap: 0.25em;
	min-height: 1em;
}

.template-deck-colors {
	display: inline-flex;
	vertical-align: middle;
}

.template-spacer {
	display: inline-block;
	flex: 0 0 auto;
	height: 1em;
}

.template-deck-colors--key {
	gap: 0.1em;
	color: #fff !important;
}

.key-mana-circle {
	display: inline-block;
	width: 1.15em;
	height: 1.15em;
	border-radius: 9999px;
	background: #fff;
	flex: 0 0 auto;
}
</style>
