import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";
import type { PlaybackMode } from "../../src/shared/api/types.ts";
import { empty, json, type RequestHeaders, type Responder } from "./http.ts";
import type { ArtworkServer } from "./routes.ts";
import type { createState, FakePlaylist, Track } from "./state.ts";
import { evaluate, libraryItemsOf } from "./state.ts";

type FakeState = ReturnType<typeof createState>;

type QueuedRead = ReturnType<FakeState["queuedEntries"]>[number];

type OwnPlaylistRole = "scratch";

export interface FooJeanOptions {
	reachable?: boolean;

	name?: string;
	version?: string;
	apiVersion?: number;

	token?: string;
	allowedFields?: string[];

	failWrites?: number | null;

	// The tag reaches the player and the answer does not reach the client. A 504
	// says the component did not answer in time and says nothing about whether
	// anything was written, so both outcomes are real; `failWrites` alone is the
	// one where nothing was, and this is the other.
	writesLandAnyway?: boolean;

	// One library-relative path that two media library roots both hold. The
	// ordinal naming either of the two tracks still resolves, which is what a
	// client's one retry is aimed at.
	twoRootsHold?: string | null;

	// Refuses GET /api/track/library with this status, which is the route a client
	// reads one value back through. Nothing else answers there, so this reaches
	// the read-back and no other traffic.
	failLibraryTrack?: number | null;

	// Holds GET /api/track/library open and never answers it, the way a player
	// stalled behind its own work does. Not even late: a spec waiting to see what
	// a client does about a read that did not come back is the whole of what this
	// is for, and an answer arriving behind its back defeats every one of them.
	hangLibraryTrack?: boolean;

	// Refuses GET /api/track/playing with this status, shaped like `failLibraryTrack`.
	failPlayingTrack?: number | null;

	// Holds GET /api/track/playing open and never answers it, shaped like `hangLibraryTrack`.
	hangPlayingTrack?: boolean;

	// GET /api/track/playing answers this path rather than the playing track's own,
	// leaving `subsong` and `columns` untouched.
	playingTrackAnswersPath?: string | null;

	// GET /api/track/playing answers this subsong rather than the playing track's own,
	// leaving `path` and `columns` untouched.
	playingTrackAnswersSubsong?: number | null;

	playingTrackKnobsFor?: number | null;

	// The rating the component reports having stored, whatever it was sent. A
	// player that keeps ratings on a scale of its own rounds the value before it
	// reaches the tag, and the write's answer is the only place a client hears
	// about it.
	storesRatingAs?: string | null;

	// Refuses GET /api/state with this status for a stretch, shaped like
	// `failWrites`. Unlike it, a spec switches this one at runtime through
	// `POST /__control/state`, because the case it exists for is a poll cut off
	// mid-test rather than one refused from the start.
	failState?: number | null;

	// Refuses every queue mutation with this status, leaving the queue itself
	// where it was and both reads answering. A 500, a 429 from the rate limiter
	// and a connection that died are one event to a client, so one status stands
	// in for all three. The 409 a stale revision answers is the other kind: there
	// the queue did move, and the next poll carries a revision that says so.
	failQueue?: number | null;

	// Refuses every playlist mutation with this status, shaped like `failState`:
	// a spec switches it at runtime through `POST /__control/failPlaylistWrites`
	// for the case where a write simply failed rather than being refused, and
	// leaving the status out turns it back off.
	failPlaylistWrites?: number | null;

	// The answer to a queue mutation, lost on the way back. The player carries the
	// change out at once, nothing comes back for this many milliseconds, and then
	// the client is told the change failed, which is what its own write timeout
	// tells it when no answer ever arrives. Reads go on answering meanwhile, so a
	// poll lands in the gap and carries back the queue the player has now.
	loseQueueAnswer?: number | null;

	// Off, the component answers `playingLocation: null`: it is playing something
	// and cannot say where from. This is what foobar2000 does once the playing
	// item has been removed from the playlist it started in.
	knowsPlayingLocation?: boolean;

	// Off, `GET /api/playlists` leaves out the newest playlist, so a client joining
	// the tick's playlist GUID to this list finds nothing for it. The component
	// always lists every playlist it has; what lags is the copy a client holds,
	// which is read once and again only when the playlist count moves, so a
	// playlist created since is one the poll can name and the client cannot.
	annotatesEveryPlaylist?: boolean;

	playlistChangeWindow?: number;

	canReadLibrary?: boolean;
	libraryReady?: boolean;
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

