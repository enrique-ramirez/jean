import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { handleFooJean } from "./fooJean.ts";
import { empty, MIME } from "./http.ts";
import { type ArtworkServer, handleControl } from "./routes.ts";
import { createState } from "./state.ts";

type FakeState = ReturnType<typeof createState>;

const HERE = dirname(fileURLToPath(import.meta.url));

interface ReadBody {
	body: Record<string, unknown> | null;
	bytes: number;
}

const readBody = (request: IncomingMessage): Promise<ReadBody> =>
	new Promise((resolve) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});
		request.on("end", () => {
			const raw = Buffer.concat(chunks);
			try {
				resolve({
					body: raw.length > 0 ? JSON.parse(raw.toString("utf8")) : null,
					bytes: raw.length,
				});
			} catch {
				resolve({ body: null, bytes: raw.length });
			}
		});
	});

const NO_BODY: ReadBody = { body: null, bytes: 0 };

function stampServerTiming(response: ServerResponse) {
	const arrived = performance.now();
	const writeHead = response.writeHead;
	response.writeHead = function stamped(
		this: ServerResponse,
		...args: Parameters<ServerResponse["writeHead"]>
	) {
		this.setHeader(
			"Server-Timing",
			`fake;dur=${(performance.now() - arrived).toFixed(2)}`,
		);
		return writeHead.apply(this, args);
	} as ServerResponse["writeHead"];
}

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

export function createFooJeanServer(
	current: () => FakeState,
	artwork: ArtworkServer,
): Server {
	const server = createHttpServer(async (request, response) => {
		const state = current();
		const method = request.method ?? "GET";
		const url = new URL(request.url ?? "/", "http://fake");
		const { body, bytes } =
			method === "POST" ? await readBody(request) : NO_BODY;

		await handleFooJean({
			state,
			method,
			url,
			headers: request.headers,
			body,
			bodyBytes: bytes,
			client: request.socket.remoteAddress ?? "",
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

// foo_jean's own policy for the page, `kPageContentPolicy` in `plugins/fb2k/src/core/routes_page.cpp`.
const PAGE_CONTENT_POLICY =
	"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; " +
	"media-src 'self' blob:; font-src 'self'; " +
	"connect-src 'self' https://musicbrainz.org https://www.wikidata.org https://en.wikipedia.org " +
	"https://lrclib.net; " +
	"object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

function serveFile(file: string, response: ServerResponse) {
	if (!existsSync(file)) return empty(response, 404);
	response.writeHead(200, {
		"Content-Type": MIME[extname(file)] ?? "application/octet-stream",
		"Content-Security-Policy": PAGE_CONTENT_POLICY,
	});
	createReadStream(file).pipe(response);
	return true;
}

export function createServer({
	state = createState(),
	serveDir = null,
}: {
	state?: FakeState;
	serveDir?: string | null;
} = {}): FakeServer {
	const held = { state };
	state.settledLargeNumbering();

	const server = createHttpServer(async (request, response) => {
		const { state } = held;
		const url = new URL(request.url ?? "/", "http://fake");
		const path = url.pathname;
		const method = request.method ?? "GET";

		if (path.startsWith("/api/")) {
			stampServerTiming(response);
			// Not installed reads the same as installed-but-unreachable to a client:
			// neither ever answers, and there is no page without the component that
			// would be serving it. `reachable: false` models both.
			if (!state.fooJean.reachable) {
				request.socket.destroy();
				return;
			}
			const { body, bytes } =
				method === "POST" ? await readBody(request) : NO_BODY;
			await handleFooJean({
				state,
				method,
				url,
				headers: request.headers,
				body,
				bodyBytes: bytes,
				client: request.socket.remoteAddress ?? "",
				response,
				artwork: serveArtwork,
			});
			return;
		}

		if (path.startsWith("/__control/")) {
			const { body } = method === "POST" ? await readBody(request) : NO_BODY;
			return handleControl({ state, method, path, body, response });
		}

		if (serveDir) return serveStatic(serveDir, path, response);
		return empty(response, 404);
	});

	const fake = server as FakeServer;
	Object.defineProperty(fake, "state", { get: () => held.state });

	fake.reset = (next: FakeState = createState()) => {
		held.state.fooJean.holdSummary = false;
		held.state.fooJean.holdQuestions = false;
		held.state.fooJean.holdRows = false;
		held.state.discard();
		held.state = next;
		next.settledLargeNumbering();
		return next;
	};

	return fake;
}
