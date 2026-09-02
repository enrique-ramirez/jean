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

	// ---- streaming ----
	// Absent on an older component, and absent means false. `undefined` here
	// would be indistinguishable from the default, so the switch is explicit and
	// `streamFormats` is what actually goes on the wire.
	canStream?: boolean;
	// **Best first**, as the component reports it. An install whose Windows has
	// no AAC encoder reports `opus` alone.
	streamFormats?: string[];
	// Formats this fake serves bytes for. Anything in `streamFormats` and not in
	// here gets bytes that are not the declared type, which is how the codec
	// fall-through gets exercised rather than assumed.
	playableFormats?: string[];
	// What the stream does once it is open. `short` ends after a second, for
	// reconnect. `quiet` opens and then sends nothing -- the case that models a
	// stopped player, and the one with no error to catch.
	streamBehaviour?: "ok" | "short" | "quiet";
	// Force a status on `POST /api/stream/ticket`. A 503 reads as "busy" or as
	// "not supported" depending on the wording, and the two want opposite
	// responses from a client.
	failTickets?: number | null;
	ticketError?: string;
	// Every ticket answers 401 at `GET /stream`, as an expired one does.
	expireTickets?: boolean;
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
	canStream: true,
	streamFormats: ["opus", "aac"],
	playableFormats: ["opus", "aac"],
	streamBehaviour: "ok",
	failTickets: null,
	ticketError: "",
	expireTickets: false,
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

// ---- the stream --------------------------------------------------------------

// Issued tickets. Not single-use -- Safari sends a `Range: bytes=0-1` probe
// before fetching for real, so one playback start is two requests and a ticket
// good once could not serve it at all.
const tickets = new Set<string>();
let ticketSeq = 0;
// Bounded the way the component bounds it: keep the last few and evict the
// oldest. Unused tickets are harmless, and a set that only grew would be a fake
// being kinder than the thing it stands in for.
const TICKET_LIMIT = 16;

const issue = () => {
	ticketSeq += 1;
	const ticket = `t${ticketSeq}`;
	tickets.add(ticket);
	if (tickets.size > TICKET_LIMIT)
		tickets.delete(tickets.values().next().value as string);
	return ticket;
};

const SAMPLE_RATE = 8000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
// Declared in the header and never actually sent: the response is chunked and
// ends when the client leaves. A browser reads until the socket closes.
const DECLARED_SECONDS = 3600;

