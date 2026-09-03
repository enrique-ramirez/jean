// The writes made to the demo player, replayed against a new one on the way up.
//
// The browser stops an idle service worker after about thirty seconds and starts
// a fresh one for the next request, taking everything the player held with it.
// The library is rebuilt from a seed, so only the difference is worth keeping.
//
// In the Cache API rather than IndexedDB: it is one JSON blob under one key.

export interface Entry {
	method: string;
	path: string;
	body: unknown;
}

const CACHE = "jean-demo";
const KEY = "/__demo/journal";

// Replaying a longer journal costs a slower first paint. The oldest go first.
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
	// Debounced: a drag sends a burst of writes and is worth one serialisation.
	if (!saving) saving = setTimeout(save, 500);
}

export async function clear() {
	entries = [];
	if (saving) clearTimeout(saving);
	saving = null;
	const cache = await caches.open(CACHE);
	await cache.delete(KEY);
}
