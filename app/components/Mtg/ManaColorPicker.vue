<script setup lang="ts">
import { mtgColors } from '~~/shared/utils/mtgData';

/**
 * Interactive MTG mana color picker using mana-font symbols as toggles.
 * Active colors are shown with full color, inactive are greyed out.
 *
 * Usage:
 *   <MtgManaColorPicker v-model="selectedColors" />
 *   <MtgManaColorPicker v-model="selectedColors" size="lg" />
 */

interface Props {
	/** Size variant */
	size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

withDefaults(defineProps<Props>(), {
	size: 'md',
});

const model = defineModel<string[]>({ default: () => [] });

const colorClassMap: Record<string, string> = {
	W: 'ms-w',
	U: 'ms-u',
	B: 'ms-b',
	R: 'ms-r',
	G: 'ms-g',
	C: 'ms-c',
};

const sizeClasses: Record<string, string> = {
	xs: 'text-xs',
	sm: 'text-sm',
	md: 'text-lg',
	lg: 'text-xl',
	xl: 'text-2xl',
};

function isActive(color: string): boolean {
	return model.value.includes(color);
}

function toggle(color: string) {
	if (isActive(color)) {
		model.value = model.value.filter(c => c !== color);
	}
	else {
		model.value = [...model.value, color];
	}
}
</script>

<template>
	<div class="mana-color-picker flex items-center gap-2" :class="sizeClasses[size]">
		<button
			v-for="color in mtgColors"
			:key="color.value"
			type="button"
			class="mana-toggle transition-all duration-150 cursor-pointer"
			:class="isActive(color.value) ? 'opacity-100' : 'opacity-25 grayscale'"
			:title="color.label"
			:aria-label="`Toggle ${color.label}`"
			:aria-pressed="isActive(color.value)"
			@click="toggle(color.value)"
		>
			<i
				class="ms ms-cost"
				:class="colorClassMap[color.value]"
			/>
		</button>
	</div>
</template>

<style scoped>
@import 'mana-font/css/mana.css';

.mana-toggle[aria-pressed='false']:hover {
	opacity: 1;
	filter: none;
}

.mana-toggle[aria-pressed='true']:hover {
	opacity: 0.6;
}
</style>
