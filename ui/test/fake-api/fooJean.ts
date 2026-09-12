import { empty, json, type RequestHeaders, type Responder } from "./http.ts";
import type { ArtworkServer } from "./routes.ts";
import type { createState, FakePlaylist, Track } from "./state.ts";

type FakeState = ReturnType<typeof createState>;

type OwnPlaylistRole = "scratch" | "queue";

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

	canReadLibrary?: boolean;
	libraryBuilds?: number;
	libraryBusy?: number;
	libraryRebuilds?: number;

	maxAutoPlaylists?: number;
	// beefweb ids the component reports as already being autoplaylists, whether it
	// made them or not. An autoplaylist created in foobar2000 itself looks like
	// this and is not one Jean may update or delete.
	autoPlaylists?: string[];
	libraryEnabled?: boolean;
	failCreate?: number | null;

	// `writePlaylists` in `config.json`. `false` refuses a fill by GUID; the
	// component's own two playlists stay writable regardless. `"absent"` is a
	// component predating the field: `GET /api/capabilities` reports nothing,
	// and a client must read that absence as writable, so it behaves as `true`.
	canWritePlaylists?: boolean | "absent";

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
	// Which internal playlist a role currently resolves to. Never test-seeded: a
	// role has no playlist until a fill asks for one, exactly as the component
	// makes neither at startup.
	ownPlaylists: Partial<Record<OwnPlaylistRole, string>>;
}

const DEFAULTS: FooJeanFake = {
	installed: false,
	ownPlaylists: {},
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
	canReadLibrary: true,
	libraryBuilds: 0,
	libraryBusy: 0,
	libraryRebuilds: 0,
	maxAutoPlaylists: 0,
	autoPlaylists: [],
	libraryEnabled: true,
	failCreate: null,
	canWritePlaylists: true,
};

