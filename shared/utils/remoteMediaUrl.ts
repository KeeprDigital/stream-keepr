/**
 * Where the application serves media of its own: the root-relative prefixes a
 * Remote Media URL may name. Only `/video/`, the one `public/` directory holding
 * Screen media; an allowlist, so a new route cannot become a media source
 * (ADR-0021 says why, #582).
 */
export const APP_SERVED_MEDIA_PATH_PREFIXES = ['/video/'] as const;

const RESOLUTION_BASE = 'https://remote-media-url.invalid';

/**
 * Whether a path holds whitespace or a control character, which the URL parser
 * strips or drops (`/\t/host` reads as `//host`), or a backslash, which it reads
 * as `/`.
 */
function hasUnsafePathCharacter(path: string): boolean {
	for (const character of path) {
		const code = character.codePointAt(0)!;
		if (code <= 0x20 || code === 0x7F || character === '\\')
			return true;
	}
	return false;
}

/**
 * A root-relative path that stays under an app-served media prefix however it is
 * read: as the browser resolves it, and once percent-decoded as a server may read
 * it. Any dot segment, encoded separator, encoded backslash or second encoding
 * layer is refused rather than reasoned about.
 */
function isAppServedMediaPath(value: string): boolean {
	if (!value.startsWith('/') || hasUnsafePathCharacter(value))
		return false;
	let resolved: URL;
	let decoded: string;
	try {
		resolved = new URL(value, RESOLUTION_BASE);
		decoded = decodeURIComponent(resolved.pathname);
	}
	catch {
		return false;
	}
	if (resolved.origin !== RESOLUTION_BASE)
		return false;
	if (hasUnsafePathCharacter(decoded) || decoded.includes('%'))
		return false;
	if (decoded.split('/').some(segment => segment === '.' || segment === '..'))
		return false;
	return APP_SERVED_MEDIA_PATH_PREFIXES.some(prefix =>
		resolved.pathname.startsWith(prefix)
		&& decoded.startsWith(prefix)
		&& decoded.length > prefix.length,
	);
}

/**
 * An absolute HTTPS URL, spelled with its `//` authority. Parsed alone,
 * `https:/api/…` or `https:api/…` reads as host `api`, but a browser resolves
 * either against the page that draws it, so it would name the application's own
 * route rather than another host.
 */
function isHttpsUrl(value: string): boolean {
	if (!/^https:\/\//i.test(value))
		return false;
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'https:'
			&& parsed.username === ''
			&& parsed.password === '';
	}
	catch {
		return false;
	}
}

/**
 * Why a Remote Media URL cannot be stored, or `undefined` when it can.
 *
 * A Remote Media URL is HTTPS, or root-relative under an app-served media prefix;
 * the empty string means unset. Plain HTTP is refused because an HTTPS-served
 * Screen blocks it as mixed content and would show a blank output (ADR-0021).
 * The schema and the editor share this one rule and its wording.
 */
export function remoteMediaUrlRefusal(value: string): string | undefined {
	if (value === '' || isHttpsUrl(value))
		return undefined;
	if (value.startsWith('/') && !value.startsWith('//')) {
		return isAppServedMediaPath(value)
			? undefined
			: `A root-relative Remote Media URL must name a file the application serves under ${APP_SERVED_MEDIA_PATH_PREFIXES.join(' or ')}. For Graphics Asset Library media, choose the asset from the Asset library instead.`;
	}
	return `A Remote Media URL must be HTTPS or a root-relative path under ${APP_SERVED_MEDIA_PATH_PREFIXES.join(' or ')}.`;
}
