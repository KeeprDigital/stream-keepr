declare module '#app' {
	interface PageMeta {
		title?: string;
	}

	interface NuxtApp {
		$realtime?: import('~/types/realtime').RealtimeTransport;
	}
}
export {};
