import type { RealtimePresenceData } from '~/types/realtime';
import type { Flight } from '~/utils/guardedSequence';
import { screenCommandMessageTypes } from '~~/shared/types/messages';
import { screenRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createGuardedSequence } from '~/utils/guardedSequence';

interface ScreenRealtimeSessionOptions {
	onRefresh: () => void;
	onIdentify: () => void;
	onDebug: () => void;
	getPresenceData: (eventId: number, screenId: number) => RealtimePresenceData;
}

export function useScreenRealtimeSession(options: ScreenRealtimeSessionOptions) {
	const realtime = useRealtime();
	const commandUnsubscribers: (() => void)[] = [];
	const activePresenceChannel = ref<string | null>(null);
	const session = createGuardedSequence();

	function unsubscribeFromCommands() {
		commandUnsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
	}

	function subscribeToCommands(eventId: number, screenId: number) {
		unsubscribeFromCommands();

		const channel = screenRealtimeChannel(eventId, screenId);

		try {
			commandUnsubscribers.push(
				realtime.onChannel(channel, screenCommandMessageTypes.refresh, (data) => {
					if (data.screenId === screenId)
						options.onRefresh();
				}),
				realtime.onChannel(channel, screenCommandMessageTypes.identify, (data) => {
					if (data.screenId === screenId)
						options.onIdentify();
				}),
				realtime.onChannel(channel, screenCommandMessageTypes.debug, (data) => {
					if (data.screenId === screenId)
						options.onDebug();
				}),
			);
		}
		catch (err) {
			console.warn('Failed to subscribe to screen commands:', err);
		}
	}

	async function leaveChannel(channel: string) {
		try {
			await realtime.leavePresence(channel);
		}
		catch (err) {
			console.warn('Failed to leave screen presence:', err);
		}
	}

	async function enterPresence(eventId: number, screenId: number, flight: Flight) {
		const channel = screenRealtimeChannel(eventId, screenId);

		try {
			await realtime.enterPresence(channel, options.getPresenceData(eventId, screenId));
			if (flight.stale) {
				await leaveChannel(channel);
				return;
			}

			activePresenceChannel.value = channel;
		}
		catch (err) {
			console.warn('Failed to enter screen presence:', err);
		}
	}

	async function leavePresence() {
		const channel = activePresenceChannel.value;
		if (!channel)
			return;

		activePresenceChannel.value = null;
		await leaveChannel(channel);
	}

	async function start(eventId: number, screenId: number) {
		await stop();
		const flight = session.begin();

		// The transport scopes its token to each channel's Event internally.
		subscribeToCommands(eventId, screenId);
		await enterPresence(eventId, screenId, flight);
	}

	async function stop() {
		session.supersede();
		unsubscribeFromCommands();
		await leavePresence();
	}

	onScopeDispose(() => {
		void stop();
	});

	return {
		start,
		stop,
	};
}
