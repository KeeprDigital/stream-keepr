// `?module` is unwasm's request for the pre-compiled `WebAssembly.Module`
// rather than an instantiated set of exports — see `runtime/graphics-still-image-codecs.ts`.
declare module '*.wasm?module' {
	const module: WebAssembly.Module;
	export default module;
}

declare module '*.wasm' {
	const module: WebAssembly.Module;
	export default module;
}
