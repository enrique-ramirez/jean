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