	canWritePlaylists?: boolean | "absent";
	canChangeOutput?: boolean;

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

export interface FooJeanFake extends Required<FooJeanOptions> {
	ownPlaylists: Partial<Record<OwnPlaylistRole, string>>;
	// Beefweb ids a control has locked against edits mid-test, consulted beside `isAuto`.
	// `POST /__control/lockPlaylist` is the only way in or out of this set.
	lockedPlaylists: Set<string>;
}

const DEFAULTS: FooJeanFake = {
	ownPlaylists: {},
	reachable: true,
	name: "foo_jean",
	version: "0.1.0",
	apiVersion: 1,
	token: "0123456789abcdef0123456789abcdef",
	allowedFields: ["rating"],
	failWrites: null,
	writesLandAnyway: false,
	twoRootsHold: null,
	failLibraryTrack: null,
	hangLibraryTrack: false,
	failPlayingTrack: null,
	hangPlayingTrack: false,
	playingTrackAnswersPath: null,
	playingTrackAnswersSubsong: null,
	playingTrackKnobsFor: null,
	storesRatingAs: null,
	failState: null,
	failQueue: null,
	failPlaylistWrites: null,
	loseQueueAnswer: null,
	knowsPlayingLocation: true,
	annotatesEveryPlaylist: true,
	playlistChangeWindow: 32,
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
	libraryReady: true,
	libraryBuilds: 0,
	libraryBusy: 0,
	libraryRebuilds: 0,
	maxAutoPlaylists: 0,
	autoPlaylists: [],
	libraryEnabled: true,
	failCreate: null,
	canWritePlaylists: true,
	canChangeOutput: true,
	lockedPlaylists: new Set(),
};

export const fooJeanState = (options: FooJeanOptions): FooJeanFake => ({
	...DEFAULTS,
	...options,
	ownPlaylists: {},
	lockedPlaylists: new Set(),
});

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

// The component reflects only an origin listed in its own `allowedOrigins`, empty by
// default, so nothing here is ever reflected: the fake carries no such list to check.
const cors = (response: Responder) => {
	response.setHeader("Vary", "Origin");
};

// Matched case-insensitively, as the component does.
const bearerOf = (headers: RequestHeaders) =>
	/^bearer\s+(.+)$/i.exec(one(headers.authorization))?.[1] ?? null;

const MAX_TRACK_ADDRESS = 4096;

const SECONDS_PER_DAY = 24 * 60 * 60;

// Word for word what `kCoverCacheLifetimeSeconds` and `kMissingCoverCacheLifetimeSeconds` in
// the component's `core/http_server.cpp` hold.
const COVER_CACHE_LIFETIME_SECONDS = 180 * SECONDS_PER_DAY;
const MISSING_COVER_CACHE_LIFETIME_SECONDS = 10 * 60;

const freshFor = (seconds: number) => `private, max-age=${seconds}`;

// Word for word what `kAskEveryTime` sends: the playing cover and the positional fallback name
// a different picture once the track or the row changes, and the state and library routes must
// stay current, so none of the five may be held past the request that answered it.
const ASK_EVERY_TIME = "private, no-cache";

// Both artwork routes answer 404 with this one string, as the component does:
// from a reader's side "no cover for that track" and "no cover for whatever is
// playing" are one fact.
const NO_ARTWORK = { error: "no artwork for that track" };

// The status and the body size go into the request log, because a cover sent
// again and a cover revalidated are one GET at one address and a spec asserting
// on paths alone cannot tell them apart.
const reporting = (
	response: Responder,
	note: (answer: { status: number; bytes: number }) => void,
): Responder => {
	let status = 0;
	let bytes = 0;
	return {
		writeHead(code, headers) {
			status = code;
			return response.writeHead(code, headers);
		},
		setHeader: (name, value) => response.setHeader(name, value),
		write(chunk) {
			bytes += chunk.length;
			return response.write(chunk);
		},
		end(body) {
			if (body) bytes += body.length;
			note({ status, bytes });
			return response.end(body);
		},
		on: (event, listener) => response.on(event, listener),
		get writableEnded() {
			return response.writableEnded;
		},
	};
};

// What a write answers when the position it named was read at an older
// structure. `TagFailed` declares no `detail`, so the playlist routes' own
// `ROWS_MOVED` takes this sentence and adds one rather than the other way round.
const TAG_ROWS_MOVED = {
	written: false,
	error:
		"the playlist's rows were added, removed or reordered; read them again",
};

const NO_SUCH_TRACK = {
	written: false,
	error: "foobar2000 does not know that track",
};

const NAMES_TWO_TRACKS =
	"the media library holds more than one track at that address" satisfies components["schemas"]["TagFailed"]["error"];

const LIBRARY_REBUILT = {
	written: false,
	error: "the media library was rebuilt; export it again",
};

const FAILURES: Record<number, unknown> = {
	403: {
		written: false,
		error: "field not allowed",
		detail: "rating",
		field: "rating",
	},
	404: NO_SUCH_TRACK,
	409: TAG_ROWS_MOVED,
	500: { written: false, error: "the player could not write the tags" },
	503: { written: false, error: "tag writing is not available" },
	504: { written: false, error: "the player did not answer in time" },
};

const refuseWrite = (response: Responder, status: number) =>
	json(
		response,
		FAILURES[status] ?? { written: false, error: "refused" },
		status,
	);

const subsongOf = (track: Track) => Number(track["%subsong%"]) || 0;

const hasLibrarySnapshot = (state: FakeState) =>
	state.libraryFeed.columns.length > 0;

// The snapshot holds a track under each root, and the component answers neither.
// A property of the address rather than of the route, so both routes that take
// one ask before they resolve.
const namesTwoTracks = (state: FakeState, address: unknown) =>
	typeof address === "string" && address === state.fooJean.twoRootsHold;

// Resolved against the snapshot's own relative paths rather than by the key the
// row that named it was minted from: a fake that answers its own spelling back
// proves nothing. The relative paths are part of the snapshot, so a component
// holding none resolves no library address at all, which is the `404` a player
// that has just started answers every library-form write with.
const libraryTrackAt = (state: FakeState, address: string, subsong: number) => {
	if (!hasLibrarySnapshot(state)) return null;
	return (
		libraryItemsOf(state.libraryTracks).find(
			(entry) => entry.path === address && entry.subsong === subsong,
		)?.track ?? null
	);
};

// The player holds one file's tags once, so a write reaches every copy of the
// track the fake is holding: the playlist row it was addressed through and the
// media library's own entry, which are separate objects whenever `withoutFields`
// or `retagged` copied one.
const applyTags = (
	state: FakeState,
	target: Track,
	fields: Record<string, string>,
) => {
	const patch = (track: Track) => {
		if (track["%path%"] !== target["%path%"]) return;
		if (subsongOf(track) !== subsongOf(target)) return;
		for (const [field, value] of Object.entries(fields)) {
			if (value === "") delete track[`%${field}%`];
			else track[`%${field}%`] = value;
		}
	};

	for (const playlist of state.playlists)
		for (const track of playlist.items) patch(track);
	for (const track of state.libraryTracks) patch(track);
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// How long the handler for a read that never answers waits for the client to go
// away. Jean abandons that read 35 seconds later, which no spec can sit through,
// so a spec proving the page stayed quiet about it waits out this instead: past
// it, nothing from the read can arrive any more.
export const STALLED_READ_MS = 1000;

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

// `PlaylistLocked` and `FillConflict` in `contract/openapi.yaml` publish the same two fields for
// this cause, so one constant answers both routes.
const PLAYLIST_LOCKED = {
	error: "another component has locked that playlist against that edit",
	detail: "",
};

const PLAYER_REFUSED = {
	error: "the player could not do that",
	detail: "",
};

const OWN_PLAYLIST = {
	error:
		"that playlist is foo_jean's own; address it by its role rather than by its id",
	detail: "",
};

const ROWS_MOVED = {
	error: TAG_ROWS_MOVED.error,
	detail: "",
};

const REVISION_GONE = {
	error:
		"that revision is not one this playlist can catch up from; read its rows again",
	detail: "",
};

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

type DecodedSelection =
	| { ok: true; ordinals: number[] }
	| ({ ok: false } & FillFailure);

function decodeSelection(
	record: Record<string, unknown>,
	trackCount: number,
): DecodedSelection {
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

	return { ok: true, ordinals };
}

type ParsedFill =
	| { ok: true; title?: string; structure: number; ordinals: number[] }
	| ({ ok: false } & FillFailure);

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

	const selection = decodeSelection(record, trackCount);
	if (!selection.ok) return selection;

	return {
		ok: true,
		title,
		structure: record.structure as number,
		ordinals: selection.ordinals,
	};
}

type ParsedQueuePosition =
	| { ok: true; at?: { index: number; revision: number } }
	| ({ ok: false } & FillFailure);

function parseQueuePosition(
	record: Record<string, unknown>,
): ParsedQueuePosition {
	if (record.at === undefined) return { ok: true, at: undefined };

	if (!isNonNegInt(record.at))
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				"'at' must be a non-negative integer",
			),
		};
	if (!isNonNegInt(record.revision))
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				"'at' requires 'revision'",
			),
		};

	return { ok: true, at: { index: record.at, revision: record.revision } };
}

// Exactly the fields contract/openapi.yaml declares for each request body below,
// `additionalProperties: false` there; `declaresOnly` refuses anything else, mirroring
// core/api.cpp's own `declaresOnly` and its three field lists.
const QUEUE_ROWS_FIELDS = ["playlistId", "positions", "at", "revision"];
const QUEUE_TRACKS_FIELDS = [
	"structure",
	"runs",
	"bitset",
	"ordinals",
	"at",
	"revision",
];
const MOVE_QUEUE_FIELDS = ["from", "to", "revision"];

const declaresOnly = (
	record: Record<string, unknown>,
	fields: readonly string[],
): boolean => Object.keys(record).every((key) => fields.includes(key));

type ParsedQueueRows =
	| {
			ok: true;
			playlistId: string;
			positions: number[];
			at?: { index: number; revision: number };
	  }
	| ({ ok: false } & FillFailure);

// Mirrors core/api.cpp's parseQueueRows: the same refusals, checked before the store is
// touched, so a fake refusal never queues anything either.
function parseQueueRows(body: unknown): ParsedQueueRows {
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

	if (!declaresOnly(record, QUEUE_ROWS_FIELDS))
		return { ok: false, ...fillFailure(400, "malformed request") };

	if (
		typeof record.playlistId !== "string" ||
		!GUID_PATTERN.test(record.playlistId)
	)
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable playlist id",
				"'playlistId' must be a playlist id this component issued",
			),
		};

	const positions = record.positions;
	if (
		!Array.isArray(positions) ||
		positions.length === 0 ||
		!positions.every(isNonNegInt)
	)
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				"'positions' must be a non-empty list of non-negative integers",
			),
		};

	const position = parseQueuePosition(record);
	if (!position.ok) return position;

	return {
		ok: true,
		playlistId: record.playlistId,
		positions,
		at: position.at,
	};
}

type ParsedQueueTracks =
	| {
			ok: true;
			structure: number;
			ordinals: number[];
			at?: { index: number; revision: number };
	  }
	| ({ ok: false } & FillFailure);

// Mirrors core/api.cpp's parseQueueTracks.
function parseQueueTracks(
	body: unknown,
	trackCount: number,
	expectedStructure: number,
): ParsedQueueTracks {
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

	if (!declaresOnly(record, QUEUE_TRACKS_FIELDS))
		return { ok: false, ...fillFailure(400, "malformed request") };

	if (!Number.isInteger(record.structure))
		return {
			ok: false,
			...fillFailure(400, "malformed request", "'structure' is required"),
		};

	if (record.structure !== expectedStructure)
		return { ok: false, status: 409, body: STRUCTURE_MOVED };

	const selection = decodeSelection(record, trackCount);
	if (!selection.ok) return selection;
	if (selection.ordinals.length === 0)
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				"the selection must not be empty",
			),
		};

	const position = parseQueuePosition(record);
	if (!position.ok) return position;

	return {
		ok: true,
		structure: record.structure as number,
		ordinals: selection.ordinals,
		at: position.at,
	};
}

