import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import type { Bucket, Limiter, RateLimits } from "./rateLimits.ts";

export type OwnPlaylistRole = "scratch";

// Spelled the way foobar2000 prints a device pair: one module GUID shared by every device it
// offers, joined by a colon to each device's own, both upper case and without braces. The default
// endpoint's device GUID is all zeros, which is why the first entry carries one. Three, so the
// picker is drawn by default rather than only where a fixture asks for it, and one name long
// enough that a spec can prove it wraps.
export const DEFAULT_OUTPUT_DEVICES: { id: string; name: string }[] = [
	{
		id: "D41D2423-FDC8-45E3-B2A9-CC1FE04A7EE5:00000000-0000-0000-0000-000000000000",
		name: "Primary Sound Driver",
	},
	{
		id: "D41D2423-FDC8-45E3-B2A9-CC1FE04A7EE5:1F1A722D-33C9-434B-8B92-A3C7AF5E3D3D",
		name: "Speakers (Realtek(R) Audio) [WASAPI]",
	},
	{
		id: "D41D2423-FDC8-45E3-B2A9-CC1FE04A7EE5:9B8F1A2C-7D3E-4F5A-8B6C-1D2E3F4A5B6C",
		name: "WASAPI (shared) : LG TV SSCR2 (NVIDIA High Definition Audio) (HDMI)",
	},
];

export interface FooJeanOptions {
	// False destroys every `/api/` connection rather than answering one: no component on the network.
	reachable?: boolean;

	// The `name`, `version` and `apiVersion` that `GET /api/capabilities` reports.
	name?: string;
	version?: string;
	apiVersion?: number;

	// The tag fields a write may name. An empty list is an install with tag writing switched off.
	allowedFields?: string[];

	// Refuses `POST /api/tags` with this status before anything is written.
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

	// Limits the four `*PlayingTrack*` knobs to the first n reads of `GET /api/track/playing`; unset applies them to every read.
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
	failState?: Refusal<"failState"> | null;

	// Destroys the connection of `GET /api/state` unanswered, the way a phone leaving wifi loses a poll.
	dropState?: boolean;

	// Holds GET /api/state open and never answers it, switched like `failState`.
	// `foo_jean` answers this route from its own store and never waits on the
	// player, so this is the network losing the answer rather than the player
	// withholding one.
	hangState?: boolean;

	// foobar2000's main thread no longer running what the component posts to it:
	// `GET /api/state` goes on answering, and says so under `mainThread`.
	mainThreadStalled?: boolean;

	// Holds GET /api/capabilities until switched back off, which answers every
	// request held with what the install offers by then: discovery answered as
	// slowly as a spec wants it.
	hangCapabilities?: boolean;

	// Refuse each artwork route with a status only that route can answer, after
	// the rate limit has been spent the way the component spends it.
	failArtwork?: Refusal<"failArtwork"> | null;
	failPlayingArtwork?: Refusal<"failPlayingArtwork"> | null;
	failRowArtwork?: Refusal<"failRowArtwork"> | null;

	// Holds GET /api/artwork open without answering. `foo_jean` reads that cover
	// from disk on the connection thread with no timeout; the playing cover is
	// held in memory and the positional one times out as a 504, so neither hangs.
	hangArtwork?: boolean;

	// The component's token buckets, sized as `COMPONENT_RATE_LIMITS`. Off unless
	// given: the demo replays its whole journal through this fake in one burst,
	// which no real client does. The suite's fixture turns them on.
	rateLimits?: RateLimits | null;

	// The buckets a spec means to be refused by. The suite fails any other `429` a
	// bucket answers, since a client meeting a rate limit it did not ask for is
	// sending a burst the player would refuse.
	expectRateLimited?: Bucket[];

	// Answers built when a request arrives and delivered this many milliseconds
	// later, plus up to `jitterMs` at random, keyed by `"METHOD /api/path"` and
	// matched as a prefix. Built first so that a slow answer carries what the
	// player held when it was asked, which is what lets two of them arrive in the
	// opposite order to the one they were asked in.
	routeLatency?: Record<string, { ms: number; jitterMs?: number }>;

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

	// How many changes of a playlist the fake retains for `GET /playlists/{id}/items/changes`.
	playlistChangeWindow?: number;

	// False is the component loaded without the library feature: every library route answers `503`.
	canReadLibrary?: boolean;
	// False means no build ever finishes, so no snapshot is held: a freshly started player before anything has asked for one.
	libraryReady?: boolean;
	// Polls of `GET /api/state` answered before a declared set finishes building; the rows route is a `202` until then.
	libraryBuilds?: number;
	// Structure rebuilds of the same tracks, one at each next state poll.
	libraryRebuilds?: number;
	// `foo_jean` stopping its library worker for good after it kept failing: `GET /api/state`
	// answers `library.halted`, no build starts or finishes, and the snapshot held is served.
	// `POST /__control/libraryHalted` sets it mid-test.
	libraryHalted?: boolean;

