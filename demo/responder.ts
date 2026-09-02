import type { Responder } from "../test/fake-api/http.ts";

// `ServerResponse` for a service worker. The fake's routes write a status, some
// headers and then bytes, and never learn which of the two they are talking to
// -- which is the whole point of `Responder`: the demo runs the player the
// suite runs, not a second one written to look like it.
//
// The `Response` resolves at `writeHead` rather than at `end`, because the
// update stream is answered and *then* written to for as long as the page is
// open. Waiting for the end of that would be waiting for the visitor to leave.
export interface Answer {
	response: Responder;
	// Resolves once the route has written its head. A route that answers nothing
	// never settles it, which is what `handled === false` is for.
	ready: Promise<Response>;
}

export function answer(): Answer {
	let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
	let settle: (response: Response) => void = () => {};
	const headers = new Headers();
	const closers = new Set<() => void>();
	let ended = false;
	let queued: Uint8Array[] = [];

	const encoder = new TextEncoder();
	const bytes = (chunk: string | Uint8Array) =>
		typeof chunk === "string" ? encoder.encode(chunk) : chunk;

	const push = (chunk: Uint8Array) => {
		// A route may write before the stream is pulled from; hold those rather
		// than dropping them.
		if (!controller) return queued.push(chunk);
		controller.enqueue(chunk);
	};

	const stream = new ReadableStream<Uint8Array>({
		start(next) {
			controller = next;
			for (const chunk of queued) controller.enqueue(chunk);
			queued = [];
			if (ended) controller.close();
		},
		// The page navigated away, or the `EventSource` was closed. Node calls
		// this "close" and so does everything subscribed to it.
		cancel() {
			ended = true;
			for (const close of closers) close();
			closers.clear();
		},
	});

	const ready = new Promise<Response>((resolve) => {
		settle = resolve;
	});

	const response: Responder = {
		writeHead(status, head) {
			for (const [name, value] of Object.entries(head ?? {}))
				headers.set(name, value);
			// 204 and 304 may carry no body at all, and a `Response` with one is a
			// TypeError rather than a bad answer.
			const empty = status === 204 || status === 304;
			settle(new Response(empty ? null : stream, { status, headers }));
			return response;
		},
		setHeader(name, value) {
			headers.set(name, value);
			return response;
		},
		write(chunk) {
			if (!ended) push(bytes(chunk));
			return true;
		},
		end(body) {
			if (ended) return response;
			if (body) push(bytes(body));
			ended = true;
			if (controller) controller.close();
			for (const close of closers) close();
			closers.clear();
			return response;
		},
		on(_event, listener) {
			if (ended) listener();
			else closers.add(listener);
			return response;
		},
		get writableEnded() {
			return ended;
		},
	};

	return { response, ready };
}
