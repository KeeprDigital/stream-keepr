<script setup lang="ts">
// Attributes (a test id, an aria-label) belong on the swatch trigger: the
// popover root renders no element of its own to carry them.
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
	modelValue?: string;
	placeholder?: string;
	allowRawValue?: boolean;
	/**
	 * For values that must always be a hex colour: no Transparent choice, and a
	 * typed value is emitted only once it is a complete `#rrggbb`.
	 */
	hexOnly?: boolean;
	disabled?: boolean;
	size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}>(), {
	size: 'sm',
});

const emit = defineEmits<{
	(e: 'update:modelValue', value: string | undefined): void;
}>();

const HEX_COLOR_RE = /^#[0-9A-F]{6}$/i;
const TRANSPARENT_COLOR_RE = /^transparent$/i;

const open = ref(false);

const rawValue = computed(() => props.modelValue?.trim() || '');
const isTransparent = computed(() => !rawValue.value || TRANSPARENT_COLOR_RE.test(rawValue.value));
const isHexColor = computed(() => HEX_COLOR_RE.test(rawValue.value));

// Ensure valid hex for the picker
const pickerValue = computed(() => {
	const val = rawValue.value;
	return HEX_COLOR_RE.test(val) ? val : '#000000';
});

const previewStyle = computed(() => {
	if (isTransparent.value) {
		return {};
	}

	if (props.allowRawValue && !isHexColor.value) {
		return { background: rawValue.value };
	}

	return { backgroundColor: pickerValue.value };
});

function handleColorChange(value: string | undefined) {
	emit('update:modelValue', value);
}

function handleTypedValue(value: string) {
	if (props.hexOnly) {
		if (HEX_COLOR_RE.test(value))
			emit('update:modelValue', value);
		return;
	}
	emit('update:modelValue', value || undefined);
}

function setTransparent() {
	emit('update:modelValue', '');
	open.value = false;
}
</script>

<template>
	<UPopover v-model:open="open">
		<!-- Trigger: Color swatch button -->
		<UButton
			color="neutral"
			variant="outline"
			:size="size"
			class="min-w-8 rounded-md"
			:class="isTransparent ? 'checkerboard' : ''"
			:style="previewStyle"
			:disabled="disabled"
			aria-label="Choose color"
			v-bind="$attrs"
		>
			&nbsp;
		</UButton>

		<!-- Popover content -->
		<template #content>
			<div class="flex flex-col gap-3 p-1">
				<!-- Color picker -->
				<UColorPicker
					:model-value="pickerValue"
					size="sm"
					@update:model-value="handleColorChange"
				/>

				<!-- Hex input -->
				<UInput
					:model-value="modelValue || ''"
					:placeholder="placeholder || (allowRawValue ? 'transparent, #ffffff, linear-gradient(...)' : '#ffffff')"
					size="sm"
					@update:model-value="handleTypedValue"
				/>

				<!-- Transparent option -->
				<UButton
					v-if="!hexOnly"
					variant="soft"
					color="neutral"
					size="sm"
					block
					:class="isTransparent ? 'ring-2 ring-primary' : ''"
					@click="setTransparent"
				>
					<div class="w-4 h-4 checkerboard rounded mr-2" />
					Transparent
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