	// Tracks per `formatting` step of a build. While `libraryBuilds` counts down, each state poll walks
	// `build` one step: `listing`, `ordering`, then a `formatted` at every slice boundary but the last.
	// Unset takes the whole library in one slice, so `formatted` never reports above 0.
	librarySlice?: number;

	// Holds every `GET /api/library/summary` that has passed its refusals unanswered, so a spec can draw Home while it waits. Assigning `false` answers the ones held.
	holdSummary?: boolean;

	// Refuses that many `GET /api/library/summary` requests with `status`, then answers normally.
	failSummary?: { status: 429 | 500 | 503; times: number } | null;

	// Holds every `GET /api/library/album`, `artist`, `genre`, `search`, `credits` and `values` that has passed its refusals unanswered. Assigning `false` answers the ones held.
	holdQuestions?: boolean;

	// Refuses that many of those requests with `status`, or destroys the connection unanswered for `"drop"`, then answers normally.
	failQuestions?: { status: 429 | 500 | 503 | "drop"; times: number } | null;

	// Holds every `POST /api/library/rows` that has passed its refusals unanswered, and nothing else. Assigning `false` answers the ones held.
	holdRows?: boolean;

	// Refuses that many rows answers with `status`, a `429` carrying the rows bucket's body and `Retry-After`, or destroys the connection unanswered for `"drop"`, then answers normally. No question is touched.
	failRows?: { status: 429 | 500 | 503 | "drop"; times: number } | null;

	// How many autoplaylists the component will make.
	maxAutoPlaylists?: number;
	// Playlist keys the component reports as already being autoplaylists, whether it
	// made them or not. An autoplaylist created in foobar2000 itself looks like
	// this and is not one Jean may update or delete.
	autoPlaylists?: string[];
	// False is an install with the library feature off.
	libraryEnabled?: boolean;
	// Refuses playlist creation with this status.
	failCreate?: number | null;
	// Refuses a move or a sort at the player after every check has passed, leaving the rows where
	// they were: a 500, a 429 from the rate limiter and a dead connection are one event to a client.
	failRowEdit?: number | null;
	// The specification of autoplaylists Jean made, by the fake's own playlist key, read once when
	// the fake is built. Each is also an autoplaylist, so it need not be named in `autoPlaylists`;
	// one named only there is one foobar2000 or another component made, and carries `managed: null`.
	autoPlaylistSpecs?: Record<string, ManagedAutoPlaylist>;
	// Query previews answered `429` before the limiter lets one through, shaped
	// like the other `...Busy` knobs. `POST /__control/previewBusy` sets it mid-test.
	previewBusy?: number;

	// `canWritePlaylists` in `GET /api/capabilities`; `"absent"` leaves the field out.
	canWritePlaylists?: boolean | "absent";
	// `canChangeOutput` in `GET /api/capabilities`.
	canChangeOutput?: boolean;
	// `canControlPlayback` in `GET /api/capabilities`.
	canControlPlayback?: boolean;

	// The player's own device list and which one it is set to. `activeOutput` rides straight
	// through to `GET /api/state`'s `outputDeviceId` even where it names no listed device, which is
	// what an unplugged device looks like; `GET /api/outputs`' own `active` answers `null` in that
	// case instead, per its own description in `contract/openapi.yaml`. A single entry stands for
	// a machine with only one output, such as no second sound card, where the picker must not be
	// drawn at all. `NULL_OUTPUT_DEVICE` as `activeOutput` is a player nobody can hear, and
	// `GET /api/state` answers `outputSilent: true` for it.
	outputDevices?: { id: string; name: string }[];
	activeOutput?: string | null;

	// Refuses every `POST /api/outputs/active`, whatever `deviceId` it names. `409` stands for a
	// device unplugged between the list landing and the switch arriving; `500` for the player
	// refusing the write outright.
	outputSwitchRefusal?: 409 | 500 | null;

	// How many detached sessions the install offers.
	maxSessions?: number;
	// Whether the install offers detached sessions; it reads false while `canStream` does.
	canCreateSessions?: boolean;
	// A session-scoped route naming no session answers `500` with its path in the body.
	strictSessions?: boolean;

