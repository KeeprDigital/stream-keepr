<script setup lang="ts">
import { formatEditableColor, parseEditableColor } from '~/utils/editableColor';

// Attributes (a test id, an aria-label) belong on the swatch trigger: the
// popover root renders no element of its own to carry them.
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
	modelValue?: string;
	placeholder?: string;
	allowRawValue?: boolean;
	/** Shows Clear, which emits `undefined`: the field falls back to whatever it inherits. */
	clearable?: boolean;
	/**
	 * `live` emits every change, a drag included. `close` emits once, when the
	 * popover closes, for a field whose every write reaches the outputs.
	 */
	commit?: 'live' | 'close';
	disabled?: boolean;
	size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
} & (
	| {
		/**
		 * Edits the colour's own alpha: a slider and a % field, and Transparent
		 * (alpha 0, the hue kept). Off where an opacity control sits beside the colour.
		 */
		alpha: true;
		hexOnly?: false;
	}
	| {
		alpha?: false;
		/**
		 * For values that must always be a hex colour: no alpha, and a typed value
		 * is emitted only once it is a complete `#rrggbb`.
		 */
		hexOnly?: boolean;
	}
)>(), {
	size: 'sm',
	commit: 'live',
});

const emit = defineEmits<{
	(e: 'update:modelValue', value: string | undefined): void;
}>();

const HEX_COLOR_RE = /^#[0-9A-F]{6}$/i;
/** A typed hex names a hue only, so it keeps the alpha shown beside it. */
const HUE_ONLY_RE = /^#(?:[0-9A-F]{3}|[0-9A-F]{6})$/i;

const open = ref(false);
/** What a `commit="close"` edit holds until the popover closes. */
const draft = ref<string | undefined>();

const value = computed(() => (props.commit === 'close' && open.value
	? draft.value
	: props.modelValue)?.trim() || undefined);
const parsed = computed(() => value.value === undefined
	? null
	: parseEditableColor(value.value));
const alphaPercent = computed(() => Math.round((parsed.value?.alpha ?? 1) * 100));

const swatchState = computed(() => {
	if (value.value === undefined)
		return 'unset';
	return parsed.value
		? 'colour'
		: 'raw';
});

watch(open, (isOpen) => {
	if (props.commit !== 'close')
		return;
	if (isOpen)
		draft.value = props.modelValue;
	else if (draft.value !== props.modelValue)
		emit('update:modelValue', draft.value);
});

function apply(next: string | undefined) {
	if (props.commit === 'close')
		draft.value = next;
	else
		emit('update:modelValue', next);
}

function pickHue(hex: string | undefined) {
	if (!hex)
		return;
	apply(formatEditableColor({
		hex,
		alpha: props.hexOnly
			? 1
			: parsed.value?.alpha ?? 1,
	}));
}

function setAlpha(percent: number | null | undefined) {
	if (!parsed.value || typeof percent !== 'number' || Number.isNaN(percent))
		return;
	apply(formatEditableColor({ hex: parsed.value.hex, alpha: percent / 100 }));
}

// The text field shows the hex beside the alpha field, or the whole value. It
// follows the colour except while it is being typed into.
const textShown = computed(() => props.alpha && parsed.value
	? parsed.value.hex
	: value.value ?? '');
const typed = ref(textShown.value);
const typing = ref(false);
watch(textShown, (text) => {
	if (!typing.value)
		typed.value = text;
});

function endTyping() {
	typing.value = false;
	typed.value = textShown.value;
}

function handleTypedValue(text: string | number | null | undefined) {
	typed.value = String(text ?? '');
	const entered = typed.value.trim();
	if (!entered) {
		if (props.clearable)
			apply(undefined);
		return;
	}
	if (props.hexOnly) {
		if (HEX_COLOR_RE.test(entered))
			apply(entered.toLowerCase());
		return;
	}
	const color = parseEditableColor(entered);
	if (color) {
		apply(formatEditableColor({
			hex: color.hex,
			alpha: props.alpha && parsed.value && HUE_ONLY_RE.test(entered)
				? parsed.value.alpha
				: color.alpha,
		}));
		return;
	}
	if (props.allowRawValue)
		apply(entered);
}

