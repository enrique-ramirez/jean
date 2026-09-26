import type { Operation } from "./spec.ts";

export interface Attempt {
	pathParams?: Record<string, string>;
	query?: Record<string, string>;
	body?: unknown;
}

export interface Context {
	run: string;
	deviceId: string;
	playlistId: string | null;
	playlistPage: { structure: string; revision: string } | null;
	managed: unknown;
	ticket: string | null;
	revision: number | null;
}

export type Probe = (operation: Operation, context: Context) => Attempt | null;

export interface Drive {
	id: string;
	probe: Probe;
	learns?: (body: unknown, context: Context) => void;
}

// Comfortably past anything a freshly started component or a long-running one will have
// reached, so a move or a remove naming it is refused for a stale revision without knowing
// what the real one is.
const kUnreachableRevision = 4_294_967_295;

// A well-formed id no implementation has handed out, so an operation driven at it is answered
// `404` without anything of the player owner's being touched. The five playlist edits are
// driven this way because none of them can be asked for real: a rename, a move and above all a
// delete aimed at a playlist somebody owns would change or destroy it, a copy would leave rows
// in it and a removal would take theirs out, and unlike the autoplaylist a run creates for
// itself there is nothing here to aim any of them at.
const kUnissuedPlaylistId = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";

// A well-formed id no output device will ever carry, so a switch driven at it is refused with
// 409 before the player is asked to move anything: the conformance run reads what the owner's
// outputs are and switches none of them, the same shape kUnissuedPlaylistId buys the playlist
// edits above.
const kUnissuedOutputDeviceId = "contract-check:no-such-output-device";

const example = (operation: Operation, name: string): unknown => {
	const offered = operation.examples[name];
	if (offered === undefined)
		throw new Error(
			`${operation.id} publishes no request example called ${name}`,
		);

	return offered;
};

