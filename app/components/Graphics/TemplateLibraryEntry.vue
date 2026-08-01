<script setup lang="ts">
/**
 * One entry in a graphics Template library, as an author reads and revises it.
 *
 * The rule worth sharing is which fields are offered at all. An entry a Template Package
 * installed is the Graphics Asset Library's own record of what it published, and this
 * library never writes one — so a name or description field on it would be a control
 * that cannot save, which is a control that lies. It is still browsed, placed, and
 * exported like any other, and changed by placing it and saving the placed copy.
 *
 * What each library counts, what each entry can have done to it, and what a two-click
 * action says before it happens all stay with the library, through the slots.
 */
const props = defineProps<{
	templateId: string;
	name: string;
	description: string | null;
	revision: number;
	/** Whether this installation authored the entry, rather than a Template Package. */
	authored: boolean;
	icon: string;
	/** This library's prefix for its per-entry test ids. */
	testId: string;
	/** Whether this entry's own fields may be written here. */
	revisable?: boolean;
	/** Whether this session may author, which is what the actions are offered on. */
	writable?: boolean;
}>();

const emit = defineEmits<{
	rename: [name: string];
	describe: [description: string | null];
}>();

function onNameChanged(event: Event) {
	const next = (event.target as HTMLInputElement).value.trim();
	if (next.length === 0 || next === props.name)
		return;
	emit('rename', next);
}

/** An emptied description clears it rather than storing an empty string. */
function onDescriptionChanged(event: Event) {
	const next = (event.target as HTMLInputElement).value.trim();
	if (next === (props.description ?? ''))
		return;
	emit('describe', next.length === 0 ? null : next);
}
</script>

<template>
	<div class="rounded-lg border border-default/70 bg-muted/20 p-2" :data-template-id="templateId">
		<div class="flex items-start gap-2">
			<UIcon :name="icon" class="mt-1 size-4 shrink-0 text-muted" />
			<div class="min-w-0 flex-1">
				<UInput
					v-if="revisable"
					:model-value="name"
					size="xs"
					class="w-full"
					aria-label="Template name"
					:data-testid="`${testId}-name`"
					@change="onNameChanged"
				/>
				<p v-else class="truncate text-sm font-medium">
					{{ name }}
				</p>
				<p class="mt-0.5 truncate text-xs text-muted">
					<slot name="meta" /> · revision {{ revision }}<span
						v-if="!authored"
						:data-testid="`${testId}-imported`"
					> · imported</span>
				</p>
				<UInput
					v-if="revisable"
					:model-value="description ?? ''"
					size="xs"
					class="mt-1 w-full"
					placeholder="Description"
					aria-label="Template description"
					:data-testid="`${testId}-description`"
					@change="onDescriptionChanged"
				/>
				<p v-else-if="description" class="mt-0.5 truncate text-xs text-muted">
					{{ description }}
				</p>

				<!-- Anything this library shows about the entry beyond its own fields. -->
				<slot name="detail" />
			</div>
			<div v-if="writable" class="flex shrink-0 gap-1">
				<slot name="actions" />
			</div>
		</div>

		<!-- Whatever this entry is currently asking the author, if anything. -->
		<slot />
	</div>
</template>
