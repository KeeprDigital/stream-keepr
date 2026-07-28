import jpegDecoderWasm from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import decodeJpegSource, { init as initJpegDecoder } from '@jsquash/jpeg/decode.js';
import webpDecoderWasm from '@jsquash/webp/codec/dec/webp_dec.wasm';
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
