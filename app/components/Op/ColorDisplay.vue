<script setup lang="ts">
import type { OpCardColor } from '~~/shared/types/card/op';
import { formatOpColors } from '~~/shared/utils/card/op';

/**
 * One Piece colours as pips, one per colour: both colours of a dual-colour
 * Leader. The One Piece counterpart of `MtgManaColorDisplay`.
 */
const props = withDefaults(defineProps<{
	colors: readonly OpCardColor[];
	size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}>(), {
	size: 'md',
});

const sizeClasses: Record<string, string> = {
	xs: 'text-xs',
	sm: 'text-sm',
	md: 'text-base',
	lg: 'text-lg',
	xl: 'text-xl',
};

const OP_COLOR_FILLS: Record<OpCardColor, string> = {
	Red: '#d32f2f',
	Green: '#2e9e5b',
	Blue: '#1f6fc5',
	Purple: '#7b3fa0',
	Black: '#2b2b2b',
	Yellow: '#f2c300',
};
</script>

<template>
	<span
		v-if="props.colors.length > 0"
		class="op-colors"
		:class="sizeClasses[props.size]"
		role="img"
		:aria-label="formatOpColors(props.colors)"
		data-op-colors
	>
		<span
			v-for="color in props.colors"
			:key="color"
			class="op-color"
			:style="{ backgroundColor: OP_COLOR_FILLS[color] }"
			:data-op-color="color"
		/>
	</span>
	<span v-else class="text-muted" :class="sizeClasses[props.size]">—</span>
</template>

<style scoped>
.op-colors {
	display: inline-flex;
	align-items: center;
	gap: 0.15em;
	vertical-align: middle;
}

.op-color {
	display: inline-block;
	width: 1em;
	height: 1em;
	flex: 0 0 auto;
	border-radius: 9999px;
	box-shadow: inset 0 0 0 0.08em rgb(255 255 255 / 0.6);
}
</style>
