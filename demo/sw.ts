/// <reference lib="webworker" />

import { handleAgent } from "../test/fake-api/fooJean.ts";
import type { RequestHeaders } from "../test/fake-api/http.ts";
import { type ArtworkServer, handleApi } from "../test/fake-api/routes.ts";
import { createState } from "../test/fake-api/state.ts";
import { withClock } from "./clock.ts";
import { coverSvg } from "./cover.ts";
import { append, clear, type Entry, load } from "./journal.ts";
import { coverOf, demoLibrary } from "./library.ts";
import { answer } from "./responder.ts";

// The demo's player, on the same routes the suite runs against. Everything Jean
// asks beefweb for is answered here rather than over a network, so the page can
// be a handful of static files on GitHub Pages and still be the whole app.
//
// A service worker rather than a patched `fetch`, and the reason is one line of
// the app: covers are `<img src="/api/artwork/...">`. Only a worker catches
// those, and catching them is what lets the app run **unmodified** -- it still
// believes it is talking to beefweb, same origin, exactly as when beefweb is
// serving it.

declare const self: ServiceWorkerGlobalScope;

// The port the component advertises. Nothing listens on it -- the requests are
// answered here, before they reach a network -- but the number has to be a real
// one, because the app is entitled to build a URL out of it.
const AGENT_PORT = 8881;

// beefweb refuses a body over 1 MiB by hanging up. `Response.error()` is that
// same event in a browser: a network error rather than a status.
const MAX_BODY_BYTES = 1024 * 1024;

const REQUEST_LOG_LIMIT = 200;

const build = () =>
	withClock(
		createState({
			// Both sources describe the same library, as they do on a real 0.11
			// player: the media library API and the `#Jean Library` autoplaylist.
			mediaLibrary: demoLibrary(),
			artworkOf: coverOf,
			// Installed, listening, and paired -- see `demo/CLAUDE.md` for why the
			// demo shows the component present rather than absent. Streaming is off:
			// there is no audio here, and `canStream: false` is a real state the app
			// already draws correctly rather than a hole in the fake.
			fooJean: {
				port: AGENT_PORT,
				allowedFields: ["rating"],
				canStream: false,
			},
		}),
	);

let state = build();

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

// ---- artwork ---------------------------------------------------------------

// The five captured sleeves are files, copied into the build beside `sw.js`;
// everything else is drawn. Both answer with the player's own cache terms,
// which is not decoration: without them the browser refetches a cover it drew a
// moment ago, and twelve rows of one album are twelve requests whatever the app
// does.
const artwork: ArtworkServer = async (name, headers, response) => {
	const etag = `"${name}"`;
	const cached = {
		"Cache-Control": "max-age=3, must-revalidate",
		ETag: etag,
	};

	if (headers["if-none-match"] === etag) {
		response.writeHead(304, cached);
		response.end();
		return true;
	}

	if (name.startsWith("album:")) {
		response.writeHead(200, { ...cached, "Content-Type": "image/svg+xml" });
		response.end(coverSvg(name.slice("album:".length)));
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

// ---- the journal -----------------------------------------------------------

const isAgent = (url: URL) =>
	url.hostname === self.location.hostname && url.port === String(AGENT_PORT);

// Replayed on the way up, so a reload -- or the browser having shut the worker
// down between two clicks -- keeps what somebody did rather than quietly
// starting over.
const dispatch = async (entry: Entry, url: URL) => {
	const { response } = answer();
	if (isAgent(url))
		await handleAgent({
			state,
			method: entry.method,
			url,
			headers: { host: self.location.host, origin: self.location.origin },
			body: entry.body,
			response,
		});
	else
		await handleApi({
			state,
			method: entry.method,
			path: url.pathname,
			url,
			body: entry.body as Record<string, unknown>,
			headers: {},
			response,
			agentPort: AGENT_PORT,
			artwork,
		});
};

let restored = (async () => {
	for (const entry of await load())
		await dispatch(entry, new URL(entry.path, self.location.origin));
})();

// ---- serving ---------------------------------------------------------------

async function serve(request: Request, url: URL): Promise<Response> {
	await restored;

	// Both halves of the fake record into this one log, and nothing here reads
	// it: a demo left open all afternoon would otherwise grow an entry per
	// keystroke of search.
	if (state.requests.length > REQUEST_LOG_LIMIT)
		state.requests.splice(0, state.requests.length - REQUEST_LOG_LIMIT);

	const method = request.method;
	const { refused, body } =
		method === "POST"
			? await readBody(request)
			: { refused: false, body: null };
	if (refused) return Response.error();

	// A write, and therefore worth keeping. Reads rebuild themselves from the
	// state the writes produced.
	if (method === "POST") append({ method, path: url.href, body });

	const { response, ready } = answer();

	if (isAgent(url)) {
		await handleAgent({
			state,
			method,
			url,
			headers: headersOf(request),
			body,
			response,
		});
		return ready;
	}

	const handled = await handleApi({
		state,
		method,
		path: url.pathname,
		url,
		body: body as Record<string, unknown>,
		headers: headersOf(request),
		response,
		agentPort: AGENT_PORT,
		artwork,
	});

	if (handled) return ready;
	return new Response(
		JSON.stringify({ error: `no fake route for ${method} ${url.pathname}` }),
		{ status: 404, headers: { "Content-Type": "application/json" } },
	);
}

// The demo's own control surface, which the app knows nothing about. One route:
// putting the library back the way it was found.
async function control(url: URL): Promise<Response> {
	if (url.pathname.endsWith("/reset")) {
		await clear();
		state = build();
		restored = Promise.resolve();
		return new Response(null, { status: 204 });
	}
	return new Response(null, { status: 404 });
}

self.addEventListener("install", () => {
	// A demo nobody can update is a demo of whatever it was in March. The page
	// registers with `updateViaCache: 'none'` for the other half of this.
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

	// Everything else -- the app's own files, and the artist lookup, which is
	// genuinely on the internet -- goes to the network untouched.
	if (!isAgent(url) && !(here && url.pathname.startsWith("/api/"))) return;

	event.respondWith(serve(event.request, url));
});