// contract/README.md has why the suite touches a real player in this order and no other.
export const drives: Drive[] = [
	{ id: "getStatus", probe: () => ({}) },
	{ id: "getCapabilities", probe: () => ({}) },
	{ id: "getPlaylists", probe: () => ({}) },
	{ id: "getQueue", probe: () => ({}) },
	{
		// Same refusal shape as fillOwnPlaylist and fillPlaylist: the spec's own example
		// names a structure no real library will be sitting on, so this queues nothing.
		id: "queueTracks",
		probe: (operation) => ({ body: example(operation, "libraryTracks") }),
	},
	{
		// A revision no real queue holds -- an implementation starts counting from a low
		// one -- so this is refused before the player is ever asked to move anything.
		id: "moveQueueEntry",
		probe: () => ({ body: { from: 0, to: 0, revision: kUnreachableRevision } }),
	},
	{
		// Same refusal, and for the same reason: nothing is removed.
		id: "removeQueueEntry",
		probe: () => ({
			pathParams: { index: "0" },
			query: { revision: String(kUnreachableRevision) },
		}),
	},
	{
		// Unlike every other probe here, this empties whatever the queue actually holds:
		// clearing carries no revision to refuse it against, so there is no shape of this
		// request that both reaches the player and mutates nothing.
		id: "clearQueue",
		probe: () => ({}),
	},
	{
		// No body, no address, and so no shape of this request that both reaches the player
		// and leaves it untouched: this toggles whatever a real listener's player is doing.
		id: "playPause",
		probe: () => ({}),
	},
	{
		id: "nextTrack",
		probe: () => ({}),
	},
	{
		id: "previousTrack",
		probe: () => ({}),
	},
	{
		id: "stop",
		probe: () => ({}),
	},
	{
		// Naming neither `seconds` nor `relativeSeconds` is refused before the player is
		// asked, so this pins the 400 shape without moving a real listener's position.
		id: "seek",
		probe: () => ({ body: {} }),
	},
	{
		// Naming no `mode` is refused before the player is asked, so this pins the 400 shape
		// without changing the order a real listener's next track comes from.
		id: "setPlaybackMode",
		probe: () => ({ body: {} }),
	},
	{
		// Naming none of `value`, `step` and `muted` is refused before the player is asked,
		// so this pins the 400 shape without moving a real listener's level.
		id: "setVolume",
		probe: () => ({ body: {} }),
	},
	{
		id: "getOutputs",
		probe: () => ({}),
	},
	{
		id: "setActiveOutput",
		probe: () => ({ body: { deviceId: kUnissuedOutputDeviceId } }),
	},
	{
		id: "getState",
		probe: () => ({}),
		learns: (body, context) => {
			const state = body as { library?: { revision?: number } };
			context.revision = state.library?.revision ?? null;
		},
	},
	{
		id: "exportLibrary",
		probe: () => ({ query: { columns: "%title%" } }),
	},
	{
		id: "getLibraryChanges",
		probe: (_, context) =>
			context.revision === null
				? null
				: { query: { since: String(context.revision) } },
	},
	{ id: "refreshLibrary", probe: () => ({}) },
	{
		// The suite holds no library-relative path, for the reason `getArtwork` gives, so this
		// drives the refusal instead. `columns` is a declaration the column gate accepts, so the
		// 404 says the snapshot did not hold the address rather than the gate refusing first.
		id: "getLibraryTrack",
		probe: (_, context) => ({
			query: {
				track: `contract check ${context.run}/no such track.flac`,
				columns: "%title%",
			},
		}),
	},
	{
		// The snapshot is binary and the suite holds no library-relative path out of it, so
		// this drives the refusal instead. That is the answer worth pinning anyway: an
		// address the snapshot does not carry MUST be a 404 in the published shape and never
		// somebody else's sleeve.
		id: "getArtwork",
		probe: (_, context) => ({
			query: { track: `contract check ${context.run}/no such track.flac` },
		}),
	},
	{
		// Whether anything is playing is not this run's to arrange, so this drives the route
		// with an acceptable declaration and lets a conformant implementation answer either
		// the track or the 404 `getPlayingArtwork` answers for the same reason.
		id: "getPlayingTrack",
		probe: () => ({ query: { columns: "%title%" } }),
	},
	{ id: "getPlayingArtwork", probe: () => ({}) },
	{
		id: "getPlaylistRowArtwork",
		probe: () => ({
			pathParams: { id: kUnissuedPlaylistId, row: "0" },
		}),
	},
	{
		// The one probe in this file that changes a file on disk if its address resolves, and
		// the spec's example is library-relative, so any library holding a track at that path
		// would come back rated four stars. The address is salted like `getArtwork`'s instead;
		// the fields still come from the spec, which is what the write itself is held to.
		id: "writeTags",
		probe: (operation, context) => ({
			body: {
				...(example(operation, "setRating") as Record<string, unknown>),
				track: `contract check ${context.run}/no such track.flac`,
			},
		}),
	},
	{
		id: "previewQuery",
		probe: (operation) => ({ body: example(operation, "default") }),
	},
	{
		id: "createAutoPlaylist",
		probe: (operation, context) => ({
			body: {
				...(example(operation, "keyed") as Record<string, unknown>),
				title: `contract check ${context.run}`,
				key: `contract-check:${context.run}`,
			},
		}),
		learns: (body, context) => {
			const made = body as { id?: string; managed?: unknown };
			context.playlistId = made.id ?? null;
			context.managed = made.managed ?? null;
		},
	},
	{
		// The autoplaylist the run just created rather than whatever playlist an install
		// happens to hold, so what this pins is a page a conformant implementation answered
		// and not a 404. An autoplaylist whose query matches nothing answers a page of no
		// rows, which is the same shape.
		id: "getPlaylistItems",
		probe: (_, context) =>
			context.playlistId === null
				? null
				: {
						pathParams: { id: context.playlistId },
						query: { offset: "0", count: "1", columns: "%title%" },
					},
		learns: (body, context) => {
			const page = body as { structure?: string; revision?: string };
			context.playlistPage =
				page.structure === undefined || page.revision === undefined
					? null
					: { structure: page.structure, revision: page.revision };
		},
	},
	{
		id: "getPlaylistItemChanges",
		probe: (_, context) =>
			context.playlistId === null || context.playlistPage === null
				? null
				: {
						pathParams: { id: context.playlistId },
						query: {
							structure: context.playlistPage.structure,
							since: context.playlistPage.revision,
							columns: "%title%",
						},
					},
	},
	{
		// A playlist nobody issued, because this is the one operation here whose successful
		// answer is a sound coming out of somebody's speakers. A 404 is what a conformant
		// implementation answers an id it never handed out, and driving the refusal is the
		// only shape of this request that leaves the player playing what it was playing.
		id: "playPlaylistRow",
		probe: () => ({
			pathParams: { id: "45837d74-fa4f-415c-bba9-bf2db8f0dc04", index: "0" },
		}),
	},
	{
		id: "updateAutoPlaylist",
		// An update replaces the whole specification, so it sends back what the create
		// answered. Omitting the title is what leaves the name alone.
		probe: (_, context) =>
			context.playlistId === null
				? null
				: { pathParams: { id: context.playlistId }, body: context.managed },
	},
	{
		id: "removeAutoPlaylist",
		probe: (_, context) =>
			context.playlistId === null
				? null
				: { pathParams: { id: context.playlistId } },
	},
	{
		// The spec's own example names a `structure` no real library will be sitting on, so a
		// conformant implementation refuses it with `409` before touching the player: nothing is
		// created and nothing is filled, the same low footprint `writeTags` gets from a track
		// that does not exist.
		id: "fillOwnPlaylist",
		probe: (operation) => ({
			pathParams: { role: "scratch" },
			body: example(operation, "runs"),
		}),
	},
	{
		id: "emptyOwnPlaylist",
		probe: () => ({ pathParams: { role: "scratch" } }),
	},
	{
		// Same refusal, and the id is one nobody issued, so a `404` is at least as likely as the
		// `409` -- either way this inserts nothing, which is the point.
		id: "fillPlaylist",
		probe: (operation) => ({
			pathParams: { id: "45837d74-fa4f-415c-bba9-bf2db8f0dc04" },
			body: example(operation, "runs"),
		}),
	},
	{
		// Nothing here deletes a playlist, so a create that succeeded would leave one on the
		// player for good: `createAutoPlaylist` can be driven for real only because
		// `removeAutoPlaylist` follows it. The spec's own example names a `structure` no real
		// library will be sitting on, so this is refused with `409` before the player is asked
		// to make anything, the same low footprint the two fills take.
		id: "createPlaylist",
		probe: (operation) => ({ body: example(operation, "libraryRows") }),
	},
	{
		id: "renamePlaylist",
		probe: (operation) => ({
			pathParams: { id: kUnissuedPlaylistId },
			body: example(operation, "renamed"),
		}),
	},
	{
		id: "movePlaylist",
		probe: (operation) => ({
			pathParams: { id: kUnissuedPlaylistId },
			body: example(operation, "toTheTop"),
		}),
	},
	{
		id: "removePlaylist",
		probe: () => ({ pathParams: { id: kUnissuedPlaylistId } }),
	},
	{
		id: "copyPlaylistItems",
		probe: (operation) => ({
			pathParams: { id: kUnissuedPlaylistId },
			body: example(operation, "rows"),
		}),
	},
	{
		id: "removePlaylistItems",
		probe: (operation) => ({
			pathParams: { id: kUnissuedPlaylistId },
			body: example(operation, "runs"),
		}),
	},
	{
		id: "issueStreamTicket",
		probe: (_, context) => ({
			body: { deviceId: context.deviceId, name: "contract check" },
		}),
		learns: (body, context) => {
			context.ticket = (body as { ticket?: string }).ticket ?? null;
		},
	},
	{
		id: "openStream",
		probe: (_, context) =>
			context.ticket === null ? null : { query: { ticket: context.ticket } },
	},
	{ id: "getStreamListeners", probe: () => ({}) },
	{ id: "getStreamTimeline", probe: () => ({}) },
	{ id: "releaseOutputHold", probe: () => ({}) },
	{
		id: "leaveStream",
		probe: (_, context) => ({ body: { deviceId: context.deviceId } }),
	},
];
