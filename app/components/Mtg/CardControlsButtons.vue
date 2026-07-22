<script lang="ts" setup>
import type { MtgPreviewCardAction } from '~/types/card/mtg';
import { LazyMtgCardPrinting } from '#components';

const cardStore = useCardStore();
const eventStore = useEventStore();

const {
	selectMeldCardPart,
} = cardStore;

const {
	previewCard,
	previewCardPrintings,
	activeCard,
	activeScreenId,
	cardsMatch,
} = storeToRefs(cardStore);

const modal = useOverlay().create(LazyMtgCardPrinting);

function openPrintList() {
	void modal.open({});
}

const hasOrientationControls = computed(() =>
	previewCard.value?.orientationData.turnable
	|| previewCard.value?.orientationData.rotateable
	|| previewCard.value?.orientationData.counterRotateable
	|| previewCard.value?.orientationData.flipable,
);

const canShowPreviewCard = computed(() => activeScreenId.value !== null);
const timeoutDraft = ref(eventStore.event?.cardTimeout ?? 0);

watch(() => eventStore.event?.cardTimeout, (value) => {
	timeoutDraft.value = value ?? 0;
});

const timeoutLabel = computed(() => {
	const seconds = eventStore.event?.cardTimeout ?? 0;
	return seconds > 0 ? `${seconds}s timeout` : 'No timeout';
});

async function saveTimeout() {
	const cardTimeout = Math.max(0, timeoutDraft.value ?? 0);
	timeoutDraft.value = cardTimeout;
	await eventStore.updateEvent({ cardTimeout });
}

function cardAction(action: MtgPreviewCardAction) {
	void cardStore.controlPreviewCard(action);
}
</script>

<template>
	<div v-if="previewCard" class="flex flex-col gap-2">
		<!-- Primary CTA: Show / Replace -->
		<UFieldGroup class="w-full">
			<UButton
				v-if="activeCard"
				variant="subtle"
				icon="i-lucide-replace"
				class="flex-1 justify-center"
				color="warning"
				:disabled="cardsMatch || !canShowPreviewCard"
				@click="cardAction('show')"
			>
				Replace
			</UButton>
			<UButton
				v-else
				variant="subtle"
				icon="i-lucide-eye"
				class="flex-1 justify-center"
				:disabled="!canShowPreviewCard"
				@click="cardAction('show')"
			>
				Show
			</UButton>
			<UPopover arrow :content="{ align: 'end', side: 'bottom' }">
				<UButton
					variant="subtle"
					:color="activeCard ? 'warning' : 'primary'"
					icon="i-lucide-chevron-down"
					:disabled="!canShowPreviewCard"
					aria-label="Show options"
				/>

				<template #content>
					<div class="w-64 space-y-3 p-3">
						<label class="flex items-center justify-between gap-3 text-sm">
							<span>Auto-show selections</span>
							<USwitch v-model="cardStore.autoShowSelectedCard" size="sm" />
						</label>

						<USeparator />

						<UFormField label="Timeout" :description="timeoutLabel" size="sm">
							<UFieldGroup class="w-full">
								<UInputNumber
									v-model="timeoutDraft"
									:min="0"
									size="sm"
									class="flex-1"
								/>
								<UButton
									size="sm"
									variant="outline"
									:loading="eventStore.loading"
									@click="saveTimeout"
								>
									Save
								</UButton>
							</UFieldGroup>
						</UFormField>
					</div>
				</template>
			</UPopover>
		</UFieldGroup>
		<UAlert
			v-if="!canShowPreviewCard"
			color="warning"
			variant="subtle"
			icon="i-lucide-triangle-alert"
			title="No card image screen configured"
			description="Add a screen in card mode to show cards."
		/>

		<!-- Meld controls -->
		<USeparator v-if="previewCard.meldData" />
		<UFieldGroup v-if="previewCard.meldData" orientation="horizontal">
			<UButton
				v-if="previewCard.meldData?.meldPartOne"
				variant="outline"
				color="info"
				block
				:disabled="previewCard.name === previewCard.meldData?.meldPartOne"
				@click="selectMeldCardPart(previewCard.meldData?.meldPartOne)"
			>
				{{ previewCard.meldData?.meldPartOne }}
			</UButton>
			<UButton
				v-if="previewCard.meldData?.meldPartTwo"
				variant="outline"
				color="info"
				block
				:disabled="previewCard.name === previewCard.meldData?.meldPartTwo"
				@click="selectMeldCardPart(previewCard.meldData?.meldPartTwo)"
			>
				{{ previewCard.meldData?.meldPartTwo }}
			</UButton>
		</UFieldGroup>
		<UButton
			v-if="previewCard.meldData?.meldResult"
			variant="outline"
			color="info"
			block
			icon="i-lucide-flip-horizontal"
			:disabled="previewCard.name === previewCard.meldData?.meldResult"
			@click="selectMeldCardPart(previewCard.meldData?.meldResult)"
		>
			{{ previewCard.meldData?.meldResult }}
		</UButton>

		<!-- Orientation controls -->
		<USeparator v-if="hasOrientationControls" />
		<UButton
			v-if="previewCard.orientationData.turnable"
			variant="outline"
			color="neutral"
			icon="i-lucide-flip-horizontal"
			block
			@click="cardAction('turnOver')"
		>
			Turn Over
		</UButton>
		<UButton
			v-if="previewCard.orientationData.rotateable"
			variant="outline"
			color="neutral"
			icon="i-lucide-rotate-cw"
			block
			@click="cardAction('rotate')"
		>
			Rotate Clockwise
		</UButton>
		<UButton
			v-if="previewCard.orientationData.counterRotateable"
			variant="outline"
			color="neutral"
			icon="i-lucide-rotate-ccw"
			block
			@click="cardAction('counterRotate')"
		>
			Rotate Counter-Clockwise
		</UButton>
		<UButton
			v-if="previewCard.orientationData.flipable"
			:ui="{
				leadingIcon: 'rotate-90',
			}"
			variant="outline"
			color="neutral"
			icon="i-lucide-rotate-cw"
			block
			@click="cardAction('flip')"
		>
			Flip
		</UButton>

		<!-- Switch Printing -->
		<UButton
			v-if="previewCardPrintings.length > 1"
			variant="outline"
			color="neutral"
			icon="i-lucide-printer"
			block
			@click="openPrintList"
		>
			Switch Printing
		</UButton>
	</div>
</template>
