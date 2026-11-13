<script setup lang="ts">
import type { Seat } from '~~/shared/types/enums';
import type { CommanderDeckListEntry, CommanderDeckListPreview, CommanderDeckListRefusal, FeatureMatchDeckListReference } from '~~/shared/types/featureMatchDeckList';
import { MAX_SEAT_COMMANDERS } from '~~/shared/utils/commander';

/**
 * A Commander Seat's Feature Match Deck List (ADR-0087): a deck copied from
 * Moxfield, previewed with each card as the printing its line names, then
 * saved straight to the Seat with the Commanders its operator confirmed.
 * Where a copy puts its Commander is the exporting site's convention, so the
 * preview only offers one.
 */
const props = defineProps<{
	slotId: number;
	seat: Seat;
	deckList: FeatureMatchDeckListReference | null;
	/** While the setup form holds unsaved changes, which a save here would race. */
	locked: boolean;
}>();

const emit = defineEmits<{
	/** Take the list off the Seat: an edit of the setup form, saved with it. */
	clear: [];
}>();

const eventStore = useEventStore();
const featureMatchStore = useFeatureMatchStore();
const repository = useFeatureMatchDeckListRepository();
const { runRequest } = useRequestFeedback();

const open = ref(false);
const text = ref('');
const preview = ref<CommanderDeckListPreview | null>(null);
const refusals = ref<CommanderDeckListRefusal[]>([]);
/** The text `preview` answers; a save sends exactly what was previewed. */
const previewedText = ref<string | null>(null);
/** The printings confirmed as the Commanders, in the order picked. */
const commanders = ref<string[]>([]);
const previewing = ref(false);
const saving = ref(false);
const previewError = ref<string | null>(null);

const cardCount = computed(() => preview.value?.entries.reduce((total, entry) => total + entry.quantity, 0) ?? 0);
const canSave = computed(() => preview.value !== null
	&& previewedText.value === text.value
	&& commanders.value.length > 0);

function isCommander(entry: CommanderDeckListEntry) {
	return commanders.value.includes(entry.scryfallId);
}

function toggleCommander(entry: CommanderDeckListEntry) {
	commanders.value = isCommander(entry)
		? commanders.value.filter(id => id !== entry.scryfallId)
		: [...commanders.value, entry.scryfallId];
}

function printingLabel(entry: CommanderDeckListEntry) {
	return [
		entry.setCode.toUpperCase(),
		entry.collectorNumber,
	].filter(Boolean).join(' ');
}

function forgetPreview() {
	preview.value = null;
	refusals.value = [];
	previewedText.value = null;
	commanders.value = [];
	previewError.value = null;
}

async function openPaste() {
	text.value = '';
	forgetPreview();
	open.value = true;
	const eventId = eventStore.eventId;
	if (!eventId || !props.deckList)
		return;
	const saved = await runRequest(
		() => repository.readCommander(eventId, props.slotId, props.deckList!.id),
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
		() => repository.previewCommander(eventId, props.slotId, submitted),
		{ loadingRef: previewing, errorRef: previewError, error: false },
	);
	if (!answer)
		return;
	forgetPreview();
	if (answer.ok) {
		preview.value = answer.deckList;
		commanders.value = [...answer.deckList.offeredCommanders];
		previewedText.value = submitted;
	}
	else {
		refusals.value = answer.errors;
	}
}

async function save() {
	const eventId = eventStore.eventId;
	if (!eventId || !canSave.value)
		return;
	const submitted = text.value;
	await runRequest(
		() => repository.saveCommander(eventId, props.slotId, props.seat, submitted, commanders.value),
		{
			loadingRef: saving,
			success: { title: 'Deck List saved', color: 'success' },
			error: { title: 'Failed to save the Deck List', color: 'error' },
			onSuccess: (answer) => {
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
			<div class="flex items-center gap-2">
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
					v-if="deckList"
					label="Clear"
					icon="i-lucide-x"
					color="neutral"
					variant="ghost"
					size="sm"
					aria-label="Clear Deck List"
					@click="emit('clear')"
				/>
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

	<UModal
		v-model:open="open"
		title="Paste Deck List"
		description="A deck copied from Moxfield. “Copy for Moxfield” keeps each card's printing; its Sideboard is left out."
	>
		<template #body>
			<div class="flex flex-col gap-3">
				<UTextarea
					v-model="text"
					:rows="10"
					class="w-full font-mono"
					placeholder="1 Atraxa, Praetors' Voice (CM2) 10&#10;1 Sol Ring (C21) 263"
					aria-label="Deck List text"
				/>
				<p v-if="previewError" class="text-sm text-error">
					{{ previewError }}
				</p>

				<ul v-if="refusals.length > 0" class="flex flex-col gap-1" aria-label="Lines that refuse the paste">
					<li
						v-for="(refusal, index) in refusals"
						:key="`${refusal.code}-${index}`"
						:data-refusal-code="refusal.code"
						:data-line="refusal.lineNumber"
					>
						<UAlert
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							:title="refusal.lineNumber ? `Line ${refusal.lineNumber}: ${refusal.message}` : refusal.message"
							:description="refusal.sourceText"
						/>
					</li>
				</ul>

				<template v-if="preview">
					<p class="text-sm text-muted">
						{{ cardCount }} cards.
						<span v-if="preview.sideboardDropped > 0" :data-sideboard-dropped="preview.sideboardDropped">
							{{ preview.sideboardDropped }} Sideboard {{ preview.sideboardDropped === 1 ? 'card' : 'cards' }} left out.
						</span>
					</p>
					<p class="text-sm">
						Confirm the Commanders: one or two of these cards.
					</p>
					<p v-if="commanders.length === 0" class="text-sm text-error" data-no-commander>
						Pick a Commander to save.
					</p>
					<ul class="flex max-h-72 flex-col gap-1 overflow-y-auto" aria-label="Deck List cards">
						<li
							v-for="entry in preview.entries"
							:key="entry.scryfallId"
							class="flex items-center gap-2 text-sm"
							data-deck-list-entry
							:data-printing="entry.scryfallId"
							:data-commander="isCommander(entry)"
						>
							<span class="w-6 text-right tabular-nums">{{ entry.quantity }}</span>
							<span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
							<span class="text-muted">{{ printingLabel(entry) }}</span>
							<UButton
								label="Commander"
								size="xs"
								:color="isCommander(entry) ? 'primary' : 'neutral'"
								:variant="isCommander(entry) ? 'solid' : 'outline'"
								:aria-label="`Commander: ${entry.name}`"
								:aria-pressed="isCommander(entry)"
								:disabled="!isCommander(entry) && commanders.length >= MAX_SEAT_COMMANDERS"
								@click="toggleCommander(entry)"
							/>
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
