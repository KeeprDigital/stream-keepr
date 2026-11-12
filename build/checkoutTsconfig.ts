import { fileURLToPath } from 'node:url';

/**
 * This checkout's `tsconfig.json`, which every Vite server here is told to use
 * (`tsconfig`), so that none goes looking for one.
 *
 * Left to look, Vite's transform climbs from the file's directory past every
 * `tsconfig.json` whose `include` leaves the file out. This one's `include` is
 * inherited from `.nuxt/tsconfig.json`, and Vite counts it as leaving out even
 * the files it names (`test/nuxt/**`, `shared/**`), so the climb leaves the
 * checkout. An agent's worktree sits inside the main checkout
 * (`.claude/worktrees/<name>`), whose `tsconfig.json` extends its own
 * `.nuxt/tsconfig.json`: every transform in a worktree read the main
 * checkout's `.nuxt` afresh, and failed with `Tsconfig not found` while a
 * `nuxt prepare` there had it cleared (#1160).
 *
 * Vue's plugin transforms a component's script without passing this on, so
 * `app/tsconfig.json` ends that climb inside the checkout instead.
 */
export const CHECKOUT_TSCONFIG = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
