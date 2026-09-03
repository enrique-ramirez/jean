import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { createFooJeanServer } from "./agentServer.ts";
import { empty, json, MIME } from "./http.ts";
import { type ArtworkServer, handleApi, handleControl } from "./routes.ts";
import { createState } from "./state.ts";

type FakeState = ReturnType<typeof createState>;

// A parsed JSON request body, or null when there was none or it did not parse.
// Loose on purpose: the router reads whatever field a route expects.
// biome-ignore lint/suspicious/noExplicitAny: see above
type RequestBody = Record<string, any> | null;

// The server, plus the seam a test run swaps the player through.
export interface FakeServer extends Server {
	readonly state: FakeState;
	reset: (next?: FakeState) => FakeState;
	// `foo_jean`, on a port of its own. Started and stopped by the fixture that
	// owns this one.
	agent: Server;
}

// The socket under `routes.ts`, plus the two things a real filesystem answers:
// the build beefweb serves and the cover art.

const HERE = dirname(fileURLToPath(import.meta.url));

// beefweb refuses a request body over 1 MiB by hanging up rather than answering:
// past the cap the socket is closed mid-upload, which arrives at the client as a
// network error and not as a status code.
const MAX_BODY_BYTES = 1024 * 1024;

const readBody = (request: IncomingMessage): Promise<RequestBody> =>
	new Promise((resolve) => {
		let raw = "";
		let refused = false;
		request.on("data", (chunk: Buffer | string) => {
			if (refused) return;
			raw += chunk;
			if (raw.length > MAX_BODY_BYTES) {
				refused = true;
				request.destroy();
				resolve(null);
			}
		});
		request.on("end", () => {
			if (refused) return;
			if (!raw) return resolve(null);
			try {
				resolve(JSON.parse(raw));
			} catch {
				resolve(null);
			}
		});
	});

export function createServer({
	state = createState(),
	serveDir = null,
}: {
	state?: FakeState;
	serveDir?: string | null;
} = {}): FakeServer {
	// Held in a box rather than closed over, so a test run can swap the whole
	// player out without tearing the server down.
	const held = { state };
	const agent = createFooJeanServer(() => held.state);

	const server = createHttpServer(async (request, response) => {
		const { state } = held;
		const url = new URL(request.url ?? "/", "http://fake");
		const path = url.pathname;
		const method = request.method ?? "GET";

		if (path.startsWith("/api/")) {
			const body = method === "POST" ? await readBody(request) : null;
			state.record(method, path + url.search, body);
			const handled = await handleApi({
				state,
				method,
				path,
				url,
				body,
				headers: request.headers,
				response,
				agentPort: portOf(agent),
				artwork: serveArtwork,
			});
			if (handled) return;
			return json(
				response,
				{ error: `no fake route for ${method} ${path}` },
				404,
			);
		}

		// A control surface the app knows nothing about, so tests can reach the
		// player's state without going through the UI under test.
		if (path.startsWith("/__control/")) {
			const body = method === "POST" ? await readBody(request) : null;
			return handleControl({ state, path, body, response });
		}

		if (serveDir) return serveStatic(serveDir, path, response);
		return empty(response, 404);
	});

	const fake = server as FakeServer;
	Object.defineProperty(fake, "state", { get: () => held.state });
	fake.agent = agent;

	// Any stream still open belongs to the state being replaced.
	fake.reset = (next: FakeState = createState()) => {
		held.state = next;
		return next;
	};

	return fake;
}

const portOf = (server: Server) => {
	const address = server.address();
	return typeof address === "object" && address ? address.port : 0;
};

function serveStatic(root: string, path: string, response: ServerResponse) {
	const relative = path === "/" ? "/index.html" : path;
	const file = join(root, normalize(relative).replace(/^(\.\.[/\\])+/, ""));
	if (!existsSync(file) || !statSync(file).isFile()) {
		// No SPA fallback, because beefweb's static server has none: a deep path
		// is a genuine 404 there, which is why the app uses hash routing.
		return empty(response, 404);
	}
	return serveFile(file, response);
}

function serveFile(file: string, response: ServerResponse) {
	if (!existsSync(file)) return empty(response, 404);
	response.writeHead(200, {
		"Content-Type": MIME[extname(file)] ?? "application/octet-stream",
	});
	createReadStream(file).pipe(response);
	return true;
}

// The caching terms are the player's: foobar2000 answers `Cache-Control:
// max-age=3, must-revalidate` with a content-derived ETag, and a 304 for a
// conditional request that matches.
//
// Content-derived is not the same as shared: two indices off one album carry the
// same ETag, but an HTTP cache is keyed by URL, so it never matches across two
// rows unless the URL is shared too. Hence `albumCoverRows`.
const etags = new Map<string, string>();

const serveArtwork: ArtworkServer = (name, requestHeaders, response) => {
	const file = join(HERE, "artwork", name);
	if (!existsSync(file)) return empty(response, 404);

	let etag = etags.get(file);
	if (!etag) {
		etag = `"${createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 16)}"`;
		etags.set(file, etag);
	}

	const headers = {
		"Cache-Control": "max-age=3, must-revalidate",
		ETag: etag,
		"Content-Type": MIME[extname(file)] ?? "application/octet-stream",
	};

	if (requestHeaders["if-none-match"] === etag) {
		response.writeHead(304, headers);
		response.end();
		return true;
	}

	// Read whole rather than piped: `Responder` is not a node stream.
	response.writeHead(200, headers);
	response.end(readFileSync(file));
	return true;
};
