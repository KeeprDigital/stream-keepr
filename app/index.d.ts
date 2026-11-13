declare module '#app' {
	interface PageMeta {
		title?: string;
		/**
		 * The kinds of Event this page is offered to; every Event when left out.
		 * A nested page inherits its parent's. `event.global` sends an Event of
		 * any other kind to its overview (ADR-0057, ADR-0087).
		 */
		offeredTo?: readonly import('~~/shared/config/games').EventKind[];
	}

	interface NuxtApp {
		$realtime?: import('~/types/realtime').RealtimeTransport;
	}
}
export {};
