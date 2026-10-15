<script setup lang="ts">
import type { FeatureMatchOverlayGlowPosition } from '~~/shared/types/screenConfig';
import type { BorderFieldsValue, BorderGlowEdit, BorderSide, GlowFieldsValue } from '~/types/borderGlow';

/**
 * The one border and glow fields control, for the Feature Match Overlay Frame,
 * a Source Item's framing, a Graphic Surface Style, and a Graphic Surface Style
 * entry in a Graphic Style Set.
 *
 * It is presentational: it shows a neutral border and glow and reports each
 * change as a `BorderGlowEdit`, leaving the host to say what it stores. A
 * Feature Match Overlay border (per side) and a Graphic Surface Style outline
 * (uniform) stay distinct things; the host names its own with `borderLabel`.
 *
 * Hosts differ only where their renderer does, and say so by prop: per-side
 * borders, a glow position, and a glow that only exists around a visible
 * border. The colour field is the `color` slot, so a Style Set entry can pick a
 * palette entry where the others take a colour.
 */
const props = withDefaults(defineProps<{
	/** What the host calls its border: "Frame border", "Border", "Outline". */
	borderLabel: string;
	/** The border, or null while it is off. */
	border: BorderFieldsValue | null;
	/** The glow, or null while it is off. */
	glow: GlowFieldsValue | null;
	/** Offer each side of the border separately. */
	perSide?: boolean;
	/** Offer which side of the border the glow falls on. */
	glowPosition?: boolean;
	/** The host's renderer only glows a visible border, so the glow hides while it is off. */
	glowGatedOnBorder?: boolean;
	/** The default colour picker accepts complete `#rrggbb` values only. */
	hexOnly?: boolean;
	disabled?: boolean;
	size?: 'xs' | 'sm';
	/** Qualifies accessible names where one form shows several surfaces. */
	ariaLabelPrefix?: string;
	borderTestId?: string;
	glowTestId?: string;
}>(), {
	size: 'sm',
});

const emit = defineEmits<{ edit: [edit: BorderGlowEdit] }>();

defineSlots<{
	/** Replaces the colour picker for the border's colour and the glow's. */
	color?: (props: {
		target: 'border' | 'glow';
		value: string | undefined;
		label: string;
		disabled: boolean;
		update: (value: string | undefined) => void;
	}) => unknown;
}>();

/** The UI bound for border width and glow size; every host's schema allows at least this. */
const MAX_PIXELS = 500;

const SIDES = [
	{ key: 'top', label: 'Top', icon: 'i-lucide-panel-top' },
	{ key: 'right', label: 'Right', icon: 'i-lucide-panel-right' },
	{ key: 'bottom', label: 'Bottom', icon: 'i-lucide-panel-bottom' },
	{ key: 'left', label: 'Left', icon: 'i-lucide-panel-left' },
] satisfies Array<{ key: BorderSide; label: string; icon: string }>;

const GLOW_POSITION_OPTIONS = [
	{ label: 'Both', value: 'both' },
	{ label: 'Inside', value: 'inside' },
	{ label: 'Outside', value: 'outside' },
] satisfies Array<{ label: string; value: FeatureMatchOverlayGlowPosition }>;

const showGlow = computed(() => !props.glowGatedOnBorder || props.border !== null);

/** "Outline width" alone; "Won box outline width" where a prefix tells surfaces apart. */
function ariaLabel(label: string) {
	return props.ariaLabelPrefix ? `${props.ariaLabelPrefix} ${label.toLowerCase()}` : label;
}

function sideVisible(side: BorderSide) {
	return props.border?.sides?.[side] ?? true;
}

function editBorder(patch: Partial<Pick<BorderFieldsValue, 'color' | 'width'>> | null) {
	emit('edit', { kind: 'border', patch });
}

function editGlow(patch: Partial<GlowFieldsValue> | null) {
	emit('edit', { kind: 'glow', patch });
}

function toggleSide(side: BorderSide) {
	emit('edit', { kind: 'border-side', side, visible: !sideVisible(side) });
}
</script>

