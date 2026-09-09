import type { IncomingMessage, Server } from "node:http";
import { createServer as createHttpServer } from "node:http";

import { handleAgent } from "./fooJean.ts";
import type { createState } from "./state.ts";

type FakeState = ReturnType<typeof createState>;

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

	server.on("connection", (socket) => {
		if (!current().fooJean.reachable) socket.destroy();
	});

	return server;
}
