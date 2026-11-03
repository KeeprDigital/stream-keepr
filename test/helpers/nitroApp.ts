type Handler = (payload: never) => unknown;

/**
 * The hooks of a Nitro app, enough to install a server plugin and fire its hooks:
 * `callHook` awaits each handler in turn, as Nitro's does.
 */
export function createFakeNitroApp() {
	const handlers = new Map<string, Handler[]>();
	const nitroApp = {
		hooks: {
			hook: (name: string, handler: Handler) => {
				handlers.set(name, [
					...handlers.get(name) ?? [],
					handler,
				]);
			},
			callHook: async (name: string, payload?: unknown) => {
				for (const handler of handlers.get(name) ?? [])
					await handler(payload as never);
			},
		},
	};
	return nitroApp;
}

/** Installs a `defineNitroPlugin` default export onto `nitroApp`; tests stub `defineNitroPlugin` as identity. */
export function installNitroPlugin(plugin: unknown, nitroApp: ReturnType<typeof createFakeNitroApp>) {
	(plugin as (app: typeof nitroApp) => void)(nitroApp);
}
