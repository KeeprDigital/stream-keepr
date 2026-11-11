<script setup lang="ts">
import type { GraphicSurfaceStyleEdit } from '~~/shared/modules/graphics';
import type { GraphicGlow, GraphicOutline, GraphicSurfaceStyle } from '~~/shared/types/graphics';
import type { BorderGlowEdit } from '~/types/borderGlow';

/**
 * The one surface editor, for a Graphic Surface Style in the graphics inspector
 * and a Theme's surface-style token: through the shared Graphic Fill fields, its
 * fill; its fill opacity; and, through the shared border and glow fields, its
 * uniform outline and glow. A host offering its own colour picker fills the
 * `color` slot, which every colour of the surface takes, named by `target`.
 *
 * One component rather than one block per surface, because a Game Wins Graphic
 * Item has three — its own, and the two that paint a win box before and after the
 * Player wins it — and every one of them is the same shared visual treatment.
 * What differs between them is only which one is being edited, so this reports
 * *what the author changed* and leaves the caller to say *which surface* it
 * belongs to.
 *
 * Shape Geometry is deliberately absent: corners and slants belong to the
 * geometry, not to the surface painted inside it.
 */
const props = defineProps<{
	/**
	 * The style being edited, or null where the item paints no surface of its own.
	 *
	 * Not named `style`: Vue reserves that name for the element attribute, so a prop
	 * called `style` would never arrive.
	 */
	surfaceStyle: GraphicSurfaceStyle | null;
	title: string;
	/**
	 * The label for the switch that decides whether the item paints a surface at
	 * all. Omitted where the slot is required — a win box always paints one — and
	 * the switch is then not offered.
	 */
	presenceLabel?: string;
	/** Drop the bordered box, for a host that already frames the fields in a section. */
	flat?: boolean;
	/** Keep the title as a subheading while flat, where several surfaces share one section. */
	showTitle?: boolean;
	/**
	 * Distinguishes this surface's controls from a sibling's. Empty for an item's
	 * own Graphic Surface Style, which is the one every host has always had.
	 */
	testIdPrefix?: string;
	size?: 'xs' | 'sm';
}>();

const emit = defineEmits<{ edit: [edit: GraphicSurfaceStyleEdit] }>();

defineSlots<{
	/** Which Theme token this surface follows, if any: see the template. */
	binding?: () => unknown;
	/** Replaces the colour picker for each colour of the surface: its fill's, a stop's, the outline's and the glow's. */
	color?: (props: {
		target: 'solid' | 'stop' | 'border' | 'glow';
		value: string | undefined;
		label: string;
		disabled: boolean;
		testId?: string;
		update: (value: string) => void;
	}) => unknown;
}>();

function testId(suffix: string): string {
	return props.testIdPrefix
		? `${props.testIdPrefix}-${suffix}`
		: suffix;
}

function editBorderGlow(edit: BorderGlowEdit) {
	if (edit.kind === 'border')
		emit('edit', { kind: 'outline', patch: edit.patch as Partial<GraphicOutline> | null });
	else
		emit('edit', { kind: 'glow', patch: edit.patch as Partial<GraphicGlow> | null });
}
</script>

<template>
	<div :class="flat ? 'space-y-2' : 'rounded-lg border border-default/70 p-3 space-y-2'">
		<p v-if="!flat || showTitle" class="text-xs font-semibold text-muted">
			{{ title }}
		</p>

		<!--
			Which Theme token this surface follows, if any. A slot rather than props for
			the same reason the surface itself is reported as an edit: this component
			knows what a Graphic Surface Style is and deliberately not *which* one it is,
			and a Theme binding is a fact about which one. The caller already says that,
			so it fills this in too — and a caller with no binding fills in nothing.
		-->
		<slot name="binding" />

		<UFormField v-if="presenceLabel" :label="presenceLabel" size="sm">
			<USwitch
				:model-value="surfaceStyle !== null"
				:data-testid="testId('surface-style-own')"
				@update:model-value="emit('edit', { kind: 'present', present: $event })"
			/>
		</UFormField>

		<template v-if="surfaceStyle">
			<GraphicsFillFields
				:fill="surfaceStyle.fill"
				:size="size ?? 'sm'"
				:aria-label-prefix="title"
				:test-id-prefix="testId('graphic-fill')"
				@edit="emit('edit', $event)"
			>
				<template v-if="$slots.color" #color="color">
					<slot name="color" v-bind="color" />
				</template>
			</GraphicsFillFields>

			<GraphicsOpacityField
				label="Fill opacity"
				:size="size ?? 'sm'"
				:model-value="surfaceStyle.fillOpacity"
				:aria-label="`${title} fill opacity`"
				@update:model-value="emit('edit', { kind: 'fill-opacity', fillOpacity: $event ?? 1 })"
			/>

			<GraphicsBorderGlowFields
				border-label="Outline"
				:border="surfaceStyle.outline ?? null"
				:glow="surfaceStyle.glow ?? null"
				:aria-label-prefix="title"
				:border-test-id="testId('graphic-outline-enabled')"
				:glow-test-id="testId('graphic-glow-enabled')"
				:size="size ?? 'sm'"
				@edit="editBorderGlow"
			>
				<template v-if="$slots.color" #color="color">
					<slot name="color" v-bind="color" />
				</template>
			</GraphicsBorderGlowFields>
		</template>
	</div>
</template>
