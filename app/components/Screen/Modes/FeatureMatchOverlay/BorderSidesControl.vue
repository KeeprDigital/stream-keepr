<script setup lang="ts">
import type { FeatureMatchOverlayBorderSides } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayBorderSide } from '~/utils/featureMatchOverlayGeometry';
import { FEATURE_MATCH_OVERLAY_BORDER_SIDES, featureMatchOverlayBorderSideEnabled } from '~/utils/featureMatchOverlayGeometry';

/**
 * Which sides of a Frame or Source Item border show. The border itself, its
 * colour, width and glow, is the Theme's surface Mode Token (#831); these are
 * the host's shape.
 */
const props = defineProps<{
	label: string;
	sides: FeatureMatchOverlayBorderSides;
}>();

const emit = defineEmits<{
	update: [updates: Partial<FeatureMatchOverlayBorderSides>];
}>();

const ICONS: Record<FeatureMatchOverlayBorderSide, string> = {
	Top: 'i-lucide-panel-top',
	Right: 'i-lucide-panel-right',
	Bottom: 'i-lucide-panel-bottom',
	Left: 'i-lucide-panel-left',
};

function visible(side: FeatureMatchOverlayBorderSide) {
	return featureMatchOverlayBorderSideEnabled(props.sides, side);
}

function toggle(side: FeatureMatchOverlayBorderSide) {
	emit('update', { [`border${side}Visible`]: !visible(side) });
}
</script>

<template>
	<UFormField :label="label" size="sm">
		<div class="inline-flex overflow-hidden rounded-md border border-default/70 bg-default/40">
			<UButton
				v-for="side in FEATURE_MATCH_OVERLAY_BORDER_SIDES"
				:key="side"
				:aria-pressed="visible(side)"
				:title="`${side} border`"
				:icon="ICONS[side]"
				size="sm"
				:color="visible(side) ? 'primary' : 'neutral'"
				:variant="visible(side) ? 'solid' : 'ghost'"
				class="rounded-none border-r border-default/60 px-3 last:border-r-0"
				@click="toggle(side)"
			>
				{{ side }}
			</UButton>
		</div>
	</UFormField>
</template>