	// `canStream` in `GET /api/capabilities`.
	canStream?: boolean;
	// Best first, as the component reports it. An install whose Windows has no AAC
	// encoder reports `opus` alone.
	streamFormats?: string[];
	// Which of `streamFormats` get bytes of the declared type.
	playableFormats?: string[];
	// `short` ends after what it has sent; `quiet` opens, sends the container header, then nothing, the one case with no error to catch.
	streamBehaviour?: "ok" | "short" | "quiet";
	// Seconds of audio primed ahead of the live edge; `12 - prime` is the lag a spec about it waits out.
	streamPrime?: number;
	// A timeline mark lands this long after the change or seek that laid it.
	markDelayMs?: number;
	// Refuses stream tickets with this status; `ticketError` says which kind of refusal.
	failTickets?: number | null;
	// The body of a `failTickets` refusal, separating "busy" from "not supported".
	ticketError?: string;
	// `GET /stream` answers `401` as if the ticket had expired.
	expireTickets?: boolean;
	// Whether the install mutes the player while someone listens.
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
}

export interface FooJeanFake extends Required<FooJeanOptions> {
	ownPlaylists: Partial<Record<OwnPlaylistRole, string>>;
	// Playlist keys a control has locked against edits mid-test, consulted beside `isAuto`.
	// `POST /__control/lockPlaylist` is the only way in or out of this set.
	lockedPlaylists: Set<string>;
	// Moves whenever a switch a control route flips actually changes, mirroring
	// `GET /api/state`'s `configGeneration`. `/__control/controlPlayback` and
	// `/__control/writePlaylists` are the only two that touch it.
	configGeneration: number;
	// When a state poll first saw `mainThreadStalled`, so `unansweredSeconds` grows the way the
	// component's does.
	mainThreadStalledAt: number | null;
	limiter: Limiter;
	capabilitiesHeld: (() => void)[];
	summariesHeld: (() => void)[];
	questionsHeld: (() => void)[];
	rowsHeld: (() => void)[];
	// The specification of every autoplaylist `POST /api/autoplaylists` made, by the
	// fake's own key: the only playlists the two `/api/autoplaylists/{id}` routes touch.
	managedAutoPlaylists: Map<string, ManagedAutoPlaylist>;
}

export type ManagedAutoPlaylist = components["schemas"]["ManagedAutoPlaylist"];

const DEFAULTS: FooJeanFake = {
	ownPlaylists: {},
	reachable: true,
	name: "foo_jean",
	version: "0.1.0",
	apiVersion: 1,
	allowedFields: [
		"rating",
		"unsynced lyrics",
		"TITLE",
		"ARTIST",
		"ALBUM",
		"ALBUM ARTIST",
		"DATE",
		"GENRE",
		"PUBLISHER",
		"COMPOSER",
		"TRACKNUMBER",
		"TOTALTRACKS",
		"DISCNUMBER",
		"TOTALDISCS",
		"BPM",
	],
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
	dropState: false,
	hangState: false,
	mainThreadStalled: false,
	hangCapabilities: false,
	capabilitiesHeld: [],
	summariesHeld: [],
	questionsHeld: [],
	rowsHeld: [],
	failArtwork: null,
	failPlayingArtwork: null,
	failRowArtwork: null,
	hangArtwork: false,
	rateLimits: null,
	expectRateLimited: [],
	routeLatency: {},
	failQueue: null,
	failPlaylistWrites: null,
	loseQueueAnswer: null,
	knowsPlayingLocation: true,
	annotatesEveryPlaylist: true,
	playlistChangeWindow: 32,
	maxSessions: 0,
	canCreateSessions: false,
	strictSessions: false,
	canStream: true,
	streamFormats: ["opus", "aac"],
	playableFormats: ["opus", "aac"],
	streamBehaviour: "ok",
	streamPrime: 15,
	markDelayMs: 0,
	failTickets: null,
	ticketError: "",
	expireTickets: false,
	canMuteWhileStreaming: true,
	otherListeners: [],
	canReadLibrary: true,
	libraryReady: true,
	libraryBuilds: 0,
	libraryRebuilds: 0,
	libraryHalted: false,
	librarySlice: Infinity,
	holdSummary: false,
	failSummary: null,
	holdQuestions: false,
	failQuestions: null,
	holdRows: false,
	failRows: null,
	maxAutoPlaylists: 0,
	autoPlaylists: [],
	libraryEnabled: true,
	failCreate: null,
	failRowEdit: null,
	autoPlaylistSpecs: {},
	previewBusy: 0,
	canWritePlaylists: true,
	canChangeOutput: true,
	canControlPlayback: true,
	outputDevices: DEFAULT_OUTPUT_DEVICES,
	activeOutput: DEFAULT_OUTPUT_DEVICES[0].id,
	outputSwitchRefusal: null,
	lockedPlaylists: new Set(),
	configGeneration: 1,
	mainThreadStalledAt: null,
	limiter: new Map(),
	managedAutoPlaylists: new Map(),
};

