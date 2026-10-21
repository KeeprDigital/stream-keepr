import type { BroadcastGraphicConfig } from '../types/graphics';
import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { broadcastGraphicsBackgroundConfigSchema } from '../animationEffects';
import { GRAPHIC_CHANNEL_HANDOFF_POLICY_VALUES } from '../types/graphics';
import { defineScreenModeConfigContract, serverValidatedField } from './contract';

/**
 * The Graphic Channel cap.
 *
 * A Graphic Channel exists to make two Broadcast Graphics mutually exclusive, so a
 * channel with one member excludes nothing and a channel with none is not a lane at
 * all. Half the Broadcast Graphic cap is therefore the point past which another
 * channel cannot be given a second member, which makes it the cap that binds on
 * meaning rather than on an arbitrary number.
 */
export const MAX_GRAPHIC_CHANNELS_PER_SCREEN = 25;

/**
 * A Graphic Channel: one optional playout lane, and how it replaces its member.
 *
 * `handoff` is optional because a Graphic Channel defaults to Overlap, and an absent
 * policy is the only way that default stays true of a channel nobody has configured
 * as well as of one whose author chose it.
 */
const graphicChannelConfigSchema = z.object({
	id: z.string().min(1).max(100),
	name: z.string().min(1).max(100),
	handoff: z.enum(GRAPHIC_CHANNEL_HANDOFF_POLICY_VALUES).optional(),
}).strict();

/**
 * The Broadcast Graphics Screen Mode's config contract.
 *
 * `graphics` is the Screen's authored back-to-front stack of Broadcast Graphics;
 * concurrent graphics always render in this order. Its schema reaches server-only
 * Graphic Asset ids and carries the whole-Screen caps, so the server supplies it.
 * It is an authored stack: a display reset leaves it, and `null` cannot delete
 * it, because emptying it has no undo.
 *
 * `channels` declares the Screen's Graphic Channels, which each graphic joins by
 * id: a lane is a design decision about the show, so it is authored here, while
 * which member a channel currently holds is derived from the Live Session's
 * playout intents. The Screen's one configurable pixel canvas remains the
 * Screen's own width and height, and playout, inputs, and animation are live
 * state rather than authored configuration.
 */
export const broadcastGraphicsModeConfigContract = defineScreenModeConfigContract({
	graphics: serverValidatedField<BroadcastGraphicConfig[]>(),
	/** Absent declares no Graphic Channels, so every graphic runs concurrently. */
	channels: z.array(graphicChannelConfigSchema)
		.max(
			MAX_GRAPHIC_CHANNELS_PER_SCREEN,
			`A Broadcast Graphics Screen must not declare more than ${MAX_GRAPHIC_CHANNELS_PER_SCREEN} Graphic Channels`,
		)
		// A Broadcast Graphic joins a channel by id alone, so two channels sharing one id
		// would leave which policy governs the handoff undecided. On the field, as every
		// other mode-configuration rule is, so it reaches the PATCH path.
		.refine(
			channels => new Set(channels.map(channel => channel.id)).size === channels.length,
			'Graphic Channel ids must be unique within one Broadcast Graphics Screen',
		)
		.optional(),
	/**
	 * The Screen's Broadcast Graphics Background: one Animation Effect the stack
	 * composes over, shown or not, at an opacity. Absent is no background, which is
	 * what every Screen ships as and what keeps an Overlay Output transparent behind
	 * its graphics. The schema is the catalogue's, so an effect this build does not
	 * ship is refused rather than stored and silently rendering nothing.
	 */
	background: broadcastGraphicsBackgroundConfigSchema.optional(),
}, {
	graphics: [],
}, { authoredStacks: ['graphics'] });

export type BroadcastGraphicsModeConfig = ScreenModeConfigOf<typeof broadcastGraphicsModeConfigContract>;
