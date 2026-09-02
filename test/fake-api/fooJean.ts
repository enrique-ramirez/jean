import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer as createHttpServer } from "node:http";

import type { createState, Track } from "./state.ts";

type FakeState = ReturnType<typeof createState>;

// The optional tag-writing component, on a port of its own. Why a second
// listener rather than another route here is in `test/README.md`.

export interface FooJeanOptions {
	// What the discovery record says.
	listening?: boolean;
	error?: string;
	portInUse?: boolean;
	// Advertise a port other than the real one.
	port?: number;

	// `false` destroys the connection rather than answering 500. Those are
	// different events in a browser and the app has to tell them apart.
	reachable?: boolean;

	name?: string;
	// What answers on the advertised port, which is a different fact from what
	// the record claims. The two disagreeing is what a forgery looks like.
	agentName?: string;
	version?: string;
	apiVersion?: number;

	token?: string;
	allowedFields?: string[];

	// Force a status on `POST /api/tags`, for the branches nothing else provokes.
	failWrites?: number | null;
}

export interface FooJeanFake extends Required<Omit<FooJeanOptions, "port">> {
	port: number | null;
	installed: boolean;
}

const DEFAULTS: FooJeanFake = {
	installed: false,
	listening: true,
	error: "",
	portInUse: false,
	port: null,
	reachable: true,
	name: "foo_jean",
	agentName: "foo_jean",
	version: "0.1.0",
	apiVersion: 1,
	token: "0123456789abcdef0123456789abcdef",
	allowedFields: ["rating"],
	failWrites: null,
};

export const fooJeanState = (options: FooJeanOptions | null): FooJeanFake => ({
	...DEFAULTS,
	installed: options !== null,
	...options,
});

// `null` for "not installed" rather than a 404, as beefweb answers.
export const discoveryRecord = (fake: FooJeanFake, listeningPort: number) => {
	if (!fake.installed) return null;
	return {
		name: fake.name,
		version: fake.version,
		apiVersion: fake.apiVersion,
		port: fake.port ?? listeningPort,
		authRequired: true,
		listening: fake.listening,
		...(fake.listening
			? null
			: { error: fake.error, portInUse: fake.portInUse }),
	};
};

const json = (response: ServerResponse, body: unknown, status = 200) => {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(body));
};

// Reflected rather than `*`, which would let an implementation pass here and
// fail against the real component.
const cors = (request: IncomingMessage, response: ServerResponse) => {
	const origin = request.headers.origin;
	response.setHeader("Vary", "Origin");
	if (!origin) return;
	const addressed = (request.headers.host ?? "").split(":")[0];
	if (new URL(origin).hostname === addressed)
		response.setHeader("Access-Control-Allow-Origin", origin);
};

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

// Matched case-insensitively, as the component does.
const bearerOf = (request: IncomingMessage) =>
	/^bearer\s+(.+)$/i.exec(request.headers.authorization ?? "")?.[1] ?? null;

const FAILURES: Record<number, unknown> = {
	403: {
		written: false,
		error: "field not allowed",
		detail: "rating",
		field: "rating",
	},
	404: { written: false, error: "foobar2000 does not know that track" },
	500: { written: false, error: "the player could not write the tags" },
	503: { written: false, error: "tag writing is not available" },
	504: { written: false, error: "the player did not answer in time" },
};

// In place, so a reload reads the value back through beefweb -- which is what
// proves the app is not showing its own optimistic cache.
const applyTags = (
	state: FakeState,
	path: string,
	fields: Record<string, string>,
) => {
	const patch = (track: Track) => {
		if (track["%path%"] !== path) return false;
		for (const [field, value] of Object.entries(fields)) {
			// An empty string removes the tag, which then resolves to '?'.
			if (value === "") delete track[`%${field}%`];
			else track[`%${field}%`] = value;
		}
		return true;
	};

	let found = false;
	for (const playlist of state.playlists)
		for (const track of playlist.items) found = patch(track) || found;
	// Separate objects whenever `withoutFields` stripped them.
	for (const track of state.libraryTracks) found = patch(track) || found;
	return found;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Reads the same state box the beefweb fake does, so both halves of the feature
// land in one `player.requests` log.
export function createFooJeanServer(current: () => FakeState): Server {
	const server = createHttpServer(async (request, response) => {
		const state = current();
		const fake = state.fooJean;
		const method = request.method ?? "GET";
		const path = new URL(request.url ?? "/", "http://fake").pathname;

		// Before anything else, so a refused write is still visible to a spec.
		const body = method === "POST" ? await readBody(request) : null;
		state.record(method, path, body as never);

		cors(request, response);

		// Answered without a credential, and identically for every path.
		if (method === "OPTIONS") {
			response.writeHead(204, {
				"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
				"Access-Control-Allow-Headers": "Authorization, Content-Type",
				"Access-Control-Max-Age": "600",
			});
			return response.end();
		}

		// The only route with no credential.
		if (path === "/api/status") {
			return json(response, {
				name: fake.agentName,
				version: fake.version,
				apiVersion: fake.apiVersion,
				authRequired: true,
			});
		}

		// No `WWW-Authenticate`: it would raise a native credential dialog for a
		// scheme no browser can satisfy.
		if (bearerOf(request) !== fake.token)
			return json(response, { error: "authentication required" }, 401);

		if (path === "/api/capabilities") {
			return json(response, {
				apiVersion: fake.apiVersion,
				allowedFields: fake.allowedFields,
				canWrite: fake.allowedFields.length > 0,
			});
		}

		if (method === "POST" && path === "/api/tags") {
			// The same latency switch the beefweb fake honours.
			if (state.latency > 0) await delay(state.latency);

			if (fake.failWrites)
				return json(
					response,
					FAILURES[fake.failWrites] ?? { written: false, error: "refused" },
					fake.failWrites,
				);

			const written = body as {
				path?: string;
				subsong?: number;
				fields?: Record<string, string>;
			} | null;

			if (!written?.path || !written.fields)
				return json(
					response,
					{ written: false, error: "missing path", detail: "no path" },
					400,
				);

			const refused = Object.keys(written.fields).find(
				(field) =>
					!fake.allowedFields.some(
						(allowed) => allowed.toLowerCase() === field.toLowerCase(),
					),
			);
			if (refused)
				return json(
					response,
					{
						written: false,
						error: "field not allowed",
						detail: refused,
						field: refused,
					},
					403,
				);

			if (!applyTags(state, written.path, written.fields))
				return json(
					response,
					{ written: false, error: "foobar2000 does not know that track" },
					404,
				);

			return json(response, {
				written: true,
				path: written.path,
				subsong: written.subsong ?? 0,
				fields: written.fields,
			});
		}

		return json(response, { error: "not found" }, 404);
	});

	// Not answering is a state, and not the same as answering badly.
	server.on("connection", (socket) => {
		if (!current().fooJean.reachable) socket.destroy();
	});

	return server;
}