// The refusals each route can really answer, read off `contract/openapi.yaml` and
// `foo_jean`'s route handlers. A knob asked for anything else is a state the
// player never reaches, and a spec green against it proves nothing.
const ANSWERABLE = {
	failState: { route: "GET /api/state", statuses: [429] },
	failArtwork: {
		route: "GET /api/artwork",
		statuses: [400, 404, 413, 429, 503],
	},
	failPlayingArtwork: {
		route: "GET /api/artwork/playing",
		statuses: [404, 413, 429],
	},
	failRowArtwork: {
		route: "GET /api/artwork/playlists/{id}/{row}",
		statuses: [400, 404, 413, 429, 500, 503, 504],
	},
} as const;

type Knob = keyof typeof ANSWERABLE;
type Refusal<K extends Knob> = (typeof ANSWERABLE)[K]["statuses"][number];

const refuseUnanswerable = (knob: Knob, status: unknown) => {
	const { route, statuses } = ANSWERABLE[knob];
	if (status === null || status === undefined) return;
	if (!(statuses as readonly unknown[]).includes(status))
		throw new Error(
			`fake fooJean: ${knob} = ${String(status)} is a state the player never reaches; ${route} answers ${statuses.join(", ")}`,
		);
};

// Each knob in `ANSWERABLE` becomes an accessor that checks what it is set to,
// since specs switch them mid-test by plain assignment.
const guardRefusals = (fake: FooJeanFake): FooJeanFake => {
	for (const knob of Object.keys(ANSWERABLE) as Knob[]) {
		let held = fake[knob];
		refuseUnanswerable(knob, held);
		Object.defineProperty(fake, knob, {
			enumerable: true,
			get: () => held,
			set: (next: typeof held) => {
				refuseUnanswerable(knob, next);
				held = next;
			},
		});
	}
	return fake;
};

const releaseHeldCapabilitiesWhenSwitchedOff = (
	fake: FooJeanFake,
): FooJeanFake => {
	let hanging = fake.hangCapabilities;
	Object.defineProperty(fake, "hangCapabilities", {
		enumerable: true,
		get: () => hanging,
		set: (next: boolean) => {
			hanging = next;
			if (!next) for (const answer of fake.capabilitiesHeld.splice(0)) answer();
		},
	});
	return fake;
};

const releaseWhenHoldEnds =
	(
		hold: "holdSummary" | "holdQuestions" | "holdRows",
		held: "summariesHeld" | "questionsHeld" | "rowsHeld",
	) =>
	(fake: FooJeanFake): FooJeanFake => {
		let holding = fake[hold];
		Object.defineProperty(fake, hold, {
			enumerable: true,
			get: () => holding,
			set: (next: boolean) => {
				holding = next;
				if (!next) for (const wake of fake[held].splice(0)) wake();
			},
		});
		return fake;
	};

const releaseSummariesWhenHoldEnds = releaseWhenHoldEnds(
	"holdSummary",
	"summariesHeld",
);

const releaseQuestionsWhenHoldEnds = releaseWhenHoldEnds(
	"holdQuestions",
	"questionsHeld",
);

const releaseRowsWhenHoldEnds = releaseWhenHoldEnds("holdRows", "rowsHeld");

export const fooJeanState = (options: FooJeanOptions): FooJeanFake => {
	const specs = options.autoPlaylistSpecs ?? {};
	const fake = guardRefusals({
		...DEFAULTS,
		...options,
		// Copied, since a route or a spec mutates each of these in place and `DEFAULTS`
		// outlives every test on a worker.
		autoPlaylists: [
			...new Set([...(options.autoPlaylists ?? []), ...Object.keys(specs)]),
		],
		expectRateLimited: [...(options.expectRateLimited ?? [])],
		routeLatency: { ...options.routeLatency },
		ownPlaylists: {},
		lockedPlaylists: new Set(),
		limiter: new Map(),
		capabilitiesHeld: [],
		summariesHeld: [],
		questionsHeld: [],
		rowsHeld: [],
		managedAutoPlaylists: new Map(
			Object.entries(specs).map(([id, spec]) => [id, { ...spec }]),
		),
	});
	return releaseRowsWhenHoldEnds(
		releaseQuestionsWhenHoldEnds(
			releaseSummariesWhenHoldEnds(
				releaseHeldCapabilitiesWhenSwitchedOff(fake),
			),
		),
	);
};
