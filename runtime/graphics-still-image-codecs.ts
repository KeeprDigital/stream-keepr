/**
 * The still-image decoders, and the one place their Wasm is loaded.
 *
 * The `?module` suffix asks Nitro's Wasm support (unwasm) for the decoder's
 * pre-compiled `WebAssembly.Module` rather than an instantiated set of exports,
 * which is the shape `@jsquash`'s `init()` takes. Under the `cloudflare_module`
 * preset that becomes a real ESM `.wasm` import the runtime compiles ahead of
 * time; a deployed Worker may not compile Wasm from a byte buffer, and doing so
 * failed every deployed JPEG and WebP ingestion until #302.
 */
import jpegDecoderWasm from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm?module';
import decodeJpegSource, { init as initJpegDecoder } from '@jsquash/jpeg/decode.js';
import webpDecoderWasm from '@jsquash/webp/codec/dec/webp_dec.wasm?module';
import decodeWebpSource, { init as initWebpDecoder } from '@jsquash/webp/decode.js';

type DecoderInitialiser = (module: WebAssembly.Module) => Promise<void>;
let decodersInitialised: Promise<void> | undefined;

function initialiseDecoders() {
	decodersInitialised ??= Promise.all([
		(initJpegDecoder as DecoderInitialiser)(jpegDecoderWasm),
		(initWebpDecoder as DecoderInitialiser)(webpDecoderWasm),
	]).then(() => undefined);
	return decodersInitialised;
}

export async function decodeJpeg(bytes: ArrayBuffer) {
	await initialiseDecoders();
	return await decodeJpegSource(bytes, { preserveOrientation: true });
}

export async function decodeWebp(bytes: ArrayBuffer) {
	await initialiseDecoders();
	return await decodeWebpSource(bytes);
}
