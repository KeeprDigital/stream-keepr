<script setup lang="ts">
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { ScreenMediaSource } from '~~/shared/types/screenConfig';
import { screenMediaSourceReference } from '~~/shared/utils/graphicsAssetReferences';
import { remoteMediaUrlRefusal } from '~~/shared/utils/remoteMediaUrl';

/**
 * Picks one Screen Media Source — a Graphics Asset Library revision or a Remote
 * Media URL (ADR-0021). Every host of a Screen's own media uses this one field:
 * each image and video Background Layer, and the Feature Match Overlay Frame's
 * image and video.
 *
 * `null` means the author cleared the library choice; each host decides what
 * "no source" stores, since a Frame image may be absent and a layer may not.
 */
const props = defineProps<{
	modelValue: ScreenMediaSource | undefined;
	eventId: number;
	assetKind: 'image' | 'silent-video';
	/** Names the library picker, e.g. "Video asset". */
	label: string;
}>();

const emit = defineEmits<{
	'update:modelValue': [source: ScreenMediaSource | null];
}>();

const SOURCE_KIND_OPTIONS = [
	{ label: 'Asset library', value: 'asset' },
	{ label: 'Remote URL', value: 'url' },
];

/**
 * The kind the field is showing, held as UI state rather than written through:
 * a library-sourced Screen Media Source without a picked revision is not storable, so
 * switching to the library only changes what the field offers until an asset is
 * actually chosen. Switching to URL starts over — a reference and a URL are
 * different choices, not two spellings of one.
 */
const draftKind = ref<'asset' | 'url'>();
const kind = computed(() => draftKind.value ?? props.modelValue?.kind ?? 'asset');
const url = computed(() => props.modelValue?.kind === 'url'
	? props.modelValue.url
	: '');
/**
 * The server's own rule, shown as the author types: a refused URL would otherwise
 * surface only as a failed save of the whole stack or layout (#582).
 */
const urlRefusal = computed(() => remoteMediaUrlRefusal(url.value));
const reference = computed(() => screenMediaSourceReference(props.modelValue) ?? undefined);

function selectKind(next: 'asset' | 'url') {
	draftKind.value = next;
	if (next === 'url' && props.modelValue?.kind !== 'url')
		emit('update:modelValue', { kind: 'url', url: '' });
}

function selectAsset(selected: GraphicAssetReference) {
	emit('update:modelValue', { kind: 'asset', assetId: selected.assetId, revisionId: selected.revisionId });
}

/**
 * Only the picker's Clear reaches the configuration through this event: a
 * choose also fires `select`, which is the write, and a second write from here
 * would race it.
 */
function clearAsset(next: GraphicAssetReference | undefined) {
	if (next === undefined)
		emit('update:modelValue', null);
}
</script>

<template>
	<UFormField label="Source">
		<USelect
			:model-value="kind"
			:items="SOURCE_KIND_OPTIONS"
			value-key="value"
			size="sm"
			class="w-full"
			@update:model-value="selectKind($event as 'asset' | 'url')"
		/>
	</UFormField>

	<UFormField v-if="kind === 'url'" label="Remote Media URL" :error="urlRefusal">
		<UInput
			:model-value="url"
			:placeholder="assetKind === 'silent-video' ? 'https://example.com/background.webm' : 'https://example.com/background.png'"
			size="sm"
			class="w-full"
			@update:model-value="emit('update:modelValue', { kind: 'url', url: String($event) })"
		/>
	</UFormField>
	<UFormField v-else :label="label">
		<GraphicsAssetFocusPicker
			:model-value="reference"
			:event-id="eventId"
			:field-label="label"
			:asset-kind="assetKind"
			@select="(_asset, selected) => selectAsset(selected)"
			@update:model-value="clearAsset($event)"
		/>
	</UFormField>
</template>