const QUEUE_MOVED = {
	error: "the queue changed since that revision; read it again",
	detail: "",
};

// A query parameter and a URL segment both arrive as untyped text rather than a JSON number.
const isDecimal = (text: string): boolean => /^\d+$/.test(text);

// A playlist's own `structure` and `revision` travel as strings of decimal digits on the wire;
// `shared/api/README.md` has why.
const generationText = (value: bigint): string => String(value);

function parseGeneration(text: string | null): bigint | null {
	if (text === null || !isDecimal(text)) return null;
	return BigInt(text);
}

type ParsedMoveQueue =
	| { ok: true; from: number; to: number; revision: number }
	| ({ ok: false } & FillFailure);

// Mirrors core/api.cpp's parseMoveQueue.
function parseMoveQueue(body: unknown): ParsedMoveQueue {
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

	if (!declaresOnly(record, MOVE_QUEUE_FIELDS))
		return { ok: false, ...fillFailure(400, "malformed request") };

	if (!isNonNegInt(record.from))
		return {
			ok: false,
			...fillFailure(400, "unacceptable ordinal set", "'from' is required"),
		};
	if (!isNonNegInt(record.to))
		return {
			ok: false,
			...fillFailure(400, "unacceptable ordinal set", "'to' is required"),
		};
	if (!isNonNegInt(record.revision))
		return {
			ok: false,
			...fillFailure(400, "unacceptable ordinal set", "'revision' is required"),
		};

	return {
		ok: true,
		from: record.from,
		to: record.to,
		revision: record.revision,
	};
}

type ParsedRemoveQueue =
	| { ok: true; index: number; revision: number }
	| ({ ok: false } & FillFailure);

// Mirrors core/api.cpp's parseRemoveQueue: the index arrives as a URL segment and the
// revision as a query parameter, so neither ever throws on a client's typo.
function parseRemoveQueue(
	indexText: string,
	revisionText: string | null,
): ParsedRemoveQueue {
	if (!isDecimal(indexText))
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				"the queue index must be a whole number",
			),
		};

	if (revisionText === null || !isDecimal(revisionText))
		return {
			ok: false,
			...fillFailure(400, "unacceptable ordinal set", "'revision' is required"),
		};

	return { ok: true, index: Number(indexText), revision: Number(revisionText) };
}

type QueueSource = "rows" | "tracks" | "invalid";

// Mirrors core/api.cpp's queueSourceOf.
function queueSourceOf(body: unknown): QueueSource {
	if (typeof body !== "object" || body === null) return "invalid";

	const record = body as Record<string, unknown>;
	const namesRows =
		record.playlistId !== undefined || record.positions !== undefined;
	const namesTracks =
		record.structure !== undefined ||
		record.ordinals !== undefined ||
		record.runs !== undefined ||
		record.bitset !== undefined;

	if (namesRows === namesTracks) return "invalid";
	return namesRows ? "rows" : "tracks";
}

const requirePlaylist = (state: FakeState, id: string): FakePlaylist => {
	const playlist = state.playlistById(id);
	if (!playlist)
		throw new Error(
			`fake fooJean: lost playlist ${id} immediately after creating it`,
		);
	return playlist;
};

const ownRoleOf = (fake: FooJeanFake, id: string): OwnPlaylistRole | null =>
	fake.ownPlaylists.scratch === id ? "scratch" : null;

// Whether the player would lock this playlist against having rows added: seeded true on a
// fixture playlist, or built by `POST /api/autoplaylists` or the `autoPlaylists` fixture
// option, both of which only ever add an id to `fake.autoPlaylists`. The one function is what
// every route that would otherwise disagree with `GET /api/playlists` calls.
const locksAgainstAdds = (fake: FooJeanFake, playlist: FakePlaylist): boolean =>
	Boolean(playlist.isAuto) || fake.autoPlaylists.includes(playlist.id);

const OWN_TITLE_PREFIX = "#Jean";

// A title beginning `#Jean` reaches the player exactly as sent; one that does not is prefixed
// with `#Jean ` first. The check is exact and case-sensitive, matching the component's own.
const ownPlaylistTitle = (asked: string) =>
	asked.startsWith(OWN_TITLE_PREFIX) ? asked : `${OWN_TITLE_PREFIX} ${asked}`;

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
	const asked = ownPlaylistTitle(title);
	const existingId = fake.ownPlaylists[role];
	if (existingId && state.playlistById(existingId)) {
		state.renamePlaylist(existingId, asked);
		return requirePlaylist(state, existingId);
	}
	const made = state.addPlaylist(asked);
	fake.ownPlaylists[role] = made.id;
	return requirePlaylist(state, made.id);
}

function insertTracks(
	state: FakeState,
	playlist: FakePlaylist,
	tracks: Track[],
	{ replace }: { replace: boolean },
): number[] {
	const start = replace ? 0 : playlist.items.length;
	state.editItems(playlist, () => {
		if (replace) playlist.items = [];
		playlist.items.push(...tracks);
	});
	return tracks.map((_, at) => start + at);
}

const libraryStateOf = (state: FakeState) => {
	const { structure, revision, columns } = state.libraryFeed;
	const ready = hasLibrarySnapshot(state);
	return {
		ready,
		structure,
		revision,
		trackCount: ready ? state.libraryTracks.length : 0,
		columns,
	};
};

// foobar2000's stock playback-order names, matched against `enumNames` and translated to
// Jean's own mode names the way `plugins/fb2k/src/core/playback_modes.cpp`'s `kModes` does.
// An order this map does not carry is not offered, exactly as `jeanModeFor` refuses one.
const JEAN_MODE_BY_ORDER: Record<string, PlaybackMode> = {
	Default: "inOrder",
	"Repeat (playlist)": "repeatAll",
	"Repeat (track)": "repeatOne",
	Random: "random",
	"Shuffle (tracks)": "shuffleTracks",
	"Shuffle (albums)": "shuffleAlbums",
	"Shuffle (folders)": "shuffleFolders",
};

const jeanModeFor = (order: string): PlaybackMode | null =>
	JEAN_MODE_BY_ORDER[order] ?? null;

// The orders this fixture's player actually declares, in the order it declares them, never the
// full stock list regardless of what a spec asked the player to report.
const declaredOrders = (state: FakeState): string[] =>
	state.player.options?.find((entry) => entry.id === "playbackOrder")
		?.enumNames ?? [];

// What GET /api/capabilities offers: the declared orders translated and filtered, so an install
// whose player reports fewer orders, or one this component has no name for, offers fewer modes.
const playbackModesOf = (state: FakeState): PlaybackMode[] =>
	declaredOrders(state)
		.map(jeanModeFor)
		.filter((mode): mode is PlaybackMode => mode !== null);

const PLAYBACK_MODES = new Set<PlaybackMode>(Object.values(JEAN_MODE_BY_ORDER));

const orderIndexForMode = (
	state: FakeState,
	mode: PlaybackMode,
): number | null => {
	const orderName = Object.entries(JEAN_MODE_BY_ORDER).find(
		([, jeanMode]) => jeanMode === mode,
	)?.[0];
	if (orderName === undefined) return null;
	const index = declaredOrders(state).indexOf(orderName);
	return index === -1 ? null : index;
};

const fileNameOf = (path: string) => path.split(/[\\/]/).pop() ?? "";

// Mirrors the title-formatting scripts in `plugins/fb2k/src/fb2k/playback_watch.cpp`: only the
// title falls back to the filename, and a tag the player resolved to nothing crosses the wire as
// `null` rather than as an empty string.
const nameOf = (track: Track) => ({
	title:
		String(track["%title%"] ?? "") ||
		fileNameOf(String(track["%path%"] ?? "")) ||
		null,
	artist: String(track["%artist%"] ?? "") || null,
	album: String(track["%album%"] ?? "") || null,
	albumArtist: String(track["%album artist%"] ?? "") || null,
});

const NOTHING_PLAYING_NAMES = {
	title: null,
	artist: null,
	album: null,
	albumArtist: null,
};

