import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { handleAgent } from "./fooJean.ts";
import { empty, MIME } from "./http.ts";
import { type ArtworkServer, handleControl } from "./routes.ts";
import { createState } from "./state.ts";

type FakeState = ReturnType<typeof createState>;

const HERE = dirname(fileURLToPath(import.meta.url));

const readBody = (
	request: IncomingMessage,
): Promise<Record<string, unknown> | null> =>
	new Promise((resolve) => {
		let raw = "";
		request.on("data", (chunk: Buffer | string) => {
			raw += chunk;
		});
		request.on("end", () => {
			try {
				resolve(raw ? JSON.parse(raw) : null);
			} catch {
				resolve(null);
			}
		});
	});

const etags = new Map<string, string>();

const serveArtwork: ArtworkServer = (
	name,
	requestHeaders,
	response,
	cacheControl,
) => {
	const file = join(HERE, "artwork", name);
	if (!existsSync(file)) return empty(response, 404);

	let etag = etags.get(file);
	if (!etag) {
		etag = `"${createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 16)}"`;
		etags.set(file, etag);
	}

	const headers = {
		"Cache-Control": cacheControl,
		ETag: etag,
		"Content-Type": MIME[extname(file)] ?? "application/octet-stream",
	};

	if (requestHeaders["if-none-match"] === etag) {
		response.writeHead(304, headers);
		response.end();
		return true;
	}

	response.writeHead(200, headers);
	response.end(readFileSync(file));
	return true;
};

// The component's own API, on its own server: used directly by a unit test that has no need of
// the static build or the `/__control/` routes the suite's `createServer` below also answers.
export function createFooJeanServer(
	current: () => FakeState,
	artwork: ArtworkServer,
): Server {
	const server = createHttpServer(async (request, response) => {
		const state = current();
		const method = request.method ?? "GET";
		const url = new URL(request.url ?? "/", "http://fake");
		const body = method === "POST" ? await readBody(request) : null;

		await handleAgent({
			state,
			method,
			url,
			headers: request.headers,
			body,
			response,
			artwork,
		});
	});

	server.on("connection", (socket) => {
		if (!current().fooJean.reachable) socket.destroy();
	});

	return server;
}

export interface FakeServer extends Server {
	readonly state: FakeState;
	reset: (next?: FakeState) => FakeState;
}

function serveStatic(root: string, path: string, response: ServerResponse) {
	const relative = path === "/" ? "/index.html" : path;
	const file = join(root, normalize(relative).replace(/^(\.\.[/\\])+/, ""));
	if (!existsSync(file) || !statSync(file).isFile()) {
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

// The suite's one server: Jean's build, `/api/` and `/__control/`, on one port, the way
// `foo_jean` itself answers all three.
export function createServer({
	state = createState(),
	serveDir = null,
}: {
	state?: FakeState;
	serveDir?: string | null;
} = {}): FakeServer {
	const held = { state };

	const server = createHttpServer(async (request, response) => {
		const { state } = held;
		const url = new URL(request.url ?? "/", "http://fake");
		const path = url.pathname;
		const method = request.method ?? "GET";

		if (path.startsWith("/api/")) {
			// Not installed reads the same as installed-but-unreachable to a client:
			// neither ever answers, and there is no page without the component that
			// would be serving it. `reachable: false` models both.
			if (!state.fooJean.reachable) {
				request.socket.destroy();
				return;
			}
			const body = method === "POST" ? await readBody(request) : null;
			await handleAgent({
				state,
				method,
				url,
				headers: request.headers,
				body,
				response,
				artwork: serveArtwork,
			});
			return;
		}

		if (path.startsWith("/__control/")) {
			const body = method === "POST" ? await readBody(request) : null;
			return handleControl({ state, method, path, body, response });
		}

		if (serveDir) return serveStatic(serveDir, path, response);
		return empty(response, 404);
	});

	const fake = server as FakeServer;
	Object.defineProperty(fake, "state", { get: () => held.state });

	fake.reset = (next: FakeState = createState()) => {
		held.state = next;
		return next;
	};

	return fake;
}
