<script setup lang="ts">
import type { OpCardColor } from '~~/shared/types/card/op';
import { formatOpColors } from '~~/shared/utils/card/op';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * One Piece colours as pips, one per colour: both colours of a dual-colour
 * Leader. The One Piece counterpart of `MtgManaColorDisplay`. Monochrome paints
 * each pip as white coverage of the same size, for a Key Output's matte.
 */
const props = withDefaults(defineProps<{
	colors: readonly OpCardColor[];
	size?: Size;
	monochrome?: boolean;
}>(), {
	size: 'md',
	monochrome: false,
});

const sizeClasses: Record<Size, string> = {
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
		:data-op-colors="props.monochrome ? 'key' : 'fill'"
	>
		<span
			v-for="color in props.colors"
			:key="color"
			class="op-color"
			:class="{ 'op-color--key': props.monochrome }"
			:style="{ backgroundColor: props.monochrome ? '#fff' : OP_COLOR_FILLS[color] }"
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

.op-color--key {
	box-shadow: none;
}
</style>