// What rides under `player` in `GET /api/state`'s `200`. Position comes from
// `state.positionMark` rather than from `activeItem.position` directly, since
// that is where the age the client interpolates from is kept.
const playerSectionOf = (state: FakeState, fake: FooJeanFake) => {
	const item = state.playingItem;
	const playlist =
		item && item.index >= 0 ? state.playlistById(item.playlistId) : null;
	const track = state.playingTrack();
	const { seconds, takenAtMs } = state.positionMark;
	return {
		playback: state.player.playbackState,
		path: track ? String(evaluate(track, "%path%") ?? "") : "",
		subsong: track ? Number(track["%subsong%"]) || 0 : 0,
		// The address a write names a library track by, and `null` for a track the
		// snapshot does not hold. A component with no library to look in holds no
		// snapshot at all, so it answers `null` for everything.
		libraryPath:
			track && fake.canReadLibrary ? state.libraryPathFor(track) : null,
		position: {
			seconds: Math.max(seconds, 0),
			ageSeconds: Math.max((Date.now() - takenAtMs) / 1000, 0),
		},
		duration: Math.max(item?.duration ?? 0, 0),
		volume: state.playerHeld ? -100 : state.player.volume.value,
		muted: state.playerHeld ? true : state.player.volume.isMuted,
		playbackMode: jeanModeFor(
			declaredOrders(state)[state.player.playbackMode] ?? "",
		),
		...(track ? nameOf(track) : NOTHING_PLAYING_NAMES),
		playingLocation:
			fake.knowsPlayingLocation && item && playlist
				? { playlistId: playlist.guid, index: item.index }
				: null,
		queueRevision: state.queueRevision,
		playlistsRevision: state.playlistsRevision,
	};
};

// One row of `GET /api/queue`, read through the entry's handle. A missing tag is
// an empty string, and a position the player has lost is no position at all.
const queuedTrackOf = (state: FakeState, entry: QueuedRead) => {
	const playlist = entry.playlistId
		? state.playlistById(entry.playlistId)
		: null;
	const value = (field: string) => String(entry.track[field] ?? "");
	return {
		title: value("%title%"),
		artist: value("%artist%"),
		duration: Number(entry.track["%length_seconds%"]) || 0,
		album: value("%album%"),
		albumArtist: value("%album artist%"),
		libraryPath: state.libraryPathFor(entry.track),
		location:
			playlist && entry.index >= 0
				? { playlistId: playlist.guid, index: entry.index }
				: null,
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

// `GET /api/state`'s own validator, distinct from the two binary routes'
// `tagOf`: it folds the player's version too, so a poll that only drove the
// player still sees the tag move.
const stateTagOf = (state: FakeState, coding: string) =>
	`"s${state.libraryFeed.structure}-r${state.libraryFeed.revision}-p${state.playerVersion}-${coding}"`;

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
		"Cache-Control": ASK_EVERY_TIME,
		Vary: "Origin, Accept-Encoding",
		ETag: tagOf(state, gzip ? "gzip" : "identity", since),
		...(gzip ? { "Content-Encoding": "gzip" } : null),
	});
	response.end(body);
	return true;
};

const changedColumnDictionaries = (columns: string[], rows: Track[]) =>
	columns.map((expression) => {
		const text: string[] = [];
		const idOf = new Map<string, number>();
		const ids = rows.map((track) => {
			const value = evaluate(track, expression);
			let id = idOf.get(value);
			if (id === undefined) {
				id = text.length;
				text.push(value);
				idOf.set(value, id);
			}
			return id;
		});
		return { text, ids };
	});

// Word for word what core/api.cpp's parseJsonObject and declaresOnly answer for every playback
// route. The JSON-parse exception text a body that fails to parse at all gets there cannot be
// reproduced here: by the time a body reaches this handler it has already been reduced to `null`,
// so that case collapses into the one static string parseJsonObject also answers for a body that
// parsed but was not an object.
const NOT_A_JSON_OBJECT = "expected a JSON object";
const FIELD_NOT_TAKEN = "a field this route does not take was named";

const SEEK_FIELDS = ["seconds", "relativeSeconds"] as const;

type ParsedSeek =
	| { ok: true; seconds?: number; relativeSeconds?: number }
	| { ok: false; status: number; body: { error: string; detail: string } };

function parseSeek(body: unknown): ParsedSeek {
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return {
			ok: false,
			status: 400,
			body: { error: "unacceptable seek", detail: NOT_A_JSON_OBJECT },
		};

	const record = body as Record<string, unknown>;
	const stray = Object.keys(record).find(
		(key) => !SEEK_FIELDS.includes(key as (typeof SEEK_FIELDS)[number]),
	);
	if (stray)
		return {
			ok: false,
			status: 400,
			body: { error: "unacceptable seek", detail: FIELD_NOT_TAKEN },
		};

	const forms = SEEK_FIELDS.filter((key) => record[key] !== undefined);
	if (forms.length !== 1)
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable seek",
				detail:
					forms.length === 0
						? "send exactly one of 'seconds' and 'relativeSeconds'"
						: "'seconds' and 'relativeSeconds' were both present; send exactly one",
			},
		};

	const [field] = forms;
	if (typeof record[field] !== "number")
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable seek",
				detail: `'${field}' must be a number`,
			},
		};

	const value = record[field] as number;
	if (!Number.isFinite(value))
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable seek",
				detail: `'${field}' must be a number this can hold`,
			},
		};

	if (field === "seconds" && value < 0)
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable seek",
				detail: "'seconds' must not be negative",
			},
		};

	return field === "seconds"
		? { ok: true, seconds: value }
		: { ok: true, relativeSeconds: value };
}

const VOLUME_FIELDS = ["value", "step", "muted"] as const;

type ParsedVolume =
	| { ok: true; value?: number; step?: "up" | "down"; muted?: boolean }
	| { ok: false; status: number; body: { error: string; detail: string } };

function parseVolume(
	body: unknown,
	range: { min: number; max: number },
): ParsedVolume {
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return {
			ok: false,
			status: 400,
			body: { error: "unacceptable volume", detail: NOT_A_JSON_OBJECT },
		};

	const record = body as Record<string, unknown>;
	const stray = Object.keys(record).find(
		(key) => !VOLUME_FIELDS.includes(key as (typeof VOLUME_FIELDS)[number]),
	);
	if (stray)
		return {
			ok: false,
			status: 400,
			body: { error: "unacceptable volume", detail: FIELD_NOT_TAKEN },
		};

	const forms = VOLUME_FIELDS.filter((key) => record[key] !== undefined);
	if (forms.length !== 1)
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable volume",
				detail: "send exactly one of 'value', 'step' and 'muted'",
			},
		};

	const [field] = forms;
	if (field === "value") {
		if (typeof record.value !== "number")
			return {
				ok: false,
				status: 400,
				body: {
					error: "unacceptable volume",
					detail: "'value' must be a number",
				},
			};
		if (!Number.isFinite(record.value))
			return {
				ok: false,
				status: 400,
				body: {
					error: "unacceptable volume",
					detail: "'value' must be a number this can hold",
				},
			};
		if (record.value < range.min || record.value > range.max)
			return {
				ok: false,
				status: 400,
				body: {
					error: "unacceptable volume",
					detail: `'value' must be between ${range.min} and ${range.max}`,
				},
			};
		return { ok: true, value: record.value };
	}
	if (field === "step") {
		if (record.step !== "up" && record.step !== "down")
			return {
				ok: false,
				status: 400,
				body: {
					error: "unacceptable volume",
					detail: "'step' must be 'up' or 'down'",
				},
			};
		return { ok: true, step: record.step };
	}
	if (typeof record.muted !== "boolean")
		return {
			ok: false,
			status: 400,
			body: {
				error: "unacceptable volume",
				detail: "'muted' must be a boolean",
			},
		};
	return { ok: true, muted: record.muted };
}

