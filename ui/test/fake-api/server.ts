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

export interface FakeServer extends Server {
	readonly state: FakeState;
	reset: (next?: FakeState) => FakeState;
	agent: Server;
}

const HERE = dirname(fileURLToPath(import.meta.url));

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
	const held = { state };
	const agent = createFooJeanServer(() => held.state, serveArtwork);

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

		if (path.startsWith("/__control/")) {
			const body = method === "POST" ? await readBody(request) : null;
			return handleControl({ state, method, path, body, response });
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

// A content-derived ETag, which is what both servers answer with.
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
