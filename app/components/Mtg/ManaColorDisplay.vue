<script setup lang="ts">
/**
 * Displays MTG mana symbols using the Mana font.
 *
 * Two modes — provide one or the other:
 *   - `manaCost` — full casting cost string e.g. "{1}{W}" or "{G/W}"
 *   - `colors`   — color-identity string e.g. "WU" (one pip per color)
 *
 * @see https://github.com/andrewgioia/Mana
 *
 * Usage:
 *   <MtgManaColorDisplay mana-cost="{1}{W}" />
 *   <MtgManaColorDisplay colors="WUB" size="lg" />
 */

interface Props {
	/** Full casting cost string e.g. "{1}{W}", "{G/W}", "{X}{B}{B}" */
	manaCost?: string | null | undefined;
	/** Color-identity string e.g. "W", "WU", "WUBRG", "C" */
	colors?: string | null | undefined;
	/** Size variant */
	size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
	/** Show shadow effect on symbols */
	shadow?: boolean;
	/** Show cost circle around symbols */
	cost?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	size: 'md',
	shadow: false,
	cost: true,
});

const sizeClasses: Record<string, string> = {
	xs: 'text-xs',
	sm: 'text-sm',
	md: 'text-base',
	lg: 'text-lg',
	xl: 'text-xl',
};

/** Map single-letter color codes to Mana font class names (colors mode) */
const colorClassMap: Record<string, string> = {
	W: 'ms-w',
	U: 'ms-u',
	B: 'ms-b',
	R: 'ms-r',
	G: 'ms-g',
	C: 'ms-c',
};

/**
 * Parse a Scryfall mana cost string into an array of mana-font class names.
 * e.g. "{1}{W}" → ["ms-1", "ms-w"]
 *      "{G/W}"  → ["ms-gw"]
 *      "{W/P}"  → ["ms-wp"]
 */
function parseManaCost(manaCost: string): string[] {
	const symbols: string[] = [];
	const re = /\{([^}]+)\}/g;
	let match: RegExpExecArray | null;
	// eslint-disable-next-line no-cond-assign
	while ((match = re.exec(manaCost)) !== null) {
		// Normalise: lowercase, strip "/" separators (handles hybrid + phyrexian)
		const cls = match[1]!.toLowerCase().replace(/\//g, '');
		symbols.push(`ms-${cls}`);
	}
	return symbols;
}

const manaClasses = computed((): string[] => {
	if (props.manaCost) {
		return parseManaCost(props.manaCost);
	}
	if (props.colors) {
		return props.colors
			.toUpperCase()
			.split('')
			.filter(char => char in colorClassMap)
			.map(char => colorClassMap[char]!);
	}
	return [];
});

const sizeClass = computed(() => sizeClasses[props.size]);

function isNumericManaClass(manaClass: string) {
	return /^ms-\d/.test(manaClass);
}
</script>

<template>
	<span v-if="manaClasses.length > 0" class="mana-colors inline-flex items-center gap-0.5" :class="sizeClass">
		<i
			v-for="(manaClass, index) in manaClasses"
			:key="index"
			class="mana-symbol ms"
			:class="[
				manaClass,
				{ 'mana-symbol--numeric': isNumericManaClass(manaClass) },
				{ 'ms-shadow': shadow },
				{ 'ms-cost': cost },
			]"
		/>
	</span>
	<span v-else class="text-muted" :class="sizeClass">—</span>
</template>

<style scoped>
@import 'mana-font/css/mana.css';

.mana-symbol {
	padding: 0 !important;
	padding-inline: 0 !important;
	margin-inline-start: 0 !important;
}

.mana-symbol--numeric {
	margin-left: 0 !important;
	margin-inline-start: 0 !important;
}
</style>
