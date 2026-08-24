<script setup lang="ts">
import type { AnimationEffectName, AnimationEffectParamField, AnimationEffectParamValue, AnimationEffectSelection } from '~~/shared/animationEffects';
import {
	ANIMATION_EFFECT_CATALOGUE,
	ANIMATION_EFFECT_VALUES,
	animationEffectDefaultParams,
	animationEffectParamFields,
	isAnimationEffectHexColor,
} from '~~/shared/animationEffects';

/**
 * The shared Animation Effect editor: the effect select plus the schema-driven
 * param loop, under both hosts' editors (the Feature Match Overlay Frame and a
 * Background Layer). What a host adds around the selection — the Frame's
 * enabled/opacity, a layer's own — is the host's editor's business, exactly as
 * it is on the schema side.
 */
const props = defineProps<{
	selection: AnimationEffectSelection;
}>();

const emit = defineEmits<{
	(event: 'update:selection', selection: AnimationEffectSelection): void;
}>();

const ANIMATION_EFFECT_OPTIONS = ANIMATION_EFFECT_VALUES.map(value => ({
	value,
	label: ANIMATION_EFFECT_CATALOGUE[value].label,
}));

const paramFields = computed(() => animationEffectParamFields(props.selection.effect));

/** The authored bag may be sparse; the editor always shows the completed view. */
const params = computed<Record<string, AnimationEffectParamValue>>(() => ({
	...animationEffectDefaultParams(props.selection.effect) as Record<string, AnimationEffectParamValue>,
	...(props.selection.params ?? {}),
}));

/**
 * Switching effect starts from that effect's schema defaults: params are
 * per-effect, so nothing from the previous effect's bag can carry over.
 */
function selectEffect(effect: AnimationEffectName) {
	emit('update:selection', { effect } as AnimationEffectSelection);
}

function updateParam(field: AnimationEffectParamField, value: AnimationEffectParamValue | undefined) {
	let next = value;
	if (field.control === 'color') {
		if (next === undefined || next === '')
			next = field.defaultValue;
		else if (typeof next !== 'string' || !isAnimationEffectHexColor(next))
			return;
	}
	else if (field.control === 'toggle') {
		next = next === true;
	}
	else {
		const numeric = Number(next);
		if (!Number.isFinite(numeric))
			return;
		next = Math.min(field.max ?? numeric, Math.max(field.min ?? numeric, numeric));
	}
	// The full bag is written back, pinning every current value: a default that
	// changes in a later release must not restyle a selection an author has tuned.
	emit('update:selection', {
		effect: props.selection.effect,
		params: { ...params.value, [field.key]: next },
	} as AnimationEffectSelection);
}
</script>

<template>
	<div class="space-y-3">
		<UFormField label="Effect">
			<USelect
				:model-value="selection.effect"
				:items="ANIMATION_EFFECT_OPTIONS"
				value-key="value"
				size="sm"
				class="w-full"
				@update:model-value="selectEffect($event as AnimationEffectName)"
			/>
		</UFormField>

		<div class="grid gap-3 md:grid-cols-3">
			<template
				v-for="field in paramFields"
				:key="`${selection.effect}-${field.key}`"
			>
				<ScreenSettingsToggle
					v-if="field.control === 'toggle'"
					:label="field.label"
					:description="field.description"
					:model-value="Boolean(params[field.key])"
					@update:model-value="updateParam(field, $event)"
				/>
				<UFormField
					v-else
					:label="field.label"
				>
					<UIColorPicker
						v-if="field.control === 'color'"
						:model-value="String(params[field.key])"
						:placeholder="String(field.defaultValue)"
						@update:model-value="updateParam(field, $event)"
					/>
					<UInputNumber
						v-else
						:model-value="Number(params[field.key])"
						:min="field.min"
						:max="field.max"
						:step="field.step"
						size="sm"
						class="w-full"
						@update:model-value="updateParam(field, Number($event))"
					/>
				</UFormField>
			</template>
		</div>
	</div>
</template>
