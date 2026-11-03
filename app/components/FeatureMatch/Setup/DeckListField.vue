<script setup lang="ts">
import type { PlayerSide } from '~~/shared/types/enums';
import type { FeatureMatchDeckListReference, FeatureMatchDeckListView } from '~~/shared/types/featureMatchDeckList';

/**
 * A Slot side's Feature Match Deck List (ADR-0057): pasted as
 * `N[x] CARDNUMBER [name]` lines, previewed with its resolved cards and
 * warnings, then saved straight to the side. Warnings never stop a save.
 */
const props = defineProps<{
	slotId: number;
	/** The Slot's own side. */
	side: PlayerSide;
	deckList: FeatureMatchDeckListReference | null;
	/** While the setup form holds unsaved changes, which a save here would race. */
	locked: boolean;
}>();

const eventStore = useEventStore();
const featureMatchStore = useFeatureMatchStore();
const repository = useFeatureMatchDeckListRepository();
const { runRequest } = useRequestFeedback();

const open = ref(false);
const text = ref('');
const preview = ref<FeatureMatchDeckListView | null>(null);
/** The text `preview` answers; a save sends exactly what was previewed. */
const previewedText = ref<string | null>(null);
/** `false` while this installation has no bandai-keepr configured. */
const available = ref(true);
const previewing = ref(false);
const saving = ref(false);
const previewError = ref<string | null>(null);

const canSave = computed(() => available.value
	&& preview.value !== null
	&& previewedText.value === text.value);

async function openPaste() {
	text.value = '';
	preview.value = null;
	previewedText.value = null;
	previewError.value = null;
	available.value = true;
	open.value = true;
	const eventId = eventStore.eventId;
	if (!eventId || !props.deckList)
		return;
	const saved = await runRequest(
		() => repository.read(eventId, props.slotId, props.deckList!.id),
		{ error: false },
	);
	if (saved && !text.value)
		text.value = saved.sourceText;
}

async function runPreview() {
	const eventId = eventStore.eventId;
	if (!eventId)
		return;
	const submitted = text.value;
	const answer = await runRequest(
		() => repository.preview(eventId, props.slotId, submitted),
		{ loadingRef: previewing, errorRef: previewError, error: false },
	);
	if (!answer)
		return;
	available.value = answer.available;
	preview.value = answer.available
		? answer.deckList
		: null;
	previewedText.value = submitted;
}

async function save() {
	const eventId = eventStore.eventId;
	if (!eventId || !canSave.value)
		return;
	const submitted = text.value;
	await runRequest(
		() => repository.save(eventId, props.slotId, props.side, submitted),
		{
			loadingRef: saving,
			isSuccess: answer => answer.available,
			success: { title: 'Deck List saved', color: 'success' },
			error: { title: 'Failed to save the Deck List', color: 'error' },
			onSuccess: (answer) => {
				if (answer.available)
					featureMatchStore.applySavedSlot(answer.featureMatch);
				open.value = false;
			},
		},
	);
}
</script>

<template>
	<UFormField label="Deck List" name="deckList" class="w-full">
		<div class="flex flex-col gap-2">
			<div class="flex items-center gap-3">
				<p
					v-if="deckList"
					class="flex-1 text-sm"
					data-deck-list
					:data-mainboard-count="deckList.mainboardCount"
				>
					{{ deckList.mainboardCount }} Mainboard cards
				</p>
				<p v-else class="flex-1 text-sm text-muted">
					No Deck List
				</p>
				<UButton
					:label="deckList ? 'Replace' : 'Paste'"
					icon="i-lucide-clipboard-paste"
					color="neutral"
					variant="outline"
					size="sm"
					aria-label="Paste Deck List"
					:disabled="locked"
					@click="openPaste"
				/>
			</div>
			<p v-if="locked" class="text-sm text-muted">
				Save or reset this match's changes to paste a Deck List.
			</p>
		</div>
	</UFormField>

	<UModal v-model:open="open" title="Paste Deck List" description="One card per line: N[x] CARDNUMBER [name]. Headings and blank lines are ignored.">
		<template #body>
			<div class="flex flex-col gap-3">
				<UTextarea
					v-model="text"
					:rows="10"
					class="w-full font-mono"
					placeholder="1x OP01-001 Roronoa Zoro&#10;4x OP01-025 Roronoa Zoro"
					aria-label="Deck List text"
				/>
				<p v-if="!available" class="text-sm text-muted">
					Card data unavailable: no bandai-keepr is configured for this installation.
				</p>
				<p v-else-if="previewError" class="text-sm text-error">
					{{ previewError }}
				</p>

				<template v-if="preview">
					<ul class="flex flex-col gap-1" aria-label="Deck List warnings">
						<li v-for="warning in preview.warnings" :key="warning.code">
							<UAlert
								color="warning"
								variant="subtle"
								icon="i-lucide-triangle-alert"
								:title="warning.message"
								:data-warning-code="warning.code"
							/>
						</li>
					</ul>
					<p class="text-sm text-muted">
						{{ preview.mainboardCount }} Mainboard cards
					</p>
					<ul class="flex max-h-72 flex-col gap-1 overflow-y-auto" aria-label="Deck List cards">
						<li
							v-for="entry in preview.entries"
							:key="entry.number"
							class="flex items-center gap-2 text-sm"
							data-deck-list-entry
							:data-number="entry.number"
							:data-resolved="entry.card !== null"
						>
							<span class="w-6 text-right tabular-nums">{{ entry.quantity }}</span>
							<span class="w-20 text-muted">{{ entry.number }}</span>
							<span class="min-w-0 flex-1 truncate">
								{{ entry.card?.name ?? 'Unknown card' }}
								<span v-if="entry.number === preview.leaderNumber" class="text-muted">(Leader)</span>
							</span>
							<OpColorDisplay v-if="entry.card" :colors="entry.card.colors" size="sm" />
						</li>
					</ul>
				</template>
			</div>
		</template>
		<template #footer>
			<div class="flex w-full justify-end gap-2">
				<UButton
					label="Preview"
					color="neutral"
					variant="outline"
					aria-label="Preview Deck List"
					:loading="previewing"
					:disabled="!text.trim()"
					@click="runPreview"
				/>
				<UButton
					label="Save"
					color="primary"
					aria-label="Save Deck List"
					:loading="saving"
					:disabled="!canSave"
					@click="save"
				/>
			</div>
		</template>
	</UModal>
</template>
