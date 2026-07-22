export default defineNuxtPlugin({
	name: 'event-realtime-session',
	dependsOn: ['realtime'],
	setup() {
		useEventRealtimeSession();
	},
});
