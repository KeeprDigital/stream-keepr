/**
 * The Worker's cron triggers, as `wrangler.jsonc` declares them. Every
 * `cloudflare:scheduled` handler runs on every trigger, so each one returns
 * unless `controller.cron` is its own schedule.
 */

/** Graphics Asset Library retention and reconciliation: hourly. */
export const GRAPHICS_CRON = '17 * * * *';

/** Melee Live Results: every minute, ticking the Events whose check is due. */
export const LIVE_RESULTS_CRON = '* * * * *';
