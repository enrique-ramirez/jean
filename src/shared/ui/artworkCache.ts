const CACHE = "jean-artwork-v2";

const addressOf = (key: string) => `/jean-artwork/${encodeURIComponent(key)}`;

const BUDGET_BYTES = 500 * 1024 * 1024;

export const canCacheArtwork = () =>
	typeof caches !== "undefined" && typeof Response !== "undefined";

const sizeOf = (response: Response) =>
	Number(response.headers.get("content-length")) || 0;

let heldBytes: number | null = null;

let queue: Promise<unknown> = Promise.resolve();

const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
	const next = queue.then(run, run);
	queue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
};

const countHeld = async (cache: Cache) => {
	const keys = await cache.keys();
	let total = 0;
	for (const key of keys) {
		const held = await cache.match(key);
		if (held) total += sizeOf(held);
	}
	return { count: keys.length, bytes: total };
};

// Oldest first, deliberately not least-recently-used: nothing here expires, so rotation is the only
// thing that makes a re-tagged sleeve reappear. `keys()` answers in insertion order, which is the
// whole of the policy.
const evictTo = async (cache: Cache, budget: number) => {
	if (heldBytes === null || heldBytes <= budget) return;

	for (const key of await cache.keys()) {
		if (heldBytes <= budget) return;
		const held = await cache.match(key);
		if (await cache.delete(key)) heldBytes -= held ? sizeOf(held) : 0;
	}
};

export async function cachedArtwork(key: string): Promise<Blob | null> {
	if (!canCacheArtwork()) return null;

	try {
		const cache = await caches.open(CACHE);
		// `ignoreVary`: beefweb answers `Vary: Origin` and an image request carries no `Origin` header,
		// so a match that honoured it would turn on a header neither side ever sends.
		const held = await cache.match(addressOf(key), { ignoreVary: true });
		return held ? await held.blob() : null;
	} catch {
		return null;
	}
}

export async function keepArtwork(key: string, response: Response) {
	if (!canCacheArtwork() || !response.ok) return;

	await inTurn(async () => {
		try {
			const cache = await caches.open(CACHE);
			if (heldBytes === null) heldBytes = (await countHeld(cache)).bytes;

			await cache.put(addressOf(key), response);
			heldBytes += sizeOf(response);
			await evictTo(cache, BUDGET_BYTES);
		} catch {
			// A full disk, a quota refusal, the browser evicting the origin. The cover is already on
			// screen and the only thing lost is having it next time.
			heldBytes = null;
		}
	});
}

export async function artworkHeld(): Promise<{
	count: number;
	bytes: number;
	budget: number;
}> {
	if (!canCacheArtwork()) return { count: 0, bytes: 0, budget: BUDGET_BYTES };

	try {
		const held = await countHeld(await caches.open(CACHE));
		heldBytes = held.bytes;
		return { ...held, budget: BUDGET_BYTES };
	} catch {
		return { count: 0, bytes: 0, budget: BUDGET_BYTES };
	}
}

export async function forgetArtwork() {
	if (!canCacheArtwork()) return;
	try {
		await caches.delete(CACHE);
	} finally {
		heldBytes = 0;
	}
}

const handles = new Map<string, { url: string; refs: number }>();

const share = (key: string, blob: Blob) => {
	const held = handles.get(key);
	if (held) {
		held.refs += 1;
		return held.url;
	}

	const url = URL.createObjectURL(blob);
	handles.set(key, { url, refs: 1 });
	return url;
};

export async function heldArtwork(key: string): Promise<string | null> {
	if (!canCacheArtwork()) return null;

	const held = handles.get(key);
	if (held) {
		held.refs += 1;
		return held.url;
	}

	const stored = await cachedArtwork(key);
	return stored ? share(key, stored) : null;
}

/**
 * The address to point an `<img>` at, and a claim on it. Every caller that holds one MUST drop it.
 * `key` identifies the artwork itself; `src` only says where to ask for it -- so artwork already held
 * under another view's address is answered without a request.
 */
export async function holdArtwork(
	key: string,
	src: string,
	signal: AbortSignal,
): Promise<string> {
	if (!canCacheArtwork()) return src;

	const held = await heldArtwork(key);
	if (held) return held;

	const response = await fetch(src, { signal });
	if (!response.ok) throw new Error(`no artwork: ${response.status}`);

	await keepArtwork(key, response.clone());
	return share(key, await response.blob());
}

export function dropArtwork(key: string) {
	const held = handles.get(key);
	if (!held) return;

	held.refs -= 1;
	if (held.refs > 0) return;

	handles.delete(key);
	URL.revokeObjectURL(held.url);
}
