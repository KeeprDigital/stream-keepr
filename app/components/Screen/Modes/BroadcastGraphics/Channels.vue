<script setup lang="ts">
import type {
	BroadcastGraphicConfig,
	GraphicChannelConfig,
	GraphicChannelHandoffPolicy,
} from '~~/shared/types/graphics';
import { graphicChannelHandoffPolicy } from '~~/shared/modules/graphics';
import { GRAPHIC_CHANNEL_HANDOFF_POLICY_VALUES } from '~~/shared/types/graphics';
import { randomUuid } from '~~/shared/utils/uuid';

/**
 * Authoring for a Broadcast Graphics Screen's Graphic Channels.
 *
 * A Graphic Channel is a playout lane rather than a container: it is declared here
 * with its Graphic Channel Handoff Policy, and each Broadcast Graphic joins the one
 * lane it runs in. That is why this sits beside the compositor's stack tree instead
 * of inside it — joining a lane changes nothing about a design or about Graphic Layer
 * Order, and a graphic must be able to leave a channel without its composition
 * moving.
 *
 * It lives in the Edit workspace because it is authoring, and so is covered by the
 * same Graphics Authoring Lease every other control here is: an observer reads the
 * lanes and the policies without being able to change either.
 *
 * Deleting a channel releases its members in the same write. A `channelId` naming a
 * channel the Screen no longer declares resolves to no membership everywhere, so the
 * graphic would keep working either way — but leaving one behind means the stored
 * document says something the Screen does not, and nothing here should author that.
 */
const props = defineProps<{
	graphics: readonly BroadcastGraphicConfig[];
	channels: readonly GraphicChannelConfig[];
	writable?: boolean;
}>();

const emit = defineEmits<{
	/**
	 * The Screen configuration this change writes, carrying only the fields it moves —
	 * except that deleting a Graphic Channel carries both, because releasing its members
	 * must never be a second write.
	 */
	'update:channels': [next: { channels?: GraphicChannelConfig[]; graphics?: BroadcastGraphicConfig[] }];
}>();

const POLICY_OPTIONS = GRAPHIC_CHANNEL_HANDOFF_POLICY_VALUES.map(value => ({
	value,
	label: value === 'overlap' ? 'Overlap' : 'Out then in',
})) satisfies Array<{ value: GraphicChannelHandoffPolicy; label: string }>;

const canAuthor = computed(() => props.writable === true);

/**
 * The pickers each Broadcast Graphic gets, in authored back-to-front stack order.
 *
 * Read as the stack rather than grouped by channel, because this is where an author
 * decides membership and the decision is per graphic. The Live workspace groups; this
 * assigns.
 */
const memberships = computed(() => props.graphics.map(graphic => ({
	graphic,
	// A channel the Screen no longer declares reads as no channel, exactly as it
	// resolves everywhere else, so the picker offers the author the real answer.
	channelId: props.channels.some(channel => channel.id === graphic.channelId)
		? graphic.channelId ?? null
		: null,
})));

const channelOptions = computed(() => [
	{ value: null, label: 'No Graphic Channel' },
	...props.channels.map(channel => ({ value: channel.id, label: channel.name })),
]);

function write(next: { channels?: GraphicChannelConfig[]; graphics?: BroadcastGraphicConfig[] }) {
	if (!canAuthor.value)
		return;
	emit('update:channels', next);
}

function addChannel() {
	write({
		channels: [
			...props.channels,
			// A durable authored id, like every other graphics id an author creates. A
			// command id would embed a wall clock and a counter that only correlate a live
			// -session command with its retry, which a Screen's stored configuration is not.
			{ id: randomUuid(), name: `Channel ${props.channels.length + 1}` },
		],
	});
}

function renameChannel(channelId: string, name: string) {
	write({ channels: props.channels.map(channel => (channel.id === channelId ? { ...channel, name } : channel)) });
}

