<script setup lang="ts">
import type { FeatureMatchOverlayAnchorValue, FeatureMatchOverlayRect } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayGeometryField } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlayGeometryUnit } from '~/utils/featureMatchOverlayGeometry';
import { displayGeometryValue, featureMatchOverlayAlignedStart } from '~/utils/featureMatchOverlayGeometry';

const props = defineProps<{
	rect: FeatureMatchOverlayRect;
	screenWidth: number;
	screenHeight: number;
	anchorValue: FeatureMatchOverlayAnchorValue;
	aspectLinked?: boolean;
}>();

const emit = defineEmits<{
	updateAnchor: [value: FeatureMatchOverlayAnchorValue];
	updateAspectLinked: [value: boolean];
	update: [field: FeatureMatchOverlayGeometryField, value: string, unit: FeatureMatchOverlayGeometryUnit];
	/** A stored top-left position, not an anchored one: alignment moves the item's edge. */
	align: [position: Pick<FeatureMatchOverlayRect, 'x'> | Pick<FeatureMatchOverlayRect, 'y'>];
}>();

const unit = ref<FeatureMatchOverlayGeometryUnit>('px');
const unitOptions = [
	{ label: 'px', value: 'px' },
	{ label: '%', value: '%' },
	{ label: '±16', value: 'center' },
] satisfies Array<{ label: string; value: FeatureMatchOverlayGeometryUnit }>;

const horizontalAlignControls = [
	{ label: 'Hard left', value: 'left', icon: 'i-lucide-align-start-vertical' },
	{ label: 'Center horizontally', value: 'center', icon: 'i-lucide-align-center-vertical' },
	{ label: 'Hard right', value: 'right', icon: 'i-lucide-align-end-vertical' },
] as const;

const verticalAlignControls = [
	{ label: 'Hard top', value: 'top', icon: 'i-lucide-align-start-horizontal' },
	{ label: 'Center vertically', value: 'center', icon: 'i-lucide-align-center-horizontal' },
	{ label: 'Hard bottom', value: 'bottom', icon: 'i-lucide-align-end-horizontal' },
] as const;

function totalFor(field: FeatureMatchOverlayGeometryField) {
	return field === 'x' || field === 'width' ? props.screenWidth : props.screenHeight;
}

function displayValue(field: FeatureMatchOverlayGeometryField) {
	return displayGeometryValue(props.rect[field], totalFor(field), unit.value, field === 'x' || field === 'y');
}

function inputStep() {
	return unit.value === 'center' ? '0.01' : '1';
}

function unitLabel() {
	return unit.value === 'center' ? '±16' : unit.value;
}

function alignHorizontal(alignment: 'left' | 'center' | 'right') {
	emit('align', { x: featureMatchOverlayAlignedStart(alignment, props.screenWidth, props.rect.width) });
}

function alignVertical(alignment: 'top' | 'center' | 'bottom') {
	emit('align', { y: featureMatchOverlayAlignedStart(alignment, props.screenHeight, props.rect.height) });
}
</script>

<template>
	<div class="space-y-3">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<slot name="toolbar-left" />
			</div>
			<UFormField label="Units" size="xs" class="flex items-center justify-end gap-2">
				<UFieldGroup size="xs">
					<UButton
						v-for="option in unitOptions"
						:key="option.value"
						:label="option.label"
						color="neutral"
						:variant="unit === option.value ? 'solid' : 'outline'"
						@click="() => { unit = option.value }"
					/>
				</UFieldGroup>
			</UFormField>
		</div>

		<div class="grid gap-4">
			<div class="grid gap-4 sm:grid-cols-[auto_auto] sm:justify-start">
				<UFormField label="Anchor">
					<UINinePointPicker
						:model-value="anchorValue"
						aria-label="Anchor"
						@update:model-value="emit('updateAnchor', $event)"
					/>
				</UFormField>

				<UFormField label="Align">
					<div class="space-y-2">
						<div class="grid grid-cols-3 gap-1">
							<UButton
								v-for="control in horizontalAlignControls"
								:key="control.value"
								:aria-label="control.label"
								:title="control.label"
								:icon="control.icon"
								size="xs"
								color="neutral"
								variant="soft"
								class="size-7 justify-center p-0"
								@click="alignHorizontal(control.value)"
							/>
						</div>
						<div class="grid grid-cols-3 gap-1">
							<UButton
								v-for="control in verticalAlignControls"
								:key="control.value"
								:aria-label="control.label"
								:title="control.label"
								:icon="control.icon"
								size="xs"
								color="neutral"
								variant="soft"
								class="size-7 justify-center p-0"
								@click="alignVertical(control.value)"
							/>
						</div>
					</div>
				</UFormField>
			</div>

			<div class="grid gap-3">
				<div class="grid gap-3 sm:grid-cols-2">
					<UFormField :label="`x (${unitLabel()})`">
						<UInputNumber
							:model-value="Number(displayValue('x'))"
							:step="Number(inputStep())"
							size="sm"
							class="w-full"
							@update:model-value="emit('update', 'x', String($event), unit)"
						/>
					</UFormField>
					<UFormField :label="`y (${unitLabel()})`">
						<UInputNumber
							:model-value="Number(displayValue('y'))"
							:step="Number(inputStep())"
							size="sm"
							class="w-full"
							@update:model-value="emit('update', 'y', String($event), unit)"
						/>
					</UFormField>
				</div>

				<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
					<UFormField :label="`width (${unitLabel()})`">
						<UInputNumber
							:model-value="Number(displayValue('width'))"
							:step="Number(inputStep())"
							size="sm"
							class="w-full"
							@update:model-value="emit('update', 'width', String($event), unit)"
						/>
					</UFormField>
					<UFormField :label="`height (${unitLabel()})`">
						<UInputNumber
							:model-value="Number(displayValue('height'))"
							:step="Number(inputStep())"
							size="sm"
							class="w-full"
							@update:model-value="emit('update', 'height', String($event), unit)"
						/>
					</UFormField>
					<div v-if="aspectLinked !== undefined" class="flex sm:pb-px">
						<UButton
							:aria-label="aspectLinked ? 'Unlink width and height' : 'Link width and height'"
							:title="aspectLinked ? 'Unlink width and height' : 'Link width and height'"
							:icon="aspectLinked ? 'i-lucide-link' : 'i-lucide-unlink'"
							size="xs"
							color="primary"
							:variant="aspectLinked ? 'solid' : 'soft'"
							class="size-8 justify-center p-0"
							@click="emit('updateAspectLinked', !aspectLinked)"
						/>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
