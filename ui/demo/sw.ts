/// <reference lib="webworker" />

import { handleAgent } from "../test/fake-api/fooJean.ts";
import type { RequestHeaders } from "../test/fake-api/http.ts";
import type { ArtworkServer } from "../test/fake-api/routes.ts";
import { createState } from "../test/fake-api/state.ts";
import { withClock } from "./clock.ts";
import { append, clear, type Entry, load } from "./journal.ts";
import { type CapturedLibrary, demoLibrary } from "./library.ts";
import { answer } from "./responder.ts";

declare const self: ServiceWorkerGlobalScope;

// beefweb refuses a body over 1 MiB by hanging up. `Response.error()` is that
// same event in a browser: a network error rather than a status.
const MAX_BODY_BYTES = 1024 * 1024;

const REQUEST_LOG_LIMIT = 200;

// The capture, fetched once per worker. Held so a reset can rebuild the player
// without going back to the network for a library that has not changed.
let captured: CapturedLibrary | null = null;

const fetchLibrary = async () => {
	if (captured) return captured;
	const response = await fetch(
		new URL("library.json", self.registration.scope),
	);
	if (!response.ok) throw new Error(`demo library.json -> ${response.status}`);
	captured = (await response.json()) as CapturedLibrary;
	return captured;
};

const build = (library: CapturedLibrary) => {
	const demo = demoLibrary(library);
	return withClock(
		createState({
			playlists: demo.playlists,
			mediaLibrary: demo.tracks,
			artworkOf: demo.artworkOf,
			// Installed and listening; see `demo/CLAUDE.md`.
			fooJean: {
				allowedFields: ["rating"],
				canStream: false,
			},
		}),
	);
};

let state: ReturnType<typeof build> | null = null;

const headersOf = (request: Request): RequestHeaders => {
	const headers: RequestHeaders = {};
	request.headers.forEach((value, name) => {
		headers[name] = value;
	});
	// The component reflects the origin it was addressed from, and a same-origin
	// `fetch` sends neither of these -- both are set by the browser only when it
	// considers the request cross-origin, which from its point of view this is.
	headers.host ??= self.location.host;
	headers.origin ??= self.location.origin;
	return headers;
};

const readBody = async (request: Request) => {
	const raw = await request.text().catch(() => "");
	if (raw.length > MAX_BODY_BYTES) return { refused: true, body: null };
	if (!raw) return { refused: false, body: null };
	try {
		return { refused: false, body: JSON.parse(raw) as unknown };
	} catch {
		return { refused: false, body: null };
	}
};

const artwork: ArtworkServer = async (
	name,
	headers,
	response,
	cacheControl,
) => {
	const etag = `"${name}"`;
	const cached = { "Cache-Control": cacheControl, ETag: etag };

	if (headers["if-none-match"] === etag) {
		response.writeHead(304, cached);
		response.end();
		return true;
	}

	const file = await fetch(
		new URL(`artwork/${name}`, self.registration.scope),
	).catch(() => null);
	if (!file?.ok) {
		response.writeHead(404);
		response.end();
		return true;
	}

	response.writeHead(200, { ...cached, "Content-Type": "image/jpeg" });
	response.end(new Uint8Array(await file.arrayBuffer()));
	return true;
};

const dispatch = async (
	player: NonNullable<typeof state>,
	entry: Entry,
	url: URL,
) => {
	const { response } = answer();
	await handleAgent({
		state: player,
		method: entry.method,
		url,
		headers: {
			host: self.location.host,
			origin: self.location.origin,
			...(entry.method === "POST"
				? { "content-type": "application/json" }
				: null),
		},
		body: entry.body,
		response,
		artwork,
	});
};

const start = async () => {
	const player = build(await fetchLibrary());
	for (const entry of await load())
		await dispatch(player, entry, new URL(entry.path, self.location.origin));
	state = player;
};

// Named `booted` rather than `ready`: `serve` destructures a `ready` out of
// `answer()`, so a module binding of that name would be shadowed by it, and
// awaiting it at the top of that function would hit the temporal dead zone.
let booted = start();

async function serve(request: Request, url: URL): Promise<Response> {
	await booted;
	const player = state as NonNullable<typeof state>;

	// Nothing here reads the log, and a demo left open all afternoon would grow an
	// entry per keystroke of search.
	if (player.requests.length > REQUEST_LOG_LIMIT)
		player.requests.splice(0, player.requests.length - REQUEST_LOG_LIMIT);

	const method = request.method;
	const { refused, body } =
		method === "POST"
			? await readBody(request)
			: { refused: false, body: null };
	if (refused) return Response.error();

	// Only writes are journalled; reads rebuild from the state the writes made.
	if (method === "POST") append({ method, path: url.href, body });

	const { response, ready } = answer();

	await handleAgent({
		state: player,
		method,
		url,
		headers: headersOf(request),
		body,
		response,
		artwork,
	});
	return ready;
}

async function control(url: URL): Promise<Response> {
	if (url.pathname.endsWith("/reset")) {
		await clear();
		// Rebuilt from the held capture rather than refetched: a reset is about the
		// writes on top of the library, not the library.
		state = build(await fetchLibrary());
		booted = Promise.resolve();
		return new Response(null, { status: 204 });
	}
	return new Response(null, { status: 404 });
}

self.addEventListener("install", () => {
	// The page registers with `updateViaCache: 'none'` for the other half of
	// this.
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	const here = url.origin === self.location.origin;

	if (here && url.pathname.startsWith("/__demo/"))
		return event.respondWith(control(url));

	// Everything else, including the artist lookup that is genuinely on the
	// internet, goes to the network untouched.
	if (!here || !url.pathname.startsWith("/api/")) return;

	event.respondWith(serve(event.request, url));
});
