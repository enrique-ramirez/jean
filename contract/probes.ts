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
		// The snapshot is binary and the suite holds no library-relative path out of it, so
		// this drives the refusal instead. That is the answer worth pinning anyway: an
		// address the snapshot does not carry MUST be a 404 in the published shape and never
		// somebody else's sleeve.
		id: "getArtwork",
		probe: (_, context) => ({
			query: { track: `contract check ${context.run}/no such track.flac` },
		}),
	},
	{ id: "getPlayingArtwork", probe: () => ({}) },
	{
		id: "writeTags",
		probe: (operation) => ({ body: example(operation, "setRating") }),
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
	{
		id: "pair",
		probe: (operation) => ({ body: example(operation, "anonymous") }),
	},
];
