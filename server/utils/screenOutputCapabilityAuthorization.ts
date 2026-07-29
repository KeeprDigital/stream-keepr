export function bearerScreenOutputCapability(value: string | undefined): string | undefined {
	const match = /^Bearer ([\w-]{20,200})$/.exec(value ?? '');
	return match?.[1];
}
