/**
 * A local launcher's stand-in for a Cloudflare cron trigger, which no local
 * runtime fires (ADR-0052). Imports nothing, so `scripts/preview-worker.mjs`
 * runs it under Node as the dev server's Nitro plugin does.
 */

export interface LocalCronOptions {
	/** One firing. A firing still running when the next is due makes that one skip. */
	fire: () => Promise<unknown>;
	intervalMs: number;
	/** A failed firing; the next interval fires as usual. */
	onError: (error: unknown) => void;
}

export interface LocalCron {
	stop: () => void;
}

/** Fires at once, then every `intervalMs`, never while a firing is running. */
export function startLocalCron({ fire, intervalMs, onError }: LocalCronOptions): LocalCron {
	let running = false;
	const run = async () => {
		if (running)
			return;
		running = true;
		try {
			await fire();
		}
		catch (error) {
			onError(error);
		}
		finally {
			running = false;
		}
	};
	const timer = setInterval(run, intervalMs);
	void run();
	return {
		stop: () => clearInterval(timer),
	};
}
