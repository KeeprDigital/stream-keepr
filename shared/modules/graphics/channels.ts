import type {
	BroadcastGraphicConfig,
	GraphicChannelConfig,
	GraphicChannelHandoffPolicy,
} from '~~/shared/types/graphics';
import { DEFAULT_GRAPHIC_CHANNEL_HANDOFF_POLICY } from '~~/shared/types/graphics';

/**
 * Graphic Channel membership, read from authored Screen configuration.
 *
 * A Graphic Channel is a lane rather than a container: the channel declares
 * itself and its Graphic Channel Handoff Policy, and each Broadcast Graphic
 * names the one lane it runs in. Nothing here reads or writes live state — which
 * member a channel currently holds is a fact about the playout intents the Live
 * Session already stores, so it is derived there and never duplicated as
 * authored configuration.
 *
 * ## An unresolvable membership is no membership
 *
 * A `channelId` naming a channel the Screen does not declare resolves to no
 * channel, exactly as a graphic that names none does. That is deliberate rather
 * than lenient: a channel is only meaningful as a mutual-exclusion relationship
 * between two placed graphics, so a name nothing else shares excludes nothing.
 * It is also the only answer a write path can guarantee — the mode-configuration
 * patch schema rebuilds each mode from its field schemas and drops object-level
 * refinements, so a cross-field check between `graphics` and `channels` would
 * hold on one write path and not on the other. Resolving tolerantly means every
 * path agrees, and a graphic left behind by a deleted channel simply runs
 * concurrently again.
 */

/** The Screen configuration Graphic Channel membership is read from. */
export interface GraphicChannelStack {
	graphics: readonly BroadcastGraphicConfig[];
	channels?: readonly GraphicChannelConfig[];
}

/** How this Graphic Channel replaces its selected member. Absent defaults to Overlap. */
export function graphicChannelHandoffPolicy(
	channel: Pick<GraphicChannelConfig, 'handoff'> | undefined,
): GraphicChannelHandoffPolicy {
	return channel?.handoff ?? DEFAULT_GRAPHIC_CHANNEL_HANDOFF_POLICY;
}

/** The Graphic Channel one placed Broadcast Graphic belongs to, if the Screen declares it. */
export function broadcastGraphicChannel(
	stack: GraphicChannelStack,
	graphicId: string,
): GraphicChannelConfig | undefined {
	const channelId = stack.graphics.find(graphic => graphic.id === graphicId)?.channelId;
	if (channelId === undefined)
		return undefined;
	return stack.channels?.find(channel => channel.id === channelId);
}

/**
 * The placed Broadcast Graphics in one Graphic Channel, in authored stack order.
 *
 * Stack order rather than take order, because it is the only order this module
 * ever has an opinion about — and channel membership never changes it.
 */
export function graphicChannelMembers(
	stack: GraphicChannelStack,
	channelId: string,
): readonly BroadcastGraphicConfig[] {
	return stack.graphics.filter(graphic => graphic.channelId === channelId);
}

/**
 * The Screen's Graphic Channels that at least one placed Broadcast Graphic joins,
 * paired with their members in authored stack order.
 *
 * The reading the Live workspace organises its rundown from: declared channels
 * first, in authored order, and then everything belonging to no channel.
 */
export function graphicChannelGroups(
	stack: GraphicChannelStack,
): { channel: GraphicChannelConfig | null; graphics: readonly BroadcastGraphicConfig[] }[] {
	const groups = (stack.channels ?? [])
		.map(channel => ({ channel, graphics: graphicChannelMembers(stack, channel.id) }))
		.filter(group => group.graphics.length > 0);

	const unchanneled = stack.graphics.filter(graphic => !broadcastGraphicChannel(stack, graphic.id));
	return unchanneled.length > 0
		? [...groups, { channel: null, graphics: unchanneled }]
		: groups;
}