function setPolicy(channelId: string, handoff: GraphicChannelHandoffPolicy) {
	write({ channels: props.channels.map(channel => (channel.id === channelId ? { ...channel, handoff } : channel)) });
}

/** The same Broadcast Graphic with no Graphic Channel, rather than an empty membership. */
function released(graphic: BroadcastGraphicConfig): BroadcastGraphicConfig {
	const { channelId: _released, ...rest } = graphic;
	return rest;
}

function removeChannel(channelId: string) {
	write({
		channels: props.channels.filter(channel => channel.id !== channelId),
		graphics: props.graphics.map(graphic => (graphic.channelId === channelId ? released(graphic) : graphic)),
	});
}

function setMembership(graphicId: string, channelId: string | null) {
	write({
		graphics: props.graphics.map((graphic) => {
			if (graphic.id !== graphicId)
				return graphic;
			return channelId === null ? released(graphic) : { ...graphic, channelId };
		}),
	});
}
</script>

<template>
	<section data-testid="graphic-channels">
		<div class="mb-2 flex items-center gap-2">
			<h3 class="min-w-0 flex-1 truncate text-sm font-medium">
				Graphic Channels
			</h3>
			<UButton
				size="xs"
				variant="soft"
				icon="i-lucide-plus"
				:disabled="!canAuthor"
				data-testid="graphic-channel-add"
				@click="addChannel"
			>
				Add
			</UButton>
		</div>

		<p class="mb-2 text-xs text-muted">
			A Graphic Channel keeps at most one of its Broadcast Graphics on air. Graphics in
			different channels, or in none, run concurrently.
		</p>

		<div v-if="channels.length > 0" class="space-y-2">
			<div
				v-for="channel in channels"
				:key="channel.id"
				class="rounded-lg border border-default/70 bg-muted/20 p-2"
				:data-graphic-channel="channel.id"
			>
				<div class="flex items-center gap-1.5">
					<UInput
						:model-value="channel.name"
						size="xs"
						class="min-w-0 flex-1"
						aria-label="Graphic Channel name"
						:disabled="!canAuthor"
						data-testid="graphic-channel-name"
						@update:model-value="renameChannel(channel.id, String($event))"
					/>
					<UButton
						size="xs"
						color="error"
						variant="ghost"
						icon="i-lucide-trash-2"
						aria-label="Delete Graphic Channel"
						:disabled="!canAuthor"
						data-testid="graphic-channel-remove"
						@click="removeChannel(channel.id)"
					/>
				</div>
				<USelect
					class="mt-1.5 w-full"
					size="xs"
					:items="POLICY_OPTIONS"
					value-key="value"
					:model-value="graphicChannelHandoffPolicy(channel)"
					aria-label="Graphic Channel Handoff Policy"
					:disabled="!canAuthor"
					data-testid="graphic-channel-policy"
					@update:model-value="setPolicy(channel.id, $event as GraphicChannelHandoffPolicy)"
				/>
			</div>
		</div>

		<div v-if="channels.length > 0 && graphics.length > 0" class="mt-3 space-y-1.5">
			<p class="text-xs font-medium">
				Membership
			</p>
			<div
				v-for="entry in memberships"
				:key="entry.graphic.id"
				class="flex items-center gap-2"
				:data-graphic-channel-membership="entry.graphic.id"
			>
				<span class="min-w-0 flex-1 truncate text-xs">{{ entry.graphic.name }}</span>
				<USelect
					size="xs"
					class="w-40 shrink-0"
					:items="channelOptions"
					value-key="value"
					:model-value="entry.channelId"
					:aria-label="`Graphic Channel for ${entry.graphic.name}`"
					:disabled="!canAuthor"
					data-testid="graphic-channel-membership"
					@update:model-value="setMembership(entry.graphic.id, ($event as string | null) ?? null)"
				/>
			</div>
		</div>
	</section>
</template>
