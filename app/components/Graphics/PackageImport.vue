<script setup lang="ts">
/**
 * The package-import surface a graphics library offers: the picker that receives one,
 * and what preflight concluded about it.
 *
 * Presentation only, and that is the whole point of the seam. What importing a package
 * *means* differs by artifact — a Template Package yields an Installed Graphics Template
 * unlinked from whatever exported it, while a Graphic Style Set Package preserves the
 * packaged identity and revision — so the chosen file is handed straight back to the
 * library that owns those semantics rather than acted on here. Every library states its
 * own import at its own call site; only the chrome around it is shared.
 */

/** As much of a preflight issue as presenting one needs. */
interface PackageImportIssue {
	code: string;
	message: string;
	remediation?: string;
}

defineProps<{
	/** The portable artifact this library receives, named as an author reads it. */
	packageNoun: string;
	/** The archive extension the picker accepts, such as `.skgraphic`. */
	accept: string;
	/** This library's prefix for its import test ids. */
	testId: string;
	/** Whether this session may author. An observer is offered no import at all. */
	writable?: boolean;
	/** Whether a package is currently being received, confirmed, or installed. */
	busy?: boolean;
	/** Whether a preflight report is waiting to be read. */
	reported?: boolean;
	issues?: readonly PackageImportIssue[];
	/** Whether the report is terminal, so there is nothing to accept. */
	rejected?: boolean;
	/** Whether the report is paused on the one confirmation it may ask for. */
	awaitingConfirmation?: boolean;
}>();

const emit = defineEmits<{
	/** An archive the author chose. What importing it means belongs to the library. */
	file: [file: File];
	confirm: [];
	dismiss: [];
}>();

const importFileInput = useTemplateRef<HTMLInputElement>('importFileInput');

function onImportFileChosen(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	// Cleared straight away so choosing the same file twice still fires a change.
	input.value = '';
	if (file)
		emit('file', file);
}
</script>

<template>
	<!--
		Receiving a package from elsewhere. The file picker is hidden behind an ordinary
		button so the control reads like the library's other actions rather than like a
		form.
	-->
	<div v-if="writable">
		<input
			ref="importFileInput"
			type="file"
			:accept="accept"
			class="hidden"
			:data-testid="`${testId}-input`"
			@change="onImportFileChosen"
		>
		<UButton
			size="xs"
			variant="soft"
			icon="i-lucide-package-open"
			:loading="busy"
			:disabled="busy"
			:data-testid="testId"
			@click="importFileInput?.click()"
		>
			Import a {{ packageNoun }}
		</UButton>
	</div>

	<!--
		What preflight concluded. A rejection is terminal and lists every reason at once;
		a pause lists what the author is being asked to accept before anything is
		installed.
	-->
	<div
		v-if="reported"
		class="rounded-md border p-2"
		:class="rejected ? 'border-error/40 bg-error/10' : 'border-warning/40 bg-warning/10'"
		:data-testid="`${testId}-report`"
	>
		<p class="text-xs font-medium">
			{{ rejected
				? `This ${packageNoun} cannot be installed`
				: `Review before installing this ${packageNoun}` }}
		</p>
		<ul class="mt-1 space-y-1">
			<li v-for="(issue, index) in issues" :key="`${issue.code}-${index}`" class="text-xs text-muted">
				{{ issue.message }}<span v-if="issue.remediation"> — {{ issue.remediation }}</span>
			</li>
		</ul>
		<!-- Anything more this artifact's own report carries. -->
		<slot name="detail" />
		<div class="mt-2 flex flex-wrap gap-1.5">
			<UButton
				v-if="awaitingConfirmation"
				size="xs"
				variant="subtle"
				:loading="busy"
				:disabled="busy"
				:data-testid="`${testId}-confirm`"
				@click="emit('confirm')"
			>
				Install
			</UButton>
			<!-- Any resolution only this artifact can offer. -->
			<slot name="actions" />
			<UButton
				size="xs"
				color="neutral"
				variant="ghost"
				:data-testid="`${testId}-dismiss`"
				@click="emit('dismiss')"
			>
				{{ awaitingConfirmation ? 'Cancel' : 'Dismiss' }}
			</UButton>
		</div>
	</div>
</template>
