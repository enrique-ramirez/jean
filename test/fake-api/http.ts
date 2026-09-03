// The slice of node's `ServerResponse` the route tables use, so the same tables
// answer a real socket for the suite and a `fetch` event for the demo build's
// service worker. `ServerResponse` satisfies it structurally. Widening it grows
// a dependency on a socket the browser cannot provide.
export interface Responder {
	writeHead(status: number, headers?: Record<string, string>): unknown;
	setHeader(name: string, value: string): unknown;
	write(chunk: string | Uint8Array): unknown;
	end(body?: string | Uint8Array): unknown;
	// Only ever "close", and only ever to stop pushing at a client that left.
	on(event: "close", listener: () => void): unknown;
	// Node sets this; the browser shim keeps it in step.
	readonly writableEnded?: boolean;
}

// `IncomingHttpHeaders` without node. Lowercase keys, as both hosts deliver
// them.
export type RequestHeaders = Record<string, string | string[] | undefined>;

// Both return true so a route can `return json(...)` and have the router read
// that as handled; otherwise the request also gets a 404 written on top of it.
export const json = (response: Responder, body: unknown, status = 200) => {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(body));
	return true;
};

export const empty = (response: Responder, status = 204) => {
	response.writeHead(status);
	response.end();
	return true;
};

export const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".jpg": "image/jpeg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
};
