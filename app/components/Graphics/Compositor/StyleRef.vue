<script setup lang="ts">
import type { GraphicStyleRef, GraphicStyleSetEntry, GraphicStyleSlot } from '~~/shared/types/graphicStyleSet';
import { graphicStyleEntriesForSlot } from '~~/shared/modules/graphic-style-sets';

/**
 * One property group's link to a Graphic Style Set entry, offered inside the
 * property control that already edits that group.
 *
 * This is the whole adoption workflow, and it is deliberately not a workflow. The
 * glossary rules out a bulk-mapping step: an author picks entries "directly in
 * existing property controls, and every unselected property remains local". So this
 * is a picker next to the properties, showing only the entries of the kind this slot
 * takes, and every property with no picker touched stays exactly as local as it was.
 *
 * Unlinking keeps the value. A composition stores its resolved properties inline, so
 * stopping inheritance removes provenance and moves nothing — which is why the
 * control can sit here without being a trap.
 */
const props = defineProps<{
	styleSlot: GraphicStyleSlot;
	/** The linked Style Set's published entries, or none when nothing is linked. */
	entries?: readonly GraphicStyleSetEntry[];
	current?: GraphicStyleRef;
	writable?: boolean;
	label?: string;
}>();

const emit = defineEmits<{
	bind: [entryId: string];
	unbind: [];
}>();

const options = computed(() =>
	graphicStyleEntriesForSlot(props.entries ?? [], props.styleSlot)
		.map(entry => ({ label: entry.name, value: entry.id })),
);

/** The entry a reference names, when the published Style Set still has it. */
const linked = computed(() =>
	props.current ? props.entries?.find(entry => entry.id === props.current!.entryId) : undefined,
);

/**
 * How many of this property group's keys the author has claimed as their own.
 *
 * Shown as a count rather than a list because the list is the property control
 * directly below it: what an author needs here is the fact that some of what they
 * are looking at no longer follows the preset.
 */
const overrideCount = computed(() => Object.keys(props.current?.overrides ?? {}).length);

const canAuthor = computed(() => props.writable === true && options.value.length > 0);
</script>

<template>
	<div
		v-if="options.length > 0 || current"
		class="mb-2 flex items-center gap-2"
		:data-testid="`style-ref-${styleSlot}`"
	>
		<UIcon name="i-lucide-palette" class="size-3.5 shrink-0 text-muted" />
		<USelectMenu
			:model-value="current?.entryId"
			:items="options"
			value-key="value"
			size="xs"
			class="min-w-0 flex-1"
			:disabled="!canAuthor"
			:placeholder="label ?? 'Local'"
			:aria-label="`Graphic Style Set entry for ${label ?? styleSlot}`"
			:data-testid="`style-ref-${styleSlot}-entry`"
			@update:model-value="value => value && emit('bind', String(value))"
		/>
		<UBadge
			v-if="overrideCount > 0"
			color="warning"
			variant="subtle"
			size="sm"
			:data-testid="`style-ref-${styleSlot}-overrides`"
		>
			{{ overrideCount }} local
		</UBadge>
		<UButton
			v-if="current && writable"
			size="xs"
			color="neutral"
			variant="ghost"
			icon="i-lucide-unlink"
			:aria-label="`Stop inheriting ${label ?? styleSlot}`"
			:data-testid="`style-ref-${styleSlot}-unbind`"
			@click="emit('unbind')"
		/>
		<!--
			A reference the published Style Set no longer resolves. Reported rather than
			silently ignored: the property is still whatever it was, and only the author
			can decide what it should follow now.
		-->
		<UIcon
			v-else-if="current && !linked"
			name="i-lucide-triangle-alert"
			class="size-3.5 shrink-0 text-warning"
			:data-testid="`style-ref-${styleSlot}-unresolved`"
		/>
	</div>
</template>
