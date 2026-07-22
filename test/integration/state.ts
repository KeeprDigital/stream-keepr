import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

export const INTEGRATION_MODE_ENV = 'STREAM_KEEPR_INTEGRATION';
export const INTEGRATION_WRANGLER_PERSIST_DIR_ENV = 'STREAM_KEEPR_INTEGRATION_WRANGLER_PERSIST_DIR';
export const DEFAULT_INTEGRATION_WRANGLER_PERSIST_DIR = '.wrangler/state/integration';

export function getIntegrationWranglerPersistDir() {
	return process.env[INTEGRATION_WRANGLER_PERSIST_DIR_ENV] ?? DEFAULT_INTEGRATION_WRANGLER_PERSIST_DIR;
}

export function resolveIntegrationWranglerPersistDir(rootDir = process.cwd(), persistDir = getIntegrationWranglerPersistDir()) {
	return resolve(rootDir, persistDir);
}

export async function resetIntegrationWranglerState(persistDir = getIntegrationWranglerPersistDir()) {
	await rm(resolveIntegrationWranglerPersistDir(process.cwd(), persistDir), { recursive: true, force: true });
}