export const fooJeanState = (options: FooJeanOptions | null): FooJeanFake => ({
	...DEFAULTS,
	installed: options !== null,
	...options,
	// Fresh every call: `DEFAULTS` is one module-level object, and copying its
	// `ownPlaylists` reference would let every fake in the process share it.
	ownPlaylists: {},
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

// RFC 9110's negotiation, as the component reads it: `gzip;q=0` is a refusal, and `*` offers
// nothing rather than everything.
const offersGzip = (headers: RequestHeaders) => {
	const offered = /(?:^|,)\s*gzip\s*(?:;\s*q\s*=\s*([\d.]+))?/.exec(
		one(headers["accept-encoding"]).toLowerCase(),
	);
	if (!offered) return false;
	return offered[1] === undefined || Number(offered[1]) > 0;
};

const gzipped = async (bytes: Uint8Array<ArrayBuffer>) => {
	const zip = new CompressionStream("gzip");
	const writer = zip.writable.getWriter();
	void writer.write(bytes);
	void writer.close();
	return new Uint8Array(await new Response(zip.readable).arrayBuffer());
};

const cors = (headers: RequestHeaders, response: Responder) => {
	const origin = one(headers.origin);
	response.setHeader("Vary", "Origin");
	response.setHeader("Access-Control-Expose-Headers", "ETag, Retry-After");
	if (!origin) return;
	const addressed = one(headers.host).split(":")[0];
	if (new URL(origin).hostname === addressed)
		response.setHeader("Access-Control-Allow-Origin", origin);
};

// Matched case-insensitively, as the component does.
const bearerOf = (headers: RequestHeaders) =>
	/^bearer\s+(.+)$/i.exec(one(headers.authorization))?.[1] ?? null;

const MAX_TRACK_ADDRESS = 4096;

// Word for word what `kKeepAndRevalidate` in the component's `core/http_server.cpp` sends.
const KEEP_AND_REVALIDATE = "no-cache, must-revalidate";

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

const NOT_BUILT = {
	error: "the library snapshot has not been built yet",
	detail: "",
};

const STRUCTURE_MOVED = {
	error: "tracks were added or removed; export the library again",
	detail: "",
};

const WRITES_DISABLED = {
	error:
		"this install has playlist writes turned off; turn on writePlaylists in config.json to allow them",
	detail: "",
};

// foobar2000's own playlist GUID, as the component would mint it. The fake has
// no real GUIDs to hand out, so it derives one from a playlist's current index,
// exactly as `/api/playlists` already reported it before this existed.
const guidFor = (index: number) =>
	`00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;

const GUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type FillFailure = { status: number; body: { error: string; detail: string } };

const fillFailure = (
	status: number,
	error: string,
	detail = "",
): FillFailure => ({ status, body: { error, detail } });

const isNonNegInt = (value: unknown): value is number =>
	Number.isInteger(value) && (value as number) >= 0;

const isRunPair = (value: unknown): value is [number, number] =>
	Array.isArray(value) &&
	value.length === 2 &&
	isNonNegInt(value[0]) &&
	isNonNegInt(value[1]);

type ParsedFill =
	| { ok: true; title?: string; structure: number; ordinals: number[] }
	| ({ ok: false } & FillFailure);

// The inverse of `encodeFill` in `../../src/shared/api/fooJean.ts`: the three
// forms it can emit, decoded back to the ordinals they named.
function parseFill(
	body: unknown,
	{ requireTitle, trackCount }: { requireTitle: boolean; trackCount: number },
): ParsedFill {
	if (typeof body !== "object" || body === null)
		return {
			ok: false,
			...fillFailure(
				400,
				"malformed request",
				"the body did not parse as JSON",
			),
		};

	const record = body as Record<string, unknown>;
	const allowed = new Set([
		"structure",
		"runs",
		"bitset",
		"ordinals",
		...(requireTitle ? ["title"] : []),
	]);
	const stray = Object.keys(record).find((key) => !allowed.has(key));
	if (stray)
		return {
			ok: false,
			...fillFailure(
				400,
				"malformed request",
				`'${stray}' is not a field this route accepts`,
			),
		};

	let title: string | undefined;
	if (requireTitle) {
		if (typeof record.title !== "string" || record.title.length === 0)
			return {
				ok: false,
				...fillFailure(400, "unacceptable title", "'title' is required"),
			};
		title = record.title;
	}

	if (!Number.isInteger(record.structure))
		return {
			ok: false,
			...fillFailure(400, "malformed request", "'structure' is required"),
		};

	const forms = (["runs", "bitset", "ordinals"] as const).filter(
		(key) => record[key] !== undefined,
	);
	if (forms.length !== 1)
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				forms.length === 0
					? "one of 'runs', 'bitset' or 'ordinals' is required"
					: `'${forms[0]}' and '${forms[1]}' were both present; send exactly one`,
			),
		};

	const [form] = forms;
	let ordinals: number[];

	if (form === "ordinals") {
		const asked = record.ordinals;
		if (!Array.isArray(asked) || !asked.every(isNonNegInt))
			return {
				ok: false,
				...fillFailure(
					400,
					"unacceptable ordinal set",
					"'ordinals' must be a list of non-negative integers",
				),
			};
		ordinals = asked;
	} else if (form === "runs") {
		const asked = record.runs;
		if (!Array.isArray(asked) || !asked.every(isRunPair))
			return {
				ok: false,
				...fillFailure(
					400,
					"unacceptable ordinal set",
					"'runs' must be a list of [start, count] pairs",
				),
			};
		ordinals = asked
			.flatMap(([start, count]) =>
				Array.from({ length: count }, (_, at) => start + at),
			)
			.sort((a, b) => a - b);
	} else {
		const asked = record.bitset;
		if (typeof asked !== "string")
			return {
				ok: false,
				...fillFailure(
					400,
					"unacceptable ordinal set",
					"'bitset' must be base64",
				),
			};
		let bytes: Uint8Array;
		try {
			bytes = Uint8Array.from(atob(asked), (char) => char.charCodeAt(0));
		} catch {
			return {
				ok: false,
				...fillFailure(
					400,
					"unacceptable ordinal set",
					"'bitset' is not valid base64",
				),
			};
		}
		ordinals = [];
		for (let byte = 0; byte < bytes.length; byte += 1)
			for (let bit = 0; bit < 8; bit += 1)
				if (bytes[byte] & (1 << bit)) ordinals.push(byte * 8 + bit);
	}

	const outOfRange = ordinals.find((ordinal) => ordinal >= trackCount);
	if (outOfRange !== undefined)
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				`ordinal ${outOfRange} is outside a library of ${trackCount} tracks`,
			),
		};

	return { ok: true, title, structure: record.structure as number, ordinals };
}

const requirePlaylist = (state: FakeState, id: string): FakePlaylist => {
	const playlist = state.playlistById(id);
	if (!playlist)
		throw new Error(
			`fake fooJean: lost playlist ${id} immediately after creating it`,
		);
	return playlist;
};

// Applies `title` on every call, whether this is what makes the playlist for
// `role` or finds one already there, so a retitle from one fill to the next is
// the same call that fills it. Keyed on the role rather than on the title, so a
// playlist renamed at the player is still found.
function resolveOwnPlaylist(
	state: FakeState,
	fake: FooJeanFake,
	role: OwnPlaylistRole,
	title: string,
): FakePlaylist {
	const existingId = fake.ownPlaylists[role];
	if (existingId && state.playlistById(existingId)) {
		state.renamePlaylist(existingId, title);
		return requirePlaylist(state, existingId);
	}
	const made = state.addPlaylist(title);
	fake.ownPlaylists[role] = made.id;
	return requirePlaylist(state, made.id);
}

function insertTracks(
	playlist: FakePlaylist,
	tracks: Track[],
	{ replace }: { replace: boolean },
): number[] {
	if (replace) playlist.items = [];
	const start = playlist.items.length;
	playlist.items.push(...tracks);
	return tracks.map((_, at) => start + at);
}

const libraryStateOf = (state: FakeState) => {
	const { structure, revision, columns } = state.libraryFeed;
	const ready = columns.length > 0;
	return {
		ready,
		structure,
		revision,
		trackCount: ready ? state.libraryTracks.length : 0,
		columns,
	};
};

const sameMembers = (held: string[], asked: string[]) =>
	held.length === asked.length && asked.every((one) => held.includes(one));

const MAX_COLUMNS = 64;

const refuseColumns = (asked: string[]) => {
	if (asked.length === 0)
		return { error: "unacceptable column", detail: "'columns' is required" };
	if (asked.length > MAX_COLUMNS)
		return {
			error: "too many columns",
			detail: `${asked.length} columns were asked for`,
		};
	const empty = asked.findIndex((column) => column.length === 0);
	if (empty >= 0)
		return {
			error: "unacceptable column",
			detail: `column ${empty} is empty`,
		};
	return null;
};

const tagOf = (state: FakeState, coding: string, since?: string) =>
	`"s${state.libraryFeed.structure}-r${state.libraryFeed.revision}${
		since === undefined ? "" : `-f${since}`
	}-${coding}"`;

const sendBlob = async (
	response: Responder,
	headers: RequestHeaders,
	state: FakeState,
	bytes: Uint8Array<ArrayBuffer>,
	since?: string,
) => {
	const gzip = offersGzip(headers);
	const body = gzip ? await gzipped(bytes) : bytes;

	response.writeHead(200, {
		"Content-Type": "application/octet-stream",
		"Cache-Control": KEEP_AND_REVALIDATE,
		Vary: "Origin, Accept-Encoding",
		ETag: tagOf(state, gzip ? "gzip" : "identity", since),
		...(gzip ? { "Content-Encoding": "gzip" } : null),
	});
	response.end(body);
	return true;
};

async function handleLibrary({
	state,
	fake,
	method,
	path,
	url,
	headers,
	response,
}: {
	state: FakeState;
	fake: FooJeanFake;
	method: string;
	path: string;
	url: URL;
	headers: RequestHeaders;
	response: Responder;
}) {
	if (!fake.canReadLibrary)
		return json(response, { error: "the media library is not available" }, 503);
	if (method !== "GET") return json(response, { error: "not found" }, 404);

	if (path === "/api/library") {
		if (fake.libraryRebuilds > 0 && state.libraryFeed.columns.length > 0) {
			fake.libraryRebuilds -= 1;
			state.libraryFeed.building = [...state.libraryFeed.columns];
		}
		if (state.libraryFeed.building) {
			if (fake.libraryBuilds > 0) fake.libraryBuilds -= 1;
			else state.finishLibraryBuild();
		}
		const tag = tagOf(state, "identity");
		response.setHeader("Vary", "Origin, Accept-Encoding");
		response.setHeader("Cache-Control", KEEP_AND_REVALIDATE);
		response.setHeader("ETag", tag);
		if (one(headers["if-none-match"]) === tag) {
			response.writeHead(304);
			response.end();
			return true;
		}
		return json(response, libraryStateOf(state));
	}

	if (path === "/api/library/export") {
		const asked = [...new Set(url.searchParams.getAll("columns"))];
		const refused = refuseColumns(asked);
		if (refused) return json(response, refused, 400);

		if (fake.libraryBusy > 0) {
			fake.libraryBusy -= 1;
			response.setHeader("Retry-After", "1");
			return json(response, { error: "rebuilding too fast" }, 429);
		}

		if (!sameMembers(state.libraryFeed.columns, asked)) {
			state.libraryFeed.building = asked;
			if (fake.libraryBuilds > 0)
				return json(response, libraryStateOf(state), 202);
			state.finishLibraryBuild();
		}

		return sendBlob(response, headers, state, state.libraryExport());
	}

	if (path === "/api/library/changes") {
		if (state.libraryFeed.columns.length === 0)
			return json(response, NOT_BUILT, 503);
		const since = url.searchParams.get("since");
		if (since === null || !/^\d+$/.test(since))
			return json(
				response,
				{ error: "unacceptable revision", detail: "'since' is required" },
				400,
			);

		const changes = state.libraryChanges(Number(since));
		if (changes.status === 409)
			return json(
				response,
				{
					error: "tracks were added or removed; export the library again",
					detail: "",
				},
				409,
			);
		if (changes.status === 410)
			return json(
				response,
				{
					error:
						"that revision is older than the retained window; export the library again",
					detail: "",
				},
				410,
			);

		return sendBlob(response, headers, state, changes.bytes, since);
	}

	return json(response, { error: "not found" }, 404);
}

export async function handleAgent({
	state,
	method,
	url,
	headers,
	body,
	response,
	artwork,
}: {
	state: FakeState;
	method: string;
	url: URL;
	headers: RequestHeaders;
	body: unknown;
	response: Responder;
	artwork: ArtworkServer;
}) {
	const fake = state.fooJean;
	const path = url.pathname;

	state.record(method, path + url.search, body as never);

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
			canCreateAutoPlaylists:
				fake.canWritePlaylists !== false && fake.maxAutoPlaylists > 0,
			canReadLibrary: fake.canReadLibrary,
			canStream: fake.canStream && fake.streamFormats.length > 0,
			canMuteWhileStreaming: fake.canMuteWhileStreaming,
			...(fake.canStream ? { streamFormats: fake.streamFormats } : null),
			...(fake.canWritePlaylists === "absent"
				? null
				: { canWritePlaylists: fake.canWritePlaylists }),
		});
	}

	if (path === "/api/library" || path.startsWith("/api/library/"))
		return handleLibrary({ state, fake, method, path, url, headers, response });

	if (path === "/api/artwork") {
		const track = url.searchParams.get("track") ?? "";
		if (!track || track.length > MAX_TRACK_ADDRESS)
			return json(response, { error: "unacceptable track address" }, 400);

		const file = state.libraryArtworkFor(track);
		if (!file)
			return json(response, { error: "no artwork for that track" }, 404);

		return artwork(file, headers, response, KEEP_AND_REVALIDATE);
	}

	if (path === "/api/playlists") {
		return json(response, {
			playlists: state.playlists.map((playlist, index) => ({
				id: guidFor(index),
				beefwebId: playlist.id,
				index,
				title: playlist.title,
				isAutoPlaylist: fake.autoPlaylists.includes(playlist.id),
				managed: null,
			})),
		});
	}

	const ownFillMatch = /^\/api\/playlists\/own\/([^/]+)\/items$/.exec(path);
	if (method === "POST" && ownFillMatch) {
		// The same latency switch the beefweb fake honours. Held after the request
		// is recorded and before the playlist is touched, so two racing fills are
		// applied in the order they arrived, as `MainThreadQueue` applies them.
		if (state.latency > 0) await delay(state.latency);

		const role = ownFillMatch[1];
		if (role !== "scratch" && role !== "queue")
			return json(
				response,
				{
					error: "malformed request",
					detail: `'${role}' is not a role this component knows`,
				},
				400,
			);

		if (!fake.canReadLibrary)
			return json(
				response,
				{ error: "the media library is not available" },
				503,
			);
		if (state.libraryFeed.columns.length === 0)
			return json(response, NOT_BUILT, 503);

		const parsed = parseFill(body, {
			requireTitle: true,
			trackCount: state.libraryTracks.length,
		});
		if (!parsed.ok) return json(response, parsed.body, parsed.status);

		// Made or found before the structure is checked: the same order the
		// component takes, so a fill refused for a stale structure can still leave
		// the component's own playlist behind.
		const playlist = resolveOwnPlaylist(state, fake, role, parsed.title ?? "");

		if (parsed.structure !== state.libraryFeed.structure)
			return json(response, STRUCTURE_MOVED, 409);

		const tracks = state.ordinalOrder();
		const positions = insertTracks(
			playlist,
			parsed.ordinals.map((ordinal) => tracks[ordinal].track),
			{ replace: role === "scratch" },
		);
		state.notifyPlaylists();

		return json(response, {
			playlistId: guidFor(state.playlists.indexOf(playlist)),
			beefwebId: playlist.id,
			positions,
		});
	}

	if (method === "DELETE" && ownFillMatch) {
		const role = ownFillMatch[1];
		if (role !== "scratch" && role !== "queue")
			return json(
				response,
				{
					error: "malformed request",
					detail: `'${role}' is not a role this component knows`,
				},
				400,
			);

		// The rows go and the playlist stays, because deleting one the play queue
		// points into kills foobar2000. A role with no playlist yet is not given one
		// to empty, and answers the same 204 as a role that had rows to lose.
		const held = fake.ownPlaylists[role];
		const playlist = held ? state.playlistById(held) : undefined;
		if (playlist && playlist.items.length > 0) {
			state.removeItems(playlist.id, [...playlist.items.keys()]);
			state.notifyPlaylists();
		}
		return empty(response);
	}

	const idFillMatch = /^\/api\/playlists\/([^/]+)\/items$/.exec(path);
	if (method === "POST" && idFillMatch) {
		const guid = idFillMatch[1];

		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		if (!GUID_PATTERN.test(guid))
			return json(
				response,
				{
					error: "unacceptable playlist id",
					detail: `'${guid}' is not a playlist id this component issued`,
				},
				400,
			);

		if (!fake.canReadLibrary)
			return json(
				response,
				{ error: "the media library is not available" },
				503,
			);
		if (state.libraryFeed.columns.length === 0)
			return json(response, NOT_BUILT, 503);

		const index = state.playlists.findIndex((_, at) => guidFor(at) === guid);
		if (index < 0)
			return json(response, { error: "no such playlist", detail: "" }, 404);
		const playlist = state.playlists[index];

		const parsed = parseFill(body, {
			requireTitle: false,
			trackCount: state.libraryTracks.length,
		});
		if (!parsed.ok) return json(response, parsed.body, parsed.status);

		if (parsed.structure !== state.libraryFeed.structure)
			return json(response, STRUCTURE_MOVED, 409);

		const tracks = state.ordinalOrder();
		const positions = insertTracks(
			playlist,
			parsed.ordinals.map((ordinal) => tracks[ordinal].track),
			{ replace: false },
		);
		state.notifyPlaylists();

		return json(response, {
			playlistId: guid,
			beefwebId: playlist.id,
			positions,
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
			id: guidFor(state.playlists.length),
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
