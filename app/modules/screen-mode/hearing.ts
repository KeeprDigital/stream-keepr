import type { ComputedRef } from 'vue';
import type { DeclaredOutputChangeKind, HearingScreen, OutputChangeKind, ScreenHearsContext } from '~~/shared/screenOutputInterest';
import type { ScreenMode } from '~~/shared/types/enums';
import type { MessageType } from '~~/shared/types/messages';
import type { ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { ScreenModeDependencies, ScreenModeHearing } from '~/modules/screen-mode/freshness';
import type { MessageData, RealtimeTransport } from '~/types/realtime';
import { computed } from 'vue';
import { SCREEN_MODES } from '~~/shared/screenModes';
import { OUTPUT_CHANGE_KINDS, OUTPUT_CHANGE_MESSAGE_TYPES, outputChangeOf, screenHears } from '~~/shared/screenOutputInterest';
import { directChannelMessageTypes } from '~~/shared/types/messages';
import { renderingChannel } from '~/modules/screen/renderingChannel';

const KNOWN_KINDS: ReadonlySet<string> = new Set(OUTPUT_CHANGE_KINDS);

/** The Event channel's messages: every type but those only a Screen's own channel carries. */
const EVENT_CHANNEL_MESSAGE_TYPES = OUTPUT_CHANGE_MESSAGE_TYPES.filter(type => !directChannelMessageTypes.has(type));

interface ScreenModeHearingOptions {
	/**
	 * The kinds of Output Change this read answers, of those the mode's
	 * Screen Mode Definition declares; all of them when left out. A mode with
	 * several reads narrows the ones a kind does not touch.
	 */
	follows?: readonly DeclaredOutputChangeKind[];
	/**
	 * The Feature Match Slot the read shows and the Players it seats now, where
	 * the caller holds them: on the Event channel it narrows a Player or deck
	 * change to those Players. Left out, every Player is heard.
	 */
	seated?: () => ScreenHearsContext['slot'];
}

/**
 * Where one read of a Screen Mode hears that it is behind, and on what.
 *
 * What a mode's rendering shows is declared once, as the Output Changes its
 * Screen Mode Definition follows (`outputFollows`), and one rule reads it
 * (`screenHears`). Both kinds of rendering re-read by that rule:
 *
 * - a live rendering hears its Screen's own channel, where the server has
 *   already applied the rule to the Screen as saved and names the kinds that
 *   changed (`output:modeDataChanged`);
 * - a rendering of authored state hears its Event's channel and applies the
 *   same rule here, to the mode and configuration it renders, since the
 *   server cannot judge configuration it has not been given.
 *
 * The rule may hear more than a read answers, which costs a re-read, and never
 * less. Who a Feature Match Slot seats is the caller's to say (`seated`); told
 * nothing, a mode narrowed by it hears every Player on the Event channel.
 */
export function useScreenModeHearing<M extends ScreenMode>(
	context: ScreenContext,
	mode: M,
	config: () => ModeConfigTypeMap[M],
	options: ScreenModeHearingOptions = {},
): ComputedRef<ScreenModeHearing<unknown>> {
	const followed: ReadonlySet<OutputChangeKind> = new Set(
		options.follows ?? Object.keys(SCREEN_MODES[mode].outputFollows) as DeclaredOutputChangeKind[],
	);

	const onScreenChannel: ScreenModeDependencies<unknown> = {
		// A kind this build does not know came from a newer server: heard, since ignoring it could leave stale data on air.
		'output:modeDataChanged': ({ causes }) => causes.some(kind => followed.has(kind) || !KNOWN_KINDS.has(kind)),
	};

	function hearsOnEventChannel<K extends MessageType>(type: K, message: MessageData<K>): boolean {
		const screen = context.screen.value;
		if (!screen)
			return false;
		const hearing = {
			id: screen.id,
			mode,
			config: config(),
		} as HearingScreen;
		try {
			return outputChangeOf(type, message as never)
				.some(change => followed.has(change.kind) && screenHears(hearing, change, {
					slot: options.seated?.(),
				}));
		}
		catch {
			// A message this build cannot read may still touch what is shown.
			return true;
		}
	}
	const onEventChannel = Object.fromEntries(followed.size === 0
		? []
		: EVENT_CHANNEL_MESSAGE_TYPES.map(type => [
				type,
				(message: MessageData<MessageType>) => hearsOnEventChannel(type, message),
			])) as ScreenModeDependencies<unknown>;

	return computed(() => ({
		channel: renderingChannel(context),
		dependsOn: context.followsScreenChannel?.value
			? onScreenChannel
			: onEventChannel,
	}));
}

/**
 * Call `heard` for each message on the hearing's channel that says the read is
 * behind, for a read that Screen Mode Data Freshness does not hold. Answers its
 * disposal.
 */
export function listenToScreenModeHearing(
	realtime: Pick<RealtimeTransport, 'onChannel'>,
	hearing: ScreenModeHearing<unknown>,
	heard: () => void,
): () => void {
	const { channel, dependsOn } = hearing;
	if (!channel)
		return () => {};
	const stops = (Object.keys(dependsOn) as MessageType[]).map(type =>
		realtime.onChannel(channel, type, (message) => {
			const dependency = dependsOn[type] as true | ((message: unknown, held: unknown) => boolean);
			if (dependency === true || dependency(message, undefined))
				heard();
		}));
	return () => {
		for (const stop of stops)
			stop();
	};
}