function setTransparent() {
	apply(formatEditableColor({ hex: parsed.value?.hex ?? '#000000', alpha: 0 }));
	open.value = false;
}

function clear() {
	apply(undefined);
	open.value = false;
}

const textPlaceholder = computed(() => props.placeholder || (props.allowRawValue
	? 'transparent, #ffffff, linear-gradient(...)'
	: '#ffffff'));

/** The alpha track runs from clear to the opaque colour, over the checkerboard. */
const alphaTrackStyle = computed(() => {
	const hex = parsed.value?.hex ?? '#000000';
	return { backgroundImage: `linear-gradient(to right, ${hex}00, ${hex})` };
});
</script>

<template>
	<UPopover v-model:open="open">
		<!-- Trigger: the colour, its alpha shown over a checkerboard -->
		<UButton
			color="neutral"
			variant="outline"
			:size="size"
			class="checkerboard relative min-w-8 overflow-hidden rounded-md"
			:disabled="disabled"
			aria-label="Choose color"
			:data-color-state="swatchState"
			:data-color-alpha="parsed ? alphaPercent : undefined"
			v-bind="$attrs"
		>
			<span
				v-if="value !== undefined"
				class="absolute inset-0"
				data-color-swatch
				:style="{ background: value }"
			/>
			&nbsp;
		</UButton>

		<template #content>
			<div class="flex w-60 flex-col gap-3 p-2">
				<UColorPicker
					:model-value="parsed?.hex ?? '#000000'"
					size="sm"
					aria-label="Hue and saturation"
					data-color-part="hue"
					@update:model-value="pickHue"
				/>

				<div v-if="alpha" class="checkerboard rounded-full">
					<div class="rounded-full px-1" :style="alphaTrackStyle">
						<USlider
							:model-value="alphaPercent"
							:min="0"
							:max="100"
							:step="1"
							size="sm"
							color="neutral"
							:disabled="!parsed"
							:ui="{ track: 'bg-transparent', range: 'bg-transparent' }"
							aria-label="Alpha"
							data-color-part="alpha"
							@update:model-value="setAlpha"
						/>
					</div>
				</div>

				<div class="flex items-center gap-2">
					<UInput
						:model-value="typed"
						:placeholder="textPlaceholder"
						size="sm"
						class="min-w-0 flex-1 font-mono"
						aria-label="Colour value"
						data-color-part="text"
						@focus="typing = true"
						@blur="endTyping"
						@update:model-value="handleTypedValue"
					/>
					<UInputNumber
						v-if="alpha"
						:model-value="alphaPercent"
						:min="0"
						:max="100"
						:step="1"
						size="sm"
						class="w-24"
						:disabled="!parsed"
						:format-options="{ style: 'unit', unit: 'percent', maximumFractionDigits: 0 }"
						aria-label="Alpha percent"
						data-color-part="alpha-percent"
						@update:model-value="setAlpha"
					/>
				</div>

				<UButton
					v-if="alpha"
					variant="soft"
					color="neutral"
					size="sm"
					block
					:aria-pressed="parsed?.alpha === 0"
					:class="parsed?.alpha === 0 ? 'ring-2 ring-primary' : ''"
					data-color-part="transparent"
					@click="setTransparent"
				>
					<div class="checkerboard mr-2 size-4 rounded" />
					Transparent
				</UButton>

				<UButton
					v-if="clearable"
					variant="ghost"
					color="neutral"
					size="sm"
					block
					icon="i-lucide-eraser"
					data-color-part="clear"
					@click="clear"
				>
					Clear
				</UButton>
			</div>
		</template>
	</UPopover>
</template>

<style scoped>
.checkerboard {
	background-image:
		linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
	background-size: 8px 8px;
	background-position:
		0 0,
		0 4px,
		4px -4px,
		-4px 0px;
}
</style>
