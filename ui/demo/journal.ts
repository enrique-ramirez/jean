// The library is rebuilt from a seed on every restart, so only the difference from it is worth
// journalling. In the Cache API rather than IndexedDB: it is one JSON blob under one key.

export interface Entry {
	method: string;
	path: string;
	body: unknown;
}

const CACHE = "jean-demo";
const KEY = "/__demo/journal";
const SAVE_DEBOUNCE_MS = 500;

// A longer journal costs a slower first paint on the replay, so it is capped; the oldest entries
// are the ones dropped.
const LIMIT = 400;

let entries: Entry[] = [];
let saving: ReturnType<typeof setTimeout> | null = null;

export async function load(): Promise<Entry[]> {
	const cache = await caches.open(CACHE);
	const stored = await cache.match(KEY);
	entries = stored ? ((await stored.json().catch(() => [])) as Entry[]) : [];
	return entries;
}

const save = async () => {
	saving = null;
	const cache = await caches.open(CACHE);
	await cache.put(KEY, new Response(JSON.stringify(entries)));
};

export function append(entry: Entry) {
	entries.push(entry);
	if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
	if (!saving) saving = setTimeout(save, SAVE_DEBOUNCE_MS);
}

export async function clear() {
	entries = [];
	if (saving) clearTimeout(saving);
	saving = null;
	const cache = await caches.open(CACHE);
	await cache.delete(KEY);
}
