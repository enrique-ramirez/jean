import { empty, json, type RequestHeaders, type Responder } from "./http.ts";
import type { createState, Track } from "./state.ts";

type FakeState = ReturnType<typeof createState>;

export interface FooJeanOptions {
	listening?: boolean;
	error?: string;
	portInUse?: boolean;
	port?: number;

	reachable?: boolean;

	// A loaded machine or a phone at the edge of the wifi: how many `/api/status`
	// probes answer only after the client has given up on them, with the fault
	// gone by the next attempt.
	slowStatus?: number;

	name?: string;
	// What answers on the advertised port, which is a different fact from what the
	// record claims. The two disagreeing is what a forged record looks like.
	agentName?: string;
	version?: string;
	apiVersion?: number;

	token?: string;
	allowedFields?: string[];

	failWrites?: number | null;

	maxAutoPlaylists?: number;
	// beefweb ids the component reports as already being autoplaylists, whether it
	// made them or not. An autoplaylist created in foobar2000 itself looks like
	// this and is not one Jean may update or delete.
	autoPlaylists?: string[];
	libraryEnabled?: boolean;
	failCreate?: number | null;

	canStream?: boolean;
	// Best first, as the component reports it. An install whose Windows has no AAC
	// encoder reports `opus` alone.
	streamFormats?: string[];
	playableFormats?: string[];
	streamBehaviour?: "ok" | "short" | "quiet";
	streamPrime?: number;
	failTickets?: number | null;
	ticketError?: string;
	expireTickets?: boolean;
	canMuteWhileStreaming?: boolean;
	// Devices the component reports as listening, beside whatever this browser
	// opens. Named as a client named itself, and never carrying an address.
	otherListeners?: {
		deviceId: string;
		name: string | null;
		format?: string;
		connections?: number;
		listeningFor?: number;
	}[];

	pairingOpen?: boolean;
	failPairing?: number | null;
	pairingError?: string;
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
	slowStatus: 0,
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
	streamPrime: 15,
	failTickets: null,
	ticketError: "",
	expireTickets: false,
	canMuteWhileStreaming: true,
	otherListeners: [],
	pairingOpen: false,
	failPairing: null,
	pairingError: "",
	maxAutoPlaylists: 0,
	autoPlaylists: [],
	libraryEnabled: true,
	failCreate: null,
};

export const fooJeanState = (options: FooJeanOptions | null): FooJeanFake => ({
	...DEFAULTS,
	installed: options !== null,
	...options,
});

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

const one = (value: string | string[] | undefined) =>
	(Array.isArray(value) ? value[0] : value) ?? "";

const cors = (headers: RequestHeaders, response: Responder) => {
	const origin = one(headers.origin);
	response.setHeader("Vary", "Origin");
	if (!origin) return;
	const addressed = one(headers.host).split(":")[0];
	if (new URL(origin).hostname === addressed)
		response.setHeader("Access-Control-Allow-Origin", origin);
};

// Matched case-insensitively, as the component does.
const bearerOf = (headers: RequestHeaders) =>
	/^bearer\s+(.+)$/i.exec(one(headers.authorization))?.[1] ?? null;

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

const applyTags = (
	state: FakeState,
	path: string,
	fields: Record<string, string>,
) => {
	const patch = (track: Track) => {
		if (track["%path%"] !== path) return false;
		for (const [field, value] of Object.entries(fields)) {
			if (value === "") delete track[`%${field}%`];
			else track[`%${field}%`] = value;
		}
		return true;
	};

	let found = false;
	for (const playlist of state.playlists)
		for (const track of playlist.items) found = patch(track) || found;
	// Separate objects whenever `withoutFields` stripped them, so patch both.
	for (const track of state.libraryTracks) found = patch(track) || found;
	return found;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Bounded, so a client that waits forever still gets its socket back.
const abandoned = (response: Responder, within: number) =>
	new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => resolve(false), within);
		response.on("close", () => {
			clearTimeout(timer);
			resolve(true);
		});
	});

// The device an <audio> element belongs to, remembered from the request that
// minted its ticket: the element itself sends no body and no header.
const ticketDevices = new Map<
	string,
	{ deviceId: string; name: string | null }
>();

const tickets = new Set<string>();
let ticketSeq = 0;
// Bounded the way the component bounds it: keep the last few, evict the oldest.
// The count is opaque from here; treat it as the component's own choice, not a
// number to tune.
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

// Real playable bytes, in a codec neither `streamFormats` names: the browser has
// to render `currentTime` against something, and the decoder is not under test.
function wavHeader() {
	const data = DECLARED_SECONDS * BYTES_PER_SECOND;
	const header = new Uint8Array(44);
	const view = new DataView(header.buffer);
	const ascii = (text: string, at: number) => {
		for (let index = 0; index < text.length; index += 1)
			header[at + index] = text.charCodeAt(index);
	};
	ascii("RIFF", 0);
	view.setUint32(4, 36 + data, true);
	ascii("WAVEfmt ", 8);
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, BYTES_PER_SECOND, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	ascii("data", 36);
	view.setUint32(40, data, true);
	return header;
}

