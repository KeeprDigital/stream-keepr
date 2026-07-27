export function formatByteCount(byteLength: number) {
	const bytesPerGiB = 1024 * 1024 * 1024;
	if (byteLength < 1024)
		return `${byteLength} B`;
	if (byteLength < 1024 * 1024)
		return `${(byteLength / 1024).toFixed(1)} KiB`;
	if (byteLength < bytesPerGiB)
		return `${(byteLength / (1024 * 1024)).toFixed(1)} MiB`;
	return `${(byteLength / bytesPerGiB).toFixed(1)} GiB`;
}
