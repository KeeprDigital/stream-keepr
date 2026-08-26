<script setup lang="ts">
import type { AnimationEffectSelection } from '~~/shared/animationEffects';
import type { AnimationEffectPresetResponse } from '~~/shared/types/animationEffectPreset';

const props = defineProps<{
	selection: AnimationEffectSelection;
}>();

const emit = defineEmits<{
	apply: [selection: AnimationEffectSelection];
}>();

const repository = useAnimationEffectPresetRepository();
const presets = ref<AnimationEffectPresetResponse[]>([]);
const selectedId = ref('');
const name = ref('');
const busy = ref(false);
const loading = ref(true);
const error = ref<string | null>(null);
const confirmingDelete = ref(false);

const selected = computed(() => presets.value.find(preset => preset.id === selectedId.value));

watch(selectedId, () => {
	if (selected.value)
		name.value = selected.value.name;
	confirmingDelete.value = false;
});

function failureMessage(caught: unknown): string {
	if (caught && typeof caught === 'object' && 'data' in caught) {
		const data = caught.data as { message?: unknown } | undefined;
		if (typeof data?.message === 'string')
			return data.message;
	}
	return caught instanceof Error ? caught.message : 'The Animation Effect Preset action failed';
}

async function refresh(preferredId?: string) {
	presets.value = await repository.list();
	const nextId = preferredId && presets.value.some(preset => preset.id === preferredId)
		? preferredId
		: selectedId.value && presets.value.some(preset => preset.id === selectedId.value)
			? selectedId.value
			: presets.value[0]?.id ?? '';
	selectedId.value = nextId;
	if (selected.value)
		name.value = selected.value.name;
}

async function attempt(action: () => Promise<void>) {
	if (busy.value)
		return;
	busy.value = true;
	error.value = null;
	try {
		await action();
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		busy.value = false;
	}
}

function apply() {
	if (!selected.value)
		return;
	emit('apply', {
		effect: selected.value.selection.effect,
		...(selected.value.selection.params ? { params: { ...selected.value.selection.params } } : {}),
	} as AnimationEffectSelection);
}

async function save() {
	const presetName = name.value.trim();
	if (!presetName)
		return;
	await attempt(async () => {
		const created = await repository.create({ name: presetName, selection: props.selection });
		await refresh(created.id);
	});
}

async function replace() {
	const current = selected.value;
	const presetName = name.value.trim();
	if (!current || !presetName)
		return;
	await attempt(async () => {
		const updated = await repository.update(current.id, {
			name: presetName,
			revision: current.revision,
			selection: props.selection,
		});
		await refresh(updated.id);
	});
}

async function remove() {
	const current = selected.value;
	if (!current)
		return;
	await attempt(async () => {
		await repository.remove(current.id);
		selectedId.value = '';
		confirmingDelete.value = false;
		await refresh();
	});
}

async function importFile(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	if (!file)
		return;
	await attempt(async () => {
		const imported = await repository.importDocument(await file.text());
		await refresh(imported.id);
	});
	input.value = '';
}

onMounted(async () => {
	try {
		await refresh();
	}
	catch (caught) {
		error.value = failureMessage(caught);
	}
	finally {
		loading.value = false;
	}
});
</script>

<template>
	<div class="space-y-2 rounded-md border border-default p-3" data-testid="animation-effect-preset-library">
		<div>
			<p class="text-sm font-medium">
				Animation Effect Presets
			</p>
			<p class="text-xs text-muted">
				Shared across this installation. Applying copies only the effect and its parameters.
			</p>
		</div>

		<div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			<select
				v-model="selectedId"
				class="h-8 rounded-md border border-default bg-default px-2 text-sm"
				:disabled="loading || presets.length === 0"
				aria-label="Animation Effect Preset"
				data-testid="animation-effect-preset-select"
			>
				<option value="" disabled>
					{{ loading ? 'Loading presets…' : 'No presets saved' }}
				</option>
				<option v-for="preset in presets" :key="preset.id" :value="preset.id">
					{{ preset.name }} · r{{ preset.revision }}
				</option>
			</select>
			<input
				v-model="name"
				type="text"
				maxlength="100"
				placeholder="Preset name"
				aria-label="Preset name"
				class="h-8 rounded-md border border-default bg-default px-2 text-sm"
				data-testid="animation-effect-preset-name"
			>
		</div>

		<div class="flex flex-wrap items-center gap-1.5">
			<UButton
				size="xs"
				variant="soft"
				:disabled="!selected || busy"
				data-testid="animation-effect-preset-apply"
				@click="apply"
			>
				Apply
			</UButton>
			<UButton
				size="xs"
				color="neutral"
				variant="soft"
				:disabled="!name.trim() || busy"
				data-testid="animation-effect-preset-save"
				@click="save"
			>
				Save new
			</UButton>
			<UButton
				size="xs"
				color="neutral"
				variant="ghost"
				:disabled="!selected || !name.trim() || busy"
				data-testid="animation-effect-preset-replace"
				@click="replace"
			>
				Replace / rename
			</UButton>
			<UButton
				v-if="selected"
				size="xs"
				color="neutral"
				variant="ghost"
				:to="repository.exportUrl(selected.id)"
				external
				download
				data-testid="animation-effect-preset-export"
			>
				Export
			</UButton>
			<label class="cursor-pointer text-xs text-primary">
				Import .skeffect
				<input
					type="file"
					accept=".skeffect,application/json"
					class="sr-only"
					:disabled="busy"
					data-testid="animation-effect-preset-import"
					@change="importFile"
				>
			</label>
			<UButton
				v-if="selected && !confirmingDelete"
				size="xs"
				color="error"
				variant="ghost"
				:disabled="busy"
				data-testid="animation-effect-preset-delete"
				@click="confirmingDelete = true"
			>
				Delete
			</UButton>
			<template v-if="selected && confirmingDelete">
				<span class="text-xs text-error">Delete “{{ selected.name }}”?</span>
				<UButton
					size="xs"
					color="error"
					:disabled="busy"
					data-testid="animation-effect-preset-delete-confirm"
					@click="remove"
				>
					Confirm
				</UButton>
				<UButton
					size="xs"
					color="neutral"
					variant="ghost"
					:disabled="busy"
					@click="confirmingDelete = false"
				>
					Cancel
				</UButton>
			</template>
		</div>

		<UAlert
			v-if="error"
			color="error"
			variant="soft"
			title="Preset action failed"
			:description="error"
		/>
	</div>
</template>