<template>
	<div class="space-y-3">
		<UFormField :label="borderLabel" :size="size">
			<USwitch
				:model-value="border !== null"
				:disabled="disabled"
				:aria-label="ariaLabel(borderLabel)"
				:data-testid="borderTestId"
				@update:model-value="editBorder($event ? {} : null)"
			/>
		</UFormField>

		<template v-if="border">
			<div class="grid grid-cols-2 gap-2">
				<UFormField :label="`${borderLabel} colour`" :size="size">
					<slot
						name="color"
						target="border"
						:value="border.color"
						:label="ariaLabel(`${borderLabel} colour`)"
						:disabled="disabled"
						:update="(value: string | undefined) => editBorder({ color: value })"
					>
						<UIColorPicker
							:model-value="border.color"
							:hex-only="hexOnly"
							:disabled="disabled"
							:size="size"
							:aria-label="ariaLabel(`${borderLabel} colour`)"
							@update:model-value="editBorder({ color: $event || undefined })"
						/>
					</slot>
				</UFormField>
				<UFormField :label="`${borderLabel} width`" :size="size">
					<UInputNumber
						:model-value="border.width"
						:min="0"
						:max="MAX_PIXELS"
						:size="size"
						:disabled="disabled"
						class="w-full"
						:aria-label="ariaLabel(`${borderLabel} width`)"
						@update:model-value="editBorder({ width: $event ?? 0 })"
					/>
				</UFormField>
			</div>

			<UFormField v-if="perSide" :label="`${borderLabel} sides`" :size="size">
				<div class="inline-flex overflow-hidden rounded-md border border-default/70 bg-default/40">
					<UButton
						v-for="side in SIDES"
						:key="side.key"
						:aria-pressed="sideVisible(side.key)"
						:title="`${side.label} border`"
						:icon="side.icon"
						:size="size"
						:disabled="disabled"
						:color="sideVisible(side.key) ? 'primary' : 'neutral'"
						:variant="sideVisible(side.key) ? 'solid' : 'ghost'"
						class="rounded-none border-r border-default/60 px-3 last:border-r-0"
						@click="toggleSide(side.key)"
					>
						{{ side.label }}
					</UButton>
				</div>
			</UFormField>
		</template>

		<template v-if="showGlow">
			<UFormField label="Glow" :size="size">
				<USwitch
					:model-value="glow !== null"
					:disabled="disabled"
					:aria-label="ariaLabel('Glow')"
					:data-testid="glowTestId"
					@update:model-value="editGlow($event ? {} : null)"
				/>
			</UFormField>

			<div v-if="glow" class="grid gap-2" :class="glowPosition ? 'grid-cols-2' : 'grid-cols-3'">
				<UFormField label="Glow colour" :size="size">
					<slot
						name="color"
						target="glow"
						:value="glow.color"
						:label="ariaLabel('Glow colour')"
						:disabled="disabled"
						:update="(value: string | undefined) => editGlow({ color: value })"
					>
						<UIColorPicker
							:model-value="glow.color"
							:hex-only="hexOnly"
							:disabled="disabled"
							:size="size"
							:aria-label="ariaLabel('Glow colour')"
							@update:model-value="editGlow({ color: $event || undefined })"
						/>
					</slot>
				</UFormField>
				<UFormField label="Glow size" :size="size">
					<UInputNumber
						:model-value="glow.size"
						:min="0"
						:max="MAX_PIXELS"
						:size="size"
						:disabled="disabled"
						class="w-full"
						:aria-label="ariaLabel('Glow size')"
						@update:model-value="editGlow({ size: $event ?? 0 })"
					/>
				</UFormField>
				<UFormField label="Glow opacity" :size="size">
					<UIOpacityInput
						:model-value="glow.opacity"
						:size="size"
						:disabled="disabled"
						class="w-full"
						:aria-label="ariaLabel('Glow opacity')"
						@update:model-value="editGlow({ opacity: $event ?? 1 })"
					/>
				</UFormField>
				<UFormField v-if="glowPosition" label="Glow position" :size="size">
					<USelect
						:model-value="glow.position ?? 'both'"
						:items="GLOW_POSITION_OPTIONS"
						value-key="value"
						:size="size"
						:disabled="disabled"
						class="w-full"
						:aria-label="ariaLabel('Glow position')"
						@update:model-value="editGlow({ position: $event as FeatureMatchOverlayGlowPosition })"
					/>
				</UFormField>
			</div>
		</template>
	</div>
</template>
