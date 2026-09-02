import type { IncomingMessage, Server } from "node:http";
import { createServer as createHttpServer } from "node:http";

import { handleAgent } from "./fooJean.ts";
import type { createState } from "./state.ts";

type FakeState = ReturnType<typeof createState>;

// The socket under `handleAgent`. The component runs beside the player rather
// than inside it, so every call to it is cross-origin and can fail by not
// answering at all -- which is why the fake gives it a listener of its own
// rather than another route on the beefweb one.

const readBody = (request: IncomingMessage): Promise<unknown> =>
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

// Reads the same state box the beefweb fake does, so both halves of the feature
// land in one `player.requests` log.
export function createFooJeanServer(current: () => FakeState): Server {
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
		});
	});

	// Not answering is a state, and not the same as answering badly.
	server.on("connection", (socket) => {
		if (!current().fooJean.reachable) socket.destroy();
	});

	return server;
}