// **Real playable bytes, in a codec neither `streamFormats` name.** What is
// under test is the ticket flow, the codec *choice*, the reconnect and the
// clock -- not the decoder, which is the component's business and Playwright
// cannot hear anyway. So the good case serves a WAV the browser will genuinely
// render `currentTime` against, and the bad case serves bytes that are not the
// declared type. Serving nothing playable at all would make every assertion
// about a running stream vacuous.
function wavHeader() {
	const data = DECLARED_SECONDS * BYTES_PER_SECOND;
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + data, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(SAMPLE_RATE, 24);
	header.writeUInt32LE(BYTES_PER_SECOND, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(data, 40);
	return header;
}

// A quiet tone rather than digital silence: some decoders shortcut a run of
// zeroes, and `currentTime` not advancing is the one thing every stream test
// asserts on.
function tone(seconds: number, phase: number) {
	const samples = SAMPLE_RATE * seconds;
	const buffer = Buffer.alloc(samples * 2);
	for (let at = 0; at < samples; at += 1)
		buffer.writeInt16LE(
			Math.round(
				Math.sin(((phase + at) * 2 * Math.PI * 440) / SAMPLE_RATE) * 600,
			),
			at * 2,
		);
	return buffer;
}

// `at`, `path` and `position` in the component's own terms. `streamTime` counts
// from when this fake started, which is what the client anchors against.
const startedAt = Date.now();

function timelineOf(state: FakeState) {
	const streamTime = (Date.now() - startedAt) / 1000;
	const item = state.player.activeItem;
	const playlist = item.index >= 0 ? state.playlistById(item.playlistId) : null;
	const track = playlist?.items[item.index];
	if (!track) return { streamTime, marks: [] };

	// One mark, placed so the track began `position` seconds ago in stream time.
	// Enough for the arithmetic; the component keeps a few.
	return {
		streamTime,
		marks: [
			{
				at: Math.max(0, streamTime - item.position),
				path: String(track["%path%"] ?? ""),
				subsong: 0,
				position: 0,
			},
		],
	};
}

// One endless chunked response. No length, no `Range`, no seeking -- and it ends
// only when the client leaves, the component stops, or the fake was asked to get
// it wrong on purpose.
function serveStream(
	response: ServerResponse,
	fake: FooJeanFake,
	format: string,
) {
	response.writeHead(200, {
		"Content-Type": fake.playableFormats.includes(format)
			? "audio/wav"
			: format === "aac"
				? "audio/aac"
				: "audio/ogg",
		"Cache-Control": "no-store",
		"Accept-Ranges": "none",
		// No explicit `Transfer-Encoding`: setting it by hand tells Node the
		// handler is doing its own chunk framing, and it then writes the bytes
		// raw into a response the client is still parsing as chunked. Node adds
		// the header itself when there is no `Content-Length`, which is what a
		// live stream wants.
	});

	// A format the element cannot play. Bytes that are not the declared type are
	// enough, and they must arrive *as* the declared type -- that is what makes
	// the element fail with `MEDIA_ERR_SRC_NOT_SUPPORTED` rather than never
	// starting, and so what exercises the fall-through rather than the watchdog.
	if (!fake.playableFormats.includes(format)) {
		response.write(Buffer.from("this is not audio, and never was.\n"));
		return response.end();
	}

	response.write(wavHeader());

	// Opens and then goes quiet: the header arrives, nothing follows, and there
	// is no error to catch. This is what a stopped player looks like from here,
	// and what the stall watchdog is the only answer to.
	if (fake.streamBehaviour === "quiet") return;

	// **Primed with a burst, then real time.** *Measured* in Chromium: a
	// non-seekable WAV does not fire `loadedmetadata` until roughly twelve
	// *seconds of content* have arrived -- not bytes, since raising the prime to
	// 15s moved playback start from 12.7s to 287ms while the byte rate was
	// unchanged. That is a property of PCM in a container never meant to be
	// streamed, and not of live streaming: Ogg and ADTS are designed for it and
	// the component serves those.
	//
	// So this is the fake being *kinder* than the component, deliberately and in
	// one narrow way: the stream starts sooner than a real one would. What that
	// could hide -- a long gap between asking and hearing -- is covered by the
	// `quiet` behaviour instead, which is that gap with no end to it.
	const PRIME_SECONDS = fake.streamBehaviour === "ok" ? 15 : 1;
	let phase = SAMPLE_RATE * PRIME_SECONDS;
	response.write(tone(PRIME_SECONDS, 0));

	// Ends after what it has already sent, for reconnect.
	if (fake.streamBehaviour === "short") return response.end();

	const pump = setInterval(() => {
		if (response.writableEnded) return clearInterval(pump);
		response.write(tone(0.25, phase));
		phase += SAMPLE_RATE * 0.25;
	}, 250);

	response.on("close", () => clearInterval(pump));
}

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

		// **The one route with no bearer token**, because an `<audio>` element
		// cannot send a header. The ticket is the credential and it travels in the
		// query string, so this is answered before the check below rather than
		// after it.
		if (path === "/api/stream") {
			const query = new URL(request.url ?? "/", "http://fake").searchParams;
			const ticket = query.get("ticket");
			const format = query.get("format") ?? fake.streamFormats[0];

			// No ticket, an unknown one and an expired one answer identically and
			// deliberately: telling them apart would let a caller sort guesses.
			if (!ticket || !tickets.has(ticket) || fake.expireTickets)
				return json(response, { error: "authentication required" }, 401);

			// A format outside the advertised list is a 400 rather than a silent
			// substitution -- a client that asked for `aac` and got Opus would play
			// silence on the browser it asked for `aac` for.
			if (!fake.streamFormats.includes(format))
				return json(response, { error: "unsupported format" }, 400);

			state.streamFormats.push(format);
			return serveStream(response, fake, format);
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
				maxAutoPlaylists: 0,
				canCreateAutoPlaylists: false,
				canStream: fake.canStream && fake.streamFormats.length > 0,
				// Omitted rather than empty when the component does not stream, which
				// is what an older one looks like.
				...(fake.canStream ? { streamFormats: fake.streamFormats } : null),
			});
		}

		if (method === "POST" && path === "/api/stream/ticket") {
			if (!fake.canStream || fake.streamFormats.length === 0)
				return json(
					response,
					{ error: "streaming is not available on this install" },
					503,
				);

			if (fake.failTickets)
				return json(
					response,
					{ error: fake.ticketError || "stream unavailable" },
					fake.failTickets,
				);

			return json(response, { ticket: issue(), expiresIn: 120 });
		}

		if (path === "/api/stream/timeline") {
			if (!fake.canStream)
				return json(response, { error: "streaming is not available" }, 503);
			return json(response, timelineOf(state));
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
