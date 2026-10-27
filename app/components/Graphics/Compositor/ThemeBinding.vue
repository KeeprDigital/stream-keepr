<script setup lang="ts">
import type { GraphicThemeSlot } from '~~/shared/types/graphicThemeBindings';
import { graphicThemeSlotTokens } from '~~/shared/modules/graphics';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';

/**
 * One property group's Theme binding, offered inside the property control that
 * already edits that group (#829).
 *
 * A bound group follows a whole Foundation Token of its type; choosing one
 * replaces the group's own value. "Own value" detaches it, keeping the token's
 * resolved value as the group's own, so the controls below go on showing
 * exactly what they showed. Editing a bound group's value detaches it too.
 */
const props = defineProps<{
	themeSlot: GraphicThemeSlot;
	/** The Foundation Token the slot names, or none while it holds its own value. */
	current?: string;
	writable?: boolean;
	label: string;
}>();

const emit = defineEmits<{
	bind: [token: string];
	detach: [];
}>();

const OWN = '__own__';

const items = computed(() => [
	...graphicThemeSlotTokens(props.themeSlot).map(name => ({ label: `Theme: ${FOUNDATION_TOKENS[name].label}`, value: name as string })),
	{ label: 'Own value', value: OWN },
]);

const selected = computed(() => props.current && items.value.some(item => item.value === props.current)
	? props.current
	: OWN);

function choose(value: string) {
	if (value === selected.value)
		return;
	if (value === OWN)
		emit('detach');
	else
		emit('bind', value);
}
</script>

<template>
	<div
		class="mb-2 flex items-center gap-2"
		:data-testid="`theme-binding-${themeSlot}`"
		:data-theme-token="selected === OWN ? undefined : selected"
	>
		<UIcon name="i-lucide-swatch-book" class="size-3.5 shrink-0 text-muted" />
		<USelect
			:model-value="selected"
			:items="items"
			size="xs"
			class="min-w-0 flex-1"
			:disabled="writable !== true"
			:aria-label="`${label} Theme binding`"
			:data-testid="`theme-binding-${themeSlot}-token`"
			@update:model-value="choose"
		/>
	</div>
</template>