// A quiet tone rather than digital silence: some decoders shortcut a run of
// zeroes and `currentTime` then does not advance.
function tone(seconds: number, phase: number) {
	const samples = SAMPLE_RATE * seconds;
	const buffer = new Int16Array(samples);
	for (let at = 0; at < samples; at += 1)
		buffer[at] = Math.round(
			Math.sin(((phase + at) * 2 * Math.PI * 440) / SAMPLE_RATE) * 600,
		);
	return new Uint8Array(buffer.buffer);
}

const PRERUN_MS = 60_000;
const startedAt = Date.now() - PRERUN_MS;

function timelineOf(state: FakeState) {
	const streamTime = (Date.now() - startedAt) / 1000;

	if (state.streamMarks.length > 0) {
		return {
			streamTime,
			marks: state.streamMarks.map((entry) => ({
				at: Math.max(0, (entry.atMs - startedAt) / 1000),
				path: entry.path,
				subsong: entry.subsong,
				position: entry.position,
			})),
		};
	}

	const item = state.player.activeItem;
	const playlist = item.index >= 0 ? state.playlistById(item.playlistId) : null;
	const track = playlist?.items[item.index];
	if (!track) return { streamTime, marks: [] };

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

function serveStream(response: Responder, fake: FooJeanFake, format: string) {
	response.writeHead(200, {
		"Content-Type": fake.playableFormats.includes(format)
			? "audio/wav"
			: format === "aac"
				? "audio/aac"
				: "audio/ogg",
		"Cache-Control": "no-store",
		"Accept-Ranges": "none",
		// No explicit `Transfer-Encoding`: setting it by hand tells Node the handler
		// is doing its own chunk framing, and it then writes the bytes raw into a
		// response the client is still parsing as chunked. Node adds the header
		// itself when there is no `Content-Length`.
	});

	// A format the element cannot play. The bytes must arrive as the declared type,
	// so the element fails with `MEDIA_ERR_SRC_NOT_SUPPORTED` rather than stalling.
	if (!fake.playableFormats.includes(format)) {
		response.write("this is not audio, and never was.\n");
		return response.end();
	}

	response.write(wavHeader());

	if (fake.streamBehaviour === "quiet") return;

	// See test/README.md for the `12 - prime` arithmetic this rests on.
	const PRIME_SECONDS = fake.streamBehaviour === "ok" ? fake.streamPrime : 1;
	let phase = SAMPLE_RATE * PRIME_SECONDS;
	response.write(tone(PRIME_SECONDS, 0));

	if (fake.streamBehaviour === "short") return response.end();

	const pump = setInterval(() => {
		if (response.writableEnded) return clearInterval(pump);
		response.write(tone(0.25, phase));
		phase += SAMPLE_RATE * 0.25;
	}, 250);

	response.on("close", () => clearInterval(pump));
}

export async function handleAgent({
	state,
	method,
	url,
	headers,
	body,
	response,
}: {
	state: FakeState;
	method: string;
	url: URL;
	headers: RequestHeaders;
	body: unknown;
	response: Responder;
}) {
	const fake = state.fooJean;
	const path = url.pathname;

	state.record(method, path, body as never);

	cors(headers, response);

	if (method === "OPTIONS") {
		response.writeHead(204, {
			"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Authorization, Content-Type",
			"Access-Control-Max-Age": "600",
		});
		return response.end();
	}

	if (path === "/api/status") {
		if (fake.slowStatus > 0) {
			fake.slowStatus -= 1;
			if (await abandoned(response, 8000)) return true;
		}
		return json(response, {
			name: fake.agentName,
			version: fake.version,
			apiVersion: fake.apiVersion,
			authRequired: true,
		});
	}

	if (method === "POST" && path === "/api/pair") {
		if (!one(headers["content-type"]).startsWith("application/json"))
			return json(response, { error: "send application/json" }, 415);

		if (fake.failPairing)
			return json(
				response,
				{ error: fake.pairingError || "pairing is not open" },
				fake.failPairing,
			);

		if (!fake.pairingOpen)
			return json(response, { error: "pairing is not open" }, 403);

		fake.pairingOpen = false;
		return json(response, { token: fake.token, apiVersion: fake.apiVersion });
	}

	// No bearer token, because an `<audio>` element cannot send a header. The
	// ticket is the credential and travels in the query string.
	if (path === "/api/stream") {
		const query = url.searchParams;
		const ticket = query.get("ticket");
		const format = query.get("format") ?? fake.streamFormats[0];

		// No ticket, an unknown one and an expired one answer identically: telling
		// them apart would let a caller sort guesses.
		if (!ticket || !tickets.has(ticket) || fake.expireTickets)
			return json(response, { error: "authentication required" }, 401);

		// A format outside the advertised list is a 400 rather than a silent
		// substitution, which would play as silence on the browser that asked.
		if (!fake.streamFormats.includes(format))
			return json(response, { error: "unsupported format" }, 400);

		state.streamFormats.push(format);

		state.openStreams += 1;
		state.peakStreams = Math.max(state.peakStreams, state.openStreams);
		response.on("close", () => {
			state.openStreams -= 1;
		});

		// One device however many sockets it holds: Safari opens two, and a
		// reconnect is a third, and none of that is another person.
		const device = ticketDevices.get(ticket);
		if (device?.deviceId) {
			const known = state.streamDevices.get(device.deviceId);
			state.streamDevices.set(device.deviceId, {
				deviceId: device.deviceId,
				name: device.name,
				format,
				connections: (known?.connections ?? 0) + 1,
				listeningFor: known?.listeningFor ?? 0,
			});
			state.announceHold();
		}

		return serveStream(response, fake, format);
	}

	// No `WWW-Authenticate`: it would raise a native credential dialog for a
	// scheme no browser can satisfy.
	if (bearerOf(headers) !== fake.token)
		return json(response, { error: "authentication required" }, 401);

	if (path === "/api/capabilities") {
		return json(response, {
			apiVersion: fake.apiVersion,
			allowedFields: fake.allowedFields,
			canWrite: fake.allowedFields.length > 0,
			maxAutoPlaylists: fake.maxAutoPlaylists,
			canCreateAutoPlaylists: fake.maxAutoPlaylists > 0,
			canStream: fake.canStream && fake.streamFormats.length > 0,
			canMuteWhileStreaming: fake.canMuteWhileStreaming,
			...(fake.canStream ? { streamFormats: fake.streamFormats } : null),
		});
	}

	if (path === "/api/playlists") {
		return json(response, {
			playlists: state.playlists.map((playlist, index) => ({
				id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
				beefwebId: playlist.id,
				index,
				title: playlist.title,
				isAutoPlaylist: fake.autoPlaylists.includes(playlist.id),
				managed: null,
			})),
		});
	}

	if (method === "POST" && path === "/api/autoplaylists/preview") {
		const asked = body as { query?: string } | null;
		const query = String(asked?.query ?? "");
		const valid = query.length > 0 && !query.includes("((");
		return json(response, {
			valid,
			error: valid ? "" : "Query syntax error",
			matches: valid && fake.libraryEnabled ? state.previewMatches(query) : 0,
			libraryEnabled: fake.libraryEnabled,
		});
	}

	if (method === "POST" && path === "/api/autoplaylists") {
		if (fake.maxAutoPlaylists === 0)
			return json(response, { error: "autoplaylists are not available" }, 503);
		if (fake.failCreate)
			return json(
				response,
				{ error: "the player could not do that" },
				fake.failCreate,
			);

		const asked = body as {
			title?: string;
			key?: string;
			query?: string;
		} | null;
		const title = String(asked?.title ?? "");
		const made = state.addPlaylist(title);
		fake.autoPlaylists.push(made.id);

		return json(response, {
			id: `00000000-0000-0000-0000-${String(state.playlists.length).padStart(12, "0")}`,
			// Real beefweb assigns its ids lazily, so `beefwebId` is `null` there until
			// beefweb's own playlists are next read. This fake has already made the
			// playlist, so the join key is available immediately — a spec relying on
			// that timing would not hold against a real install.
			beefwebId: made.id,
			index: state.playlists.length - 1,
			title: made.title,
			isAutoPlaylist: true,
			managed: {
				key: String(asked?.key ?? ""),
				query: String(asked?.query ?? ""),
				sort: "",
				forceSort: false,
			},
		});
	}

	if (path === "/api/stream/listeners") {
		const here = [...state.streamDevices.values()];
		const others = fake.otherListeners.map((device) => ({
			deviceId: device.deviceId,
			name: device.name,
			format: device.format ?? "opus",
			connections: device.connections ?? 1,
			listeningFor: device.listeningFor ?? 0,
		}));
		const devices = [...here, ...others];

		return json(response, {
			devices,
			connections: devices.reduce(
				(total, device) => total + device.connections,
				0,
			),
			maxConnections: 8,
			playerMuted: state.playerHeld,
		});
	}

	if (method === "DELETE" && path === "/api/stream/hold") {
		if (!fake.canMuteWhileStreaming)
			return json(response, { error: "this install does not mute" }, 503);

		state.holdReleased = true;
		state.announceHold();
		return empty(response);
	}

	if (method === "POST" && path === "/api/stream/leave") {
		const said = (body ?? {}) as { deviceId?: string };
		if (!said.deviceId)
			return json(response, { error: "deviceId is required" }, 400);

		state.streamDevices.delete(said.deviceId);
		// The choice to hear both outputs was scoped to the spell of listening it
		// was made in, so it goes when the last listener does.
		if (!state.playerHeld) state.holdReleased = false;
		state.announceHold();

		return empty(response);
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

		const said = (body ?? {}) as { deviceId?: string; name?: string };
		const ticket = issue();
		ticketDevices.set(ticket, {
			deviceId: said.deviceId ?? "",
			name: said.name || null,
		});

		return json(response, { ticket, expiresIn: 120 });
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
}
