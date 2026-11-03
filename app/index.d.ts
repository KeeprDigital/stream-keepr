declare module '#app' {
	interface PageMeta {
		title?: string;
		/**
		 * The Card Games whose Events this page is offered to; every Card Game when
		 * left out. A nested page inherits its parent's. `event.global` sends an
		 * Event of any other Card Game to its overview (ADR-0057).
		 */
		cardGames?: readonly import('~~/shared/types/enums').Game[];
	}

	interface NuxtApp {
		$realtime?: import('~/types/realtime').RealtimeTransport;
	}
}
export {};
