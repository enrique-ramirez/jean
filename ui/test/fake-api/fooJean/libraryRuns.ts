import { CHUNK } from "../yielding.ts";
import {
	draftAlbumsSweep,
	firstTrackOf,
	fixedOffset,
	type LibraryRoleName,
	readValue,
	tagKey,
} from "./librarySummary.ts";
import type { FakeState } from "./request.ts";

export const RUN_ROLES = [
	"album",
	"albumArtist",
	"artist",
	"discNumber",
	"trackNumber",
] as const satisfies readonly LibraryRoleName[];

export interface RunsInput {
	count: number;
	columns: Parameters<typeof draftAlbumsSweep>[0];
}

// Absent roles key as empty text, which no declared expression is, so each role keeps its place.
export const runColumnsKey = (
	{ libraryFeed: { structure, edits } }: FakeState,
	roles: Map<string, string>,
) =>
	[structure, edits, ...RUN_ROLES.map((role) => roles.get(role) ?? "")].join(
		"\u0000",
	);

export function* albumCoversSweep(
	columns: RunsInput["columns"],
	count: number,
) {
	const { drafts, draftAt } = yield* draftAlbumsSweep(
		columns,
		count,
		fixedOffset(0),
		false,
	);
	const covers: number[] = [];
	for (const draft of drafts) {
		covers.push(firstTrackOf(columns, draft.ordinals));
		if (covers.length % CHUNK === 0) yield;
	}
	return { covers, draftAt };
}

export function* runsSweep(
	{ count, columns }: RunsInput,
	grouped?: { covers: number[]; draftAt: number[] },
) {
	const { covers, draftAt } =
		grouped ?? (yield* albumCoversSweep(columns, count));

	const keyOf = (at: number) => {
		if (draftAt[at] >= 0) return `a${draftAt[at]}`;
		const credit =
			readValue(columns.albumArtist?.[at]) ?? readValue(columns.artist?.[at]);
		return `u${tagKey(credit)}`;
	};

	const lengths: number[] = [];
	const coverOfRun: number[] = [];
	const untagged: number[] = [];
	let current: string | null = null;
	for (let at = 0; at < count; at += 1) {
		if (at % CHUNK === CHUNK - 1) yield;
		const key = keyOf(at);
		if (key === current) {
			lengths[lengths.length - 1] += 1;
			continue;
		}
		current = key;
		if (draftAt[at] < 0) untagged.push(lengths.length);
		lengths.push(1);
		coverOfRun.push(draftAt[at] >= 0 ? covers[draftAt[at]] : at);
	}
	return { lengths, covers: coverOfRun, untagged, draftAt };
}