// A player with no media library at all still answers what it is playing: this
// route never 503s on that account, unlike the three `handleLibrary` routes,
// which have nothing to serve without one.
async function handleState({
	state,
	fake,
	method,
	headers,
	response,
}: {
	state: FakeState;
	fake: FooJeanFake;
	method: string;
	headers: RequestHeaders;
	response: Responder;
}) {
	if (method !== "GET") return json(response, { error: "not found" }, 404);
	if (fake.failState) {
		if (fake.failState === 429) response.setHeader("Retry-After", "1");
		return json(
			response,
			{ error: "the state route is not answering", detail: "" },
			fake.failState,
		);
	}

	if (fake.libraryRebuilds > 0 && state.libraryFeed.columns.length > 0) {
		fake.libraryRebuilds -= 1;
		state.libraryFeed.building = [...state.libraryFeed.columns];
	}
	if (state.libraryFeed.building) {
		if (fake.libraryBuilds > 0) fake.libraryBuilds -= 1;
		else if (fake.libraryReady) state.finishLibraryBuild();
	}
	const tag = stateTagOf(state, "identity");
	response.setHeader("Vary", "Origin, Accept-Encoding");
	response.setHeader("Cache-Control", ASK_EVERY_TIME);
	response.setHeader("ETag", tag);
	if (one(headers["if-none-match"]) === tag) {
		response.writeHead(304);
		response.end();
		return true;
	}
	return json(response, {
		library: libraryStateOf(state),
		player: playerSectionOf(state, fake),
	});
}

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

	// One track's columns, addressed the way a cover is. It echoes no
	// `libraryPath`, because the caller supplied the address.
	if (path === "/api/track/library") {
		if (fake.failLibraryTrack)
			return json(
				response,
				{ error: "the player could not read that track", detail: "" },
				fake.failLibraryTrack,
			);
		// Nothing is answered once the hold is up either, for the reason
		// `hangLibraryTrack` gives.
		if (fake.hangLibraryTrack) {
			await abandoned(response, STALLED_READ_MS);
			return true;
		}

		const namesTrack =
			url.searchParams.has("track") || url.searchParams.has("subsong");
		const namesOrdinal = url.searchParams.has("ordinal");
		if (namesTrack && namesOrdinal)
			return json(
				response,
				{
					error: "a request names one of 'track' and 'ordinal', never both",
					detail: "",
				},
				400,
			);

		if (namesOrdinal) {
			const ordinal = url.searchParams.get("ordinal") ?? "";
			if (!/^\d+$/.test(ordinal) || Number(ordinal) > 0xffff_ffff)
				return json(
					response,
					{ error: "'ordinal' must be a non-negative number", detail: "" },
					400,
				);
			const structure = url.searchParams.get("structure") ?? "";
			if (!/^\d+$/.test(structure))
				return json(
					response,
					{
						error: "'structure' is required and must be a non-negative number",
						detail: "",
					},
					400,
				);

			const asked = url.searchParams.getAll("columns");
			const refused = refuseColumns(asked);
			if (refused) return json(response, refused, 400);

			if (Number(structure) !== state.libraryFeed.structure)
				return json(response, STRUCTURE_MOVED, 409);

			const held = hasLibrarySnapshot(state)
				? state.ordinalOrder()[Number(ordinal)]?.track
				: null;
			if (!held) return json(response, { error: "no such track" }, 404);

			return json(response, {
				columns: asked.map((expression) => evaluate(held, expression)),
			});
		}

		if (!namesTrack)
			return json(
				response,
				{ error: "'track' or 'ordinal' is required", detail: "" },
				400,
			);

		const asked = url.searchParams.getAll("columns");
		const refused = refuseColumns(asked);
		if (refused) return json(response, refused, 400);

		const address = url.searchParams.get("track") ?? "";
		if (!address || address.length > MAX_TRACK_ADDRESS)
			return json(
				response,
				{ error: "unacceptable track address", detail: "" },
				400,
			);

		// The caller asked this to find out what a write did, so one of the two
		// tracks at that address is worse than none.
		if (namesTwoTracks(state, address))
			return json(response, { error: NAMES_TWO_TRACKS, detail: "" }, 409);

		const held = libraryTrackAt(
			state,
			address,
			Number(url.searchParams.get("subsong")) || 0,
		);
		if (!held) return json(response, { error: "no such track" }, 404);

		return json(response, {
			columns: asked.map((expression) => evaluate(held, expression)),
		});
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
			if (fake.libraryBuilds > 0 || !fake.libraryReady)
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

	const recorded = state.record(method, path + url.search, body as never);

	const sendCover = (file: string, cacheControl: string) => {
		const conditional = Boolean(headers["if-none-match"]);
		return artwork(
			file,
			headers,
			reporting(response, (answer) => {
				recorded.answered = { conditional, ...answer };
			}),
			cacheControl,
		);
	};

	cors(response);

	if (method === "OPTIONS") {
		response.writeHead(204);
		return response.end();
	}

	if (path === "/api/status") {
		return json(response, {
			name: fake.name,
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
			canChangeOutput: fake.canChangeOutput,
			playerName: state.player.info.name,
			playerVersion: state.player.info.version,
			volumeMin: state.player.volume.min,
			volumeMax: state.player.volume.max,
			volumeUnit: state.player.volume.type,
			playbackModes: playbackModesOf(state),
			...(fake.canStream ? { streamFormats: fake.streamFormats } : null),
			...(fake.canWritePlaylists === "absent"
				? null
				: { canWritePlaylists: fake.canWritePlaylists }),
		});
	}

	if (path === "/api/state")
		return handleState({ state, fake, method, headers, response });

	if (method === "POST" && path === "/api/playback/play-pause") {
		if (state.latency > 0) await delay(state.latency);
		state.playPause();
		return empty(response);
	}

	if (method === "POST" && path === "/api/playback/next") {
		if (state.latency > 0) await delay(state.latency);
		state.next();
		return empty(response);
	}

	if (method === "POST" && path === "/api/playback/previous") {
		if (state.latency > 0) await delay(state.latency);
		state.previous();
		return empty(response);
	}

	if (method === "POST" && path === "/api/playback/stop") {
		if (state.latency > 0) await delay(state.latency);
		state.stop();
		return empty(response);
	}

	if (method === "POST" && path === "/api/playback/seek") {
		if (state.latency > 0) await delay(state.latency);
		const parsed = parseSeek(body);
		if (!parsed.ok) return json(response, parsed.body, parsed.status);
		state.patchPlayer(
			parsed.seconds !== undefined
				? { position: parsed.seconds }
				: { relativePosition: parsed.relativeSeconds },
		);
		return empty(response);
	}

	if (method === "POST" && path === "/api/playback/mode") {
		if (state.latency > 0) await delay(state.latency);
		if (typeof body !== "object" || body === null || Array.isArray(body))
			return json(
				response,
				{ error: "unacceptable mode", detail: NOT_A_JSON_OBJECT },
				400,
			);

		const record = body as Record<string, unknown>;
		const stray = Object.keys(record).find((key) => key !== "mode");
		if (stray)
			return json(
				response,
				{ error: "unacceptable mode", detail: FIELD_NOT_TAKEN },
				400,
			);

		if (typeof record.mode !== "string")
			return json(
				response,
				{
					error: "unacceptable mode",
					detail: "'mode' is required and must be a string",
				},
				400,
			);

		if (!PLAYBACK_MODES.has(record.mode as PlaybackMode))
			return json(
				response,
				{
					error: "unacceptable mode",
					detail: `'${record.mode}' is not a playback mode this API knows`,
				},
				400,
			);

		const index = orderIndexForMode(state, record.mode as PlaybackMode);
		if (index === null)
			return json(
				response,
				{ error: "this install does not offer that playback mode" },
				409,
			);

		state.patchPlayer({ options: [{ id: "playbackOrder", value: index }] });
		return empty(response);
	}

	if (method === "POST" && path === "/api/volume") {
		if (state.latency > 0) await delay(state.latency);
		const parsed = parseVolume(body, {
			min: state.player.volume.min,
			max: state.player.volume.max,
		});
		if (!parsed.ok) return json(response, parsed.body, parsed.status);
		if (parsed.value !== undefined) state.patchPlayer({ volume: parsed.value });
		else if (parsed.step !== undefined)
			state.nudgeVolume(parsed.step === "up" ? 1 : -1);
		else state.patchPlayer({ isMuted: parsed.muted });
		return empty(response);
	}

	if (fake.failQueue && method !== "GET" && path.startsWith("/api/queue")) {
		if (fake.failQueue === 429) response.setHeader("Retry-After", "1");
		return json(
			response,
			{ error: "the queue could not be changed", detail: "" },
			fake.failQueue,
		);
	}

	// A write that failed at the player rather than one it refused: a 500, a 429 from the rate
	// limiter, a connection that died. `/api/autoplaylists/preview` is read-only and excluded.
	if (
		fake.failPlaylistWrites &&
		method !== "GET" &&
		(path.startsWith("/api/playlists") || path === "/api/autoplaylists")
	) {
		if (fake.failPlaylistWrites === 429) response.setHeader("Retry-After", "1");
		return json(response, PLAYER_REFUSED, fake.failPlaylistWrites);
	}

	// How a queue mutation the player has already carried out is answered: at once,
	// or refused once `loseQueueAnswer` has passed, which is a client being told the
	// change failed after the queue moved.
	const queueChanged = async () => {
		if (fake.loseQueueAnswer === null) return empty(response);
		await delay(fake.loseQueueAnswer);
		return json(
			response,
			{ error: "the queue changed and the answer went missing", detail: "" },
			500,
		);
	};

	if (path === "/api/queue") {
		if (method === "GET") {
			if (state.latency > 0) await delay(state.latency);
			return json(response, {
				revision: state.queueRevision,
				entries: state
					.queuedEntries()
					.map((entry) => queuedTrackOf(state, entry)),
			});
		}

		if (method === "POST") {
			const source = queueSourceOf(body);
			if (source === "invalid")
				return json(
					response,
					{
						error: "malformed request",
						detail:
							"the body must name exactly one of a playlist's rows or the library's tracks",
					},
					400,
				);

			if (source === "rows") {
				const parsed = parseQueueRows(body);
				if (!parsed.ok) return json(response, parsed.body, parsed.status);

				// Judged by the route before the player is involved, which is why a
				// stale revision outranks an unknown playlist.
				if (parsed.at && parsed.at.revision !== state.queueRevision)
					return json(response, QUEUE_MOVED, 409);

				const playlist = state.playlistByGuid(parsed.playlistId);
				if (!playlist)
					return json(response, { error: "no such playlist", detail: "" }, 404);

				const pastEnd = parsed.positions.find(
					(position) => position >= playlist.items.length,
				);
				if (
					pastEnd !== undefined ||
					(parsed.at && parsed.at.index > state.queuedEntries().length)
				)
					return json(
						response,
						{ error: "that position is past the end", detail: "" },
						400,
					);

				state.queueInsert(
					parsed.positions.map((position) => ({
						playlistId: playlist.id,
						track: playlist.items[position],
					})),
					parsed.at?.index,
				);
				return queueChanged();
			}

			if (!fake.canReadLibrary)
				return json(
					response,
					{ error: "the media library is not available" },
					503,
				);
			if (state.libraryFeed.columns.length === 0)
				return json(response, NOT_BUILT, 503);

			const parsed = parseQueueTracks(
				body,
				state.libraryTracks.length,
				state.libraryFeed.structure,
			);
			if (!parsed.ok) return json(response, parsed.body, parsed.status);

			if (parsed.at && parsed.at.revision !== state.queueRevision)
				return json(response, QUEUE_MOVED, 409);

			if (parsed.at && parsed.at.index > state.queuedEntries().length)
				return json(
					response,
					{ error: "that position is past the end", detail: "" },
					400,
				);

			const ordered = state.ordinalOrder();
			state.queueInsert(
				parsed.ordinals.map((ordinal) => ({
					playlistId: null,
					track: ordered[ordinal].track,
				})),
				parsed.at?.index,
			);
			return queueChanged();
		}

		if (method === "DELETE") {
			if (state.latency > 0) await delay(state.latency);
			state.queueClear();
			return queueChanged();
		}

		return json(response, { error: "not found" }, 404);
	}

	if (path === "/api/queue/move" && method === "POST") {
		const parsed = parseMoveQueue(body);
		if (!parsed.ok) return json(response, parsed.body, parsed.status);

		if (parsed.revision !== state.queueRevision)
			return json(response, QUEUE_MOVED, 409);

		const length = state.queuedEntries().length;
		if (parsed.from >= length || parsed.to >= length)
			return json(
				response,
				{ error: "that position is past the end", detail: "" },
				400,
			);

		state.queueMove(parsed.from, parsed.to);
		return queueChanged();
	}

	const queueEntryMatch = /^\/api\/queue\/([^/]+)$/.exec(path);
	if (method === "DELETE" && queueEntryMatch) {
		const parsed = parseRemoveQueue(
			queueEntryMatch[1],
			url.searchParams.get("revision"),
		);
		if (!parsed.ok) return json(response, parsed.body, parsed.status);

		if (parsed.revision !== state.queueRevision)
			return json(response, QUEUE_MOVED, 409);

		if (parsed.index >= state.queuedEntries().length)
			return json(
				response,
				{ error: "that position is past the end", detail: "" },
				400,
			);

		state.queueRemoveAt(parsed.index);
		return queueChanged();
	}

	if (path.startsWith("/api/library/") || path === "/api/track/library")
		return handleLibrary({ state, fake, method, path, url, headers, response });

	// Outside handleLibrary on purpose: this route answers even in the window
	// canReadLibrary gates every /api/library/ route behind.
	if (path === "/api/track/playing") {
		response.setHeader("Cache-Control", ASK_EVERY_TIME);

		const knobsApply =
			fake.playingTrackKnobsFor === null || fake.playingTrackKnobsFor > 0;
		if (fake.playingTrackKnobsFor) fake.playingTrackKnobsFor -= 1;

		if (knobsApply && fake.failPlayingTrack)
			return json(
				response,
				{ error: "the player could not read the playing track", detail: "" },
				fake.failPlayingTrack,
			);

		if (knobsApply && fake.hangPlayingTrack) {
			await abandoned(response, STALLED_READ_MS);
			return true;
		}

		const asked = url.searchParams.getAll("columns");
		const refused = refuseColumns(asked);
		if (refused) return json(response, refused, 400);

		const track = state.playingTrack();
		if (!track) return json(response, { error: "nothing is playing" }, 404);

		return json(response, {
			path:
				(knobsApply ? fake.playingTrackAnswersPath : null) ??
				String(evaluate(track, "%path%") ?? ""),
			subsong:
				(knobsApply ? fake.playingTrackAnswersSubsong : null) ??
				(Number(track["%subsong%"]) || 0),
			columns: asked.map((expression) => evaluate(track, expression)),
		});
	}

	if (path === "/api/artwork") {
		const track = url.searchParams.get("track") ?? "";
		if (!track || track.length > MAX_TRACK_ADDRESS)
			return json(response, { error: "unacceptable track address" }, 400);

		const file = state.libraryArtworkFor(track);
		if (!file) {
			response.setHeader(
				"Cache-Control",
				freshFor(MISSING_COVER_CACHE_LIFETIME_SECONDS),
			);
			return json(response, NO_ARTWORK, 404);
		}

		return sendCover(file, freshFor(COVER_CACHE_LIFETIME_SECONDS));
	}

	// Addressed by nothing: no path, no index, no handle. Not gated on the media
	// library either, which is why the contract gives this route no 503 where
	// `GET /api/artwork` has one. The same URL names a different picture once the
	// track changes, so every outcome here revalidates rather than holding.
	if (path === "/api/artwork/playing") {
		response.setHeader("Cache-Control", ASK_EVERY_TIME);
		const file = state.playingArtwork();
		if (!file) return json(response, NO_ARTWORK, 404);

		return sendCover(file, ASK_EVERY_TIME);
	}

	// The fallback for a row `GET /api/artwork` cannot address: no path reaches the
	// client, so the playlist and the row stand in for one. A row the media library
	// already holds a path for is refused the same way a missing cover is -- one
	// album is one address, and a position is not an address for an album. A
	// position outlives no reorder, so every outcome revalidates rather than holding.
	const positionalArtworkMatch =
		/^\/api\/artwork\/playlists\/([^/]+)\/(\d+)$/.exec(path);
	if (positionalArtworkMatch) {
		response.setHeader("Cache-Control", ASK_EVERY_TIME);
		const [, guid, rowText] = positionalArtworkMatch;
		const playlist = state.playlistByGuid(guid);
		if (!playlist) return json(response, { error: "no such playlist" }, 404);

		const track = playlist.items[Number(rowText)];
		if (!track)
			return json(response, { error: "that position is past the end" }, 404);

		if (state.libraryPathFor(track)) return json(response, NO_ARTWORK, 404);

		const file = state.artworkFor(playlist.id, Number(rowText));
		if (!file) return json(response, NO_ARTWORK, 404);

		return sendCover(file, ASK_EVERY_TIME);
	}

	if (method === "GET" && path === "/api/playlists") {
		// The same latency switch the beefweb fake honours. Held after the request
		// is recorded and before the list is built, so a spec can hold a refetch
		// open across a playlist mutation the tick has already moved past.
		if (state.latency > 0) await delay(state.latency);

		const annotated = state.playlists.map((playlist, index) => ({
			id: playlist.guid,
			index,
			title: playlist.title,
			itemCount: playlist.items.length,
			isAutoPlaylist: locksAgainstAdds(fake, playlist),
			role: ownRoleOf(fake, playlist.id),
			structure: generationText(playlist.structure),
			revision: generationText(playlist.revision),
			managed: null,
		}));
		return json(response, {
			playlists: fake.annotatesEveryPlaylist
				? annotated
				: annotated.slice(0, -1),
		});
	}

	if (method === "POST" && path === "/api/playlists") {
		if (state.latency > 0) await delay(state.latency);

		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		const asked = body as {
			title?: unknown;
			source?: unknown;
			structure?: unknown;
			runs?: unknown;
			bitset?: unknown;
			ordinals?: unknown;
		} | null;
		if (typeof asked?.title !== "string" || asked.title.length === 0)
			return json(
				response,
				{
					error: "unacceptable title",
					detail: "'title' is required",
				},
				400,
			);

		let fillTracks: Track[] | null = null;

		if (asked.source !== undefined) {
			if (typeof asked.source !== "string" || !GUID_PATTERN.test(asked.source))
				return json(
					response,
					{
						error: "unacceptable playlist id",
						detail: "'source' must be a playlist id this component issued",
					},
					400,
				);
			if (
				asked.structure !== undefined ||
				asked.bitset !== undefined ||
				asked.ordinals !== undefined
			)
				return json(
					response,
					{
						error: "malformed request",
						detail:
							"'source' is refused with 'structure', 'bitset' or 'ordinals'",
					},
					400,
				);

			const source = state.playlistByGuid(asked.source);
			if (!source)
				return json(response, { error: "no such playlist", detail: "" }, 404);

			const selection = decodeSelection(
				{ runs: asked.runs },
				source.items.length,
			);
			if (!selection.ok)
				return json(response, selection.body, selection.status);

			fillTracks = selection.ordinals.map((ordinal) => source.items[ordinal]);
		} else if (
			asked.structure !== undefined ||
			asked.runs !== undefined ||
			asked.bitset !== undefined ||
			asked.ordinals !== undefined
		) {
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
			if (parsed.structure !== state.libraryFeed.structure)
				return json(response, STRUCTURE_MOVED, 409);

			const tracks = state.ordinalOrder();
			fillTracks = parsed.ordinals.map((ordinal) => tracks[ordinal].track);
		}

		const made = state.addPlaylist(asked.title);
		const playlist = requirePlaylist(state, made.id);
		if (fillTracks && fillTracks.length > 0)
			insertTracks(state, playlist, fillTracks, { replace: true });
		state.notifyPlaylists();

		return json(response, {
			id: playlist.guid,
			index: state.playlists.length - 1,
			title: playlist.title,
			itemCount: playlist.items.length,
			isAutoPlaylist: false,
			role: ownRoleOf(fake, playlist.id),
			structure: generationText(playlist.structure),
			revision: generationText(playlist.revision),
			managed: null,
		});
	}

	const byIdMatch = /^\/api\/playlists\/([^/]+)$/.exec(path);
	if ((method === "POST" || method === "DELETE") && byIdMatch) {
		if (state.latency > 0) await delay(state.latency);

		const guid = byIdMatch[1];
		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		if (ownRoleOf(fake, playlist.id)) return json(response, OWN_PLAYLIST, 403);

		if (method === "DELETE") {
			state.removePlaylist(playlist.id);
			return empty(response);
		}

		const asked = body as { title?: unknown } | null;
		if (typeof asked?.title !== "string" || asked.title.length === 0)
			return json(
				response,
				{ error: "unacceptable title", detail: "'title' is required" },
				400,
			);
		state.renamePlaylist(playlist.id, asked.title);
		return empty(response);
	}

	const moveMatch = /^\/api\/playlists\/([^/]+)\/move$/.exec(path);
	if (method === "POST" && moveMatch) {
		if (state.latency > 0) await delay(state.latency);

		const guid = moveMatch[1];
		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const asked = body as { index?: unknown } | null;
		if (!isNonNegInt(asked?.index))
			return json(
				response,
				{ error: "unacceptable index", detail: "'index' is required" },
				400,
			);
		if (asked.index >= state.playlists.length)
			return json(
				response,
				{ error: "that position is past the end", detail: "" },
				400,
			);

		state.movePlaylist(playlist.id, asked.index);
		return empty(response);
	}

	const playMatch = /^\/api\/playlists\/([^/]+)\/items\/(\d+)\/play$/.exec(
		path,
	);
	if (method === "POST" && playMatch) {
		const [, guid, indexText] = playMatch;
		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const index = Number(indexText);
		if (index >= playlist.items.length)
			return json(
				response,
				{ error: "that position is past the end", detail: "" },
				400,
			);

		state.playItem(playlist.id, index);
		return empty(response);
	}

	const rowsMatch = /^\/api\/playlists\/([^/]+)\/items$/.exec(path);
	if (method === "GET" && rowsMatch) {
		const guid = rowsMatch[1];
		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const offset = Number(url.searchParams.get("offset"));
		const count = Number(url.searchParams.get("count"));
		const columns = url.searchParams.getAll("columns");
		if (columns.length === 0)
			return json(
				response,
				{ error: "unacceptable column", detail: "'columns' is required" },
				400,
			);

		const page = playlist.items.slice(offset, offset + count);
		return json(response, {
			structure: generationText(playlist.structure),
			revision: generationText(playlist.revision),
			totalCount: playlist.items.length,
			items: page.map((track) => ({
				columns: columns.map((expression) => evaluate(track, expression)),
				libraryPath: state.libraryPathFor(track),
				// Off the handle the row was drawn from, so a row the media library
				// does not hold carries one too.
				subsong: subsongOf(track),
			})),
		});
	}

	const changesMatch = /^\/api\/playlists\/([^/]+)\/items\/changes$/.exec(path);
	if (method === "GET" && changesMatch) {
		const guid = changesMatch[1];
		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const columns = url.searchParams.getAll("columns");
		if (columns.length === 0)
			return json(
				response,
				{ error: "unacceptable column", detail: "'columns' is required" },
				400,
			);

		const structure = parseGeneration(url.searchParams.get("structure"));
		const since = parseGeneration(url.searchParams.get("since"));
		if (structure === null || since === null)
			return json(
				response,
				{
					error: "unacceptable revision",
					detail: "'structure' and 'since' must be a run of decimal digits",
				},
				400,
			);

		if (structure !== playlist.structure)
			return json(response, ROWS_MOVED, 409);

		if (since === playlist.revision)
			return json(response, {
				revision: generationText(playlist.revision),
				columns: [],
				items: [],
			});

		const at = playlist.changeHistory.findIndex(
			(entry) => entry.revision === since,
		);
		if (at < 0) return json(response, REVISION_GONE, 410);

		const positions = new Set<number>();
		for (const entry of playlist.changeHistory.slice(at + 1))
			for (const position of entry.positions) positions.add(position);

		const ordered = [...positions].sort((a, b) => a - b);
		const rows = ordered.map((position) => playlist.items[position]);

		return json(response, {
			revision: generationText(playlist.revision),
			columns: changedColumnDictionaries(columns, rows),
			items: ordered.map((position) => ({
				position,
				libraryPath: state.libraryPathFor(playlist.items[position]),
				subsong: subsongOf(playlist.items[position]),
			})),
		});
	}

	const copyMatch = /^\/api\/playlists\/([^/]+)\/items\/copy$/.exec(path);
	if (method === "POST" && copyMatch) {
		if (state.latency > 0) await delay(state.latency);

		const guid = copyMatch[1];
		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		const target = state.playlistByGuid(guid);
		if (!target)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const asked = body as { source?: unknown; runs?: unknown } | null;
		if (typeof asked?.source !== "string" || !GUID_PATTERN.test(asked.source))
			return json(
				response,
				{
					error: "unacceptable playlist id",
					detail: "'source' must be a playlist id this component issued",
				},
				400,
			);
		const source = state.playlistByGuid(asked.source);
		if (!source)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const selection = decodeSelection(
			{ runs: asked.runs },
			source.items.length,
		);
		if (!selection.ok) return json(response, selection.body, selection.status);

		if (locksAgainstAdds(fake, target) || fake.lockedPlaylists.has(target.id))
			return json(response, PLAYLIST_LOCKED, 409);

		const before = target.items.length;
		state.editItems(target, () => {
			target.items.push(
				...selection.ordinals.map((ordinal) => source.items[ordinal]),
			);
		});
		state.notifyPlaylists();

		return json(response, {
			structure: generationText(target.structure),
			positions: selection.ordinals.map((_, at) => before + at),
		});
	}

	const removeRowsMatch = /^\/api\/playlists\/([^/]+)\/items\/remove$/.exec(
		path,
	);
	if (method === "POST" && removeRowsMatch) {
		if (state.latency > 0) await delay(state.latency);

		const guid = removeRowsMatch[1];
		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const asked = body as { structure?: unknown } | null;
		const structure =
			typeof asked?.structure === "string"
				? parseGeneration(asked.structure)
				: null;
		if (structure === null)
			return json(
				response,
				{ error: "malformed request", detail: "'structure' is required" },
				400,
			);
		if (structure !== playlist.structure)
			return json(response, STRUCTURE_MOVED, 409);

		const selection = decodeSelection(
			body as Record<string, unknown>,
			playlist.items.length,
		);
		if (!selection.ok) return json(response, selection.body, selection.status);

		const drop = new Set(selection.ordinals);
		state.editItems(playlist, () => {
			playlist.items = playlist.items.filter((_, at) => !drop.has(at));
		});
		state.notifyPlaylists();

		return json(response, { structure: generationText(playlist.structure) });
	}

	const ownFillMatch = /^\/api\/playlists\/own\/([^/]+)\/items$/.exec(path);
	if (method === "POST" && ownFillMatch) {
		// The same latency switch the beefweb fake honours. Held after the request
		// is recorded and before the playlist is touched, so two racing fills are
		// applied in the order they arrived, as `MainThreadQueue` applies them.
		if (state.latency > 0) await delay(state.latency);

		const role = ownFillMatch[1];
		if (role !== "scratch")
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
			state,
			playlist,
			parsed.ordinals.map((ordinal) => tracks[ordinal].track),
			{ replace: true },
		);
		state.notifyPlaylists();

		return json(response, {
			playlistId: playlist.guid,
			structure: generationText(playlist.structure),
			positions,
		});
	}

	if (method === "DELETE" && ownFillMatch) {
		const role = ownFillMatch[1];
		if (role !== "scratch")
			return json(
				response,
				{
					error: "malformed request",
					detail: `'${role}' is not a role this component knows`,
				},
				400,
			);

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

		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		if (
			locksAgainstAdds(fake, playlist) ||
			fake.lockedPlaylists.has(playlist.id)
		)
			return json(response, PLAYLIST_LOCKED, 409);

		const parsed = parseFill(body, {
			requireTitle: false,
			trackCount: state.libraryTracks.length,
		});
		if (!parsed.ok) return json(response, parsed.body, parsed.status);

		if (parsed.structure !== state.libraryFeed.structure)
			return json(response, STRUCTURE_MOVED, 409);

		const tracks = state.ordinalOrder();
		const positions = insertTracks(
			state,
			playlist,
			parsed.ordinals.map((ordinal) => tracks[ordinal].track),
			{ replace: false },
		);
		state.notifyPlaylists();

		return json(response, {
			playlistId: guid,
			structure: generationText(playlist.structure),
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
		// Before the limit, as the component checks it: the two refusals have separate causes and a
		// fixture setting both would otherwise be told the wrong one.
		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);
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
		const playlist = requirePlaylist(state, made.id);

		return json(response, {
			id: playlist.guid,
			index: state.playlists.length - 1,
			title: playlist.title,
			itemCount: playlist.items.length,
			isAutoPlaylist: true,
			role: ownRoleOf(fake, playlist.id),
			structure: generationText(playlist.structure),
			revision: generationText(playlist.revision),
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

		const written = body as {
			track?: unknown;
			subsong?: unknown;
			ordinal?: unknown;
			playlist?: unknown;
			index?: unknown;
			structure?: unknown;
			fields?: Record<string, string>;
		} | null;

		// Decided while the address is being resolved and so ahead of `failWrites`,
		// which stands for the player failing at a write it had already taken on.
		if (namesTwoTracks(state, written?.track))
			return json(response, { written: false, error: NAMES_TWO_TRACKS }, 409);

		// A write that lands anyway is refused at the end instead, once the address
		// has resolved and the tag has been written.
		if (fake.failWrites && !fake.writesLandAnyway)
			return refuseWrite(response, fake.failWrites);

		if (!written?.fields || Object.keys(written.fields).length === 0)
			return json(
				response,
				{
					written: false,
					error: "no fields to write",
					detail: "'fields' names at least one tag",
				},
				400,
			);

		// No filesystem path crosses this API any more, so a client still sending
		// one is refused rather than met halfway: the component declares its
		// members and takes nothing else.
		if ("path" in written)
			return json(
				response,
				{
					written: false,
					error: "unacceptable address",
					detail: "'path' is not a member of this request",
				},
				400,
			);

		const forms = (["track", "ordinal", "playlist"] as const).filter(
			(form) => written[form] !== undefined,
		);
		if (forms.length !== 1)
			return json(
				response,
				{
					written: false,
					error: "unacceptable address",
					detail:
						forms.length === 0
							? "'track', 'ordinal' or 'playlist' is required"
							: "a request names one of 'track', 'ordinal' and 'playlist', never two",
				},
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

		const stored =
			fake.storesRatingAs !== null && "rating" in written.fields
				? { ...written.fields, rating: fake.storesRatingAs }
				: written.fields;

		// The precise library form. One ordinal names one track of one root, so
		// nothing here can be ambiguous; what it can be is held against a snapshot
		// the player has replaced.
		if (forms[0] === "ordinal") {
			if (
				!Number.isInteger(written.ordinal) ||
				!Number.isInteger(written.structure)
			)
				return json(
					response,
					{
						written: false,
						error: "unacceptable address",
						detail: "'ordinal' and 'structure' are whole numbers",
					},
					400,
				);

			if (written.structure !== state.libraryFeed.structure)
				return json(response, LIBRARY_REBUILT, 409);

			// One answer for an ordinal past the end of the snapshot as well as for a
			// generation that has moved, because the component's own resolver reports
			// both as a miss and `writeToOrdinal` cannot tell them apart.
			const held = hasLibrarySnapshot(state)
				? state.ordinalOrder()[written.ordinal as number]?.track
				: null;
			if (!held) return json(response, LIBRARY_REBUILT, 409);

			applyTags(state, held, stored);
			if (fake.failWrites) return refuseWrite(response, fake.failWrites);
			return json(response, {
				written: true,
				ordinal: written.ordinal,
				fields: stored,
			});
		}

		if (forms[0] === "track") {
			if (
				typeof written.track !== "string" ||
				(written.subsong !== undefined &&
					!Number.isInteger(written.subsong as number))
			)
				return json(
					response,
					{
						written: false,
						error: "unacceptable address",
						detail: "'track' is a string and 'subsong' a whole number",
					},
					400,
				);

			const subsong = (written.subsong as number) ?? 0;
			const held = libraryTrackAt(state, written.track, subsong);
			if (!held) return json(response, NO_SUCH_TRACK, 404);

			applyTags(state, held, stored);
			if (fake.failWrites) return refuseWrite(response, fake.failWrites);
			return json(response, {
				written: true,
				track: written.track,
				subsong,
				fields: stored,
			});
		}

		if (
			typeof written.playlist !== "string" ||
			!Number.isInteger(written.index as number) ||
			typeof written.structure !== "string"
		)
			return json(
				response,
				{
					written: false,
					error: "unacceptable address",
					detail:
						"'playlist' and 'structure' are strings and 'index' a whole number",
				},
				400,
			);

		const playlist = state.playlistByGuid(written.playlist);
		if (!playlist) return json(response, NO_SUCH_TRACK, 404);

		// Before the row is read, so a write aimed at one row can never land on
		// another.
		if (written.structure !== generationText(playlist.structure))
			return json(response, TAG_ROWS_MOVED, 409);

		const row = playlist.items[written.index as number];
		if (!row) return json(response, NO_SUCH_TRACK, 404);

		applyTags(state, row, stored);
		if (fake.failWrites) return refuseWrite(response, fake.failWrites);
		return json(response, {
			written: true,
			playlist: written.playlist,
			index: written.index,
			fields: stored,
		});
	}

	return json(response, { error: "not found" }, 404);
}
