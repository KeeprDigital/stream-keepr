/**
 * SHA-256 as lowercase hex, wherever the page was loaded from.
 *
 * Web Crypto's `crypto.subtle` exists only in a secure context: HTTPS, or
 * `localhost`. Stream Keepr is also opened over plain HTTP on a LAN address (a
 * phone, a tablet or the broadcast machine against a bypassed launcher, README
 * § Local auth bypass), and there `crypto.subtle` is undefined. So the digest
 * comes from Web Crypto where it exists, which is faster on a large upload,
 * and is computed here where it does not.
 *
 * Browser code takes a digest through this and nothing else: ESLint refuses
 * `crypto.subtle` and `crypto.randomUUID` in `app/` and `shared/`.
 */
export async function sha256Hex(bytes: ArrayBuffer | ArrayBufferView): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	const view = ArrayBuffer.isView(bytes)
		? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		: new Uint8Array(bytes);
	return subtle
		? hex(new Uint8Array(await subtle.digest('SHA-256', view as BufferSource)))
		: sha256HexWithoutWebCrypto(view);
}

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

const ROUND_CONSTANTS = Uint32Array.of(
	0x428A2F98,
	0x71374491,
	0xB5C0FBCF,
	0xE9B5DBA5,
	0x3956C25B,
	0x59F111F1,
	0x923F82A4,
	0xAB1C5ED5,
	0xD807AA98,
	0x12835B01,
	0x243185BE,
	0x550C7DC3,
	0x72BE5D74,
	0x80DEB1FE,
	0x9BDC06A7,
	0xC19BF174,
	0xE49B69C1,
	0xEFBE4786,
	0x0FC19DC6,
	0x240CA1CC,
	0x2DE92C6F,
	0x4A7484AA,
	0x5CB0A9DC,
	0x76F988DA,
	0x983E5152,
	0xA831C66D,
	0xB00327C8,
	0xBF597FC7,
	0xC6E00BF3,
	0xD5A79147,
	0x06CA6351,
	0x14292967,
	0x27B70A85,
	0x2E1B2138,
	0x4D2C6DFC,
	0x53380D13,
	0x650A7354,
	0x766A0ABB,
	0x81C2C92E,
	0x92722C85,
	0xA2BFE8A1,
	0xA81A664B,
	0xC24B8B70,
	0xC76C51A3,
	0xD192E819,
	0xD6990624,
	0xF40E3585,
	0x106AA070,
	0x19A4C116,
	0x1E376C08,
	0x2748774C,
	0x34B0BCB5,
	0x391C0CB3,
	0x4ED8AA4A,
	0x5B9CCA4F,
	0x682E6FF3,
	0x748F82EE,
	0x78A5636F,
	0x84C87814,
	0x8CC70208,
	0x90BEFFFA,
	0xA4506CEB,
	0xBEF9A3F7,
	0xC67178F2,
);

function rotateRight(value: number, bits: number): number {
	return (value >>> bits) | (value << (32 - bits));
}

/** The same digest with no platform help. Exported for its test; call `sha256Hex`. */
export function sha256HexWithoutWebCrypto(bytes: Uint8Array): string {
	// The message, a 1 bit, zeros, then its length in bits as 64 bits: a whole number of 64-byte blocks.
	const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
	const padded = new Uint8Array(paddedLength);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const blocks = new DataView(padded.buffer);
	blocks.setUint32(paddedLength - 8, Math.floor(bytes.length / 0x20000000));
	blocks.setUint32(paddedLength - 4, (bytes.length * 8) >>> 0);

	const state = Uint32Array.of(
		0x6A09E667,
		0xBB67AE85,
		0x3C6EF372,
		0xA54FF53A,
		0x510E527F,
		0x9B05688C,
		0x1F83D9AB,
		0x5BE0CD19,
	);
	const schedule = new Uint32Array(64);
	for (let offset = 0; offset < paddedLength; offset += 64) {
		for (let index = 0; index < 16; index++)
			schedule[index] = blocks.getUint32(offset + index * 4);
		for (let index = 16; index < 64; index++) {
			const before15 = schedule[index - 15]!;
			const before2 = schedule[index - 2]!;
			const small0 = rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
			const small1 = rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
			schedule[index] = (schedule[index - 16]! + small0 + schedule[index - 7]! + small1) >>> 0;
		}

		let [a, b, c, d, e, f, g, h] = state as unknown as [number, number, number, number, number, number, number, number];
		for (let index = 0; index < 64; index++) {
			const big1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
			const choice = (e & f) ^ (~e & g);
			const first = (h + big1 + choice + ROUND_CONSTANTS[index]! + schedule[index]!) >>> 0;
			const big0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
			const majority = (a & b) ^ (a & c) ^ (b & c);
			const second = (big0 + majority) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d + first) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (first + second) >>> 0;
		}
		state[0] = (state[0]! + a) >>> 0;
		state[1] = (state[1]! + b) >>> 0;
		state[2] = (state[2]! + c) >>> 0;
		state[3] = (state[3]! + d) >>> 0;
		state[4] = (state[4]! + e) >>> 0;
		state[5] = (state[5]! + f) >>> 0;
		state[6] = (state[6]! + g) >>> 0;
		state[7] = (state[7]! + h) >>> 0;
	}

	const digest = new Uint8Array(32);
	const out = new DataView(digest.buffer);
	state.forEach((word, index) => out.setUint32(index * 4, word));
	return hex(digest);
}
