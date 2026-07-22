let sequence = 0;

/**
 * Generate an RFC4122-shaped v4 UUID without relying on Web Crypto / Node crypto.
 *
 * This is intended for client/session correlation identifiers, not security-sensitive
 * tokens. It works on plain HTTP LAN origins where browser crypto APIs may be
 * unavailable.
 */
export function randomUuid(): string {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
		const value = Math.floor(Math.random() * 16);
		const nibble = char === 'x' ? value : (value & 0x3) | 0x8;
		return nibble.toString(16);
	});
}

/** Create a command id with a common, sortable-ish shape. */
export function randomCommandId(prefix: string): string {
	sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
	return `${prefix}:${Date.now()}:${sequence}:${randomUuid()}`;
}
