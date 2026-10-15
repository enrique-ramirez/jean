import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { gunzipSync, gzipSync } from "node:zlib";

import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import {
	albumRoute,
	artistRoute,
	genreRoute,
} from "../../src/domain/track/routes.ts";
import { decodeJlib } from "../../src/shared/api/jlib.ts";
import { MAX_LIBRARY_BYTES } from "../fake-api/fooJean/options.ts";
import { postControl } from "./fakePlayer.ts";
import { type Measured, summarise } from "./stats.ts";

interface Section {
	count: number;
	width: number;
}

interface WireColumn {
	name?: string;
	ids: Section;
	dict: { text: { length: number }; ends: Section };
}

export interface ColumnCost {
	column: string;
	bytes: number;
	share: number;
}

export interface ExportCost {
	plainBytes: number;
	gzippedBytes: number;
	// "server" when the answer arrived gzip-encoded, "local" when the server sent none and node
	// compressed the plain bytes.
	gzippedBy: "server" | "local";
	ceilingBytes: number;
	aboveCeiling: boolean;
	columns: ColumnCost[];
	// Header, framing and padding: what the columns above do not account for.
	otherBytes: number;
	// `decodeJlib` over the plain bytes, in node. The page decodes the same bytes with the same code.
	decodeMs: Measured;
	// The server's own time to answer, whole body included: the first request pays any build and
	// encode, the second is the cached export.
	answerMs: { first: number; second: number };
	// A delta of one play, asked for as soon as it exists. Null where the player has no control
	// routes to cause one.
	deltaAnswerMs: number | null;
}

const EXPORT_WAIT_MS = 600_000;
const RETRY_MS = 1000;

interface Answer {
	ms: number;
	status: number;
	encoding: string | undefined;
	body: Buffer;
}

function get(url: URL, acceptEncoding: string): Promise<Answer> {
	const request = url.protocol === "https:" ? httpsRequest : httpRequest;
	const began = performance.now();
	return new Promise((resolve, reject) => {
		const outgoing = request(
			url,
			{ headers: { "Accept-Encoding": acceptEncoding } },
			(incoming) => {
				const parts: Buffer[] = [];
				incoming.on("data", (part: Buffer) => parts.push(part));
				incoming.on("end", () =>
					resolve({
						ms: performance.now() - began,
						status: incoming.statusCode ?? 0,
						encoding: incoming.headers["content-encoding"],
						body: Buffer.concat(parts),
					}),
				);
				incoming.on("error", reject);
			},
		);
		outgoing.on("error", reject);
		outgoing.end();
	});
}

// A player answers 202 while it builds the declared set, and the same request is asked again.
async function exported(origin: string, acceptEncoding: string) {
	const url = new URL("/api/library/export", origin);
	for (const expression of TRACK_EXPRESSIONS)
		url.searchParams.append("columns", expression);

	const began = performance.now();
	for (;;) {
		const answer = await get(url, acceptEncoding);
		if (answer.status === 200) return { answer, ms: performance.now() - began };
		if (answer.status !== 202 && answer.status !== 429)
			throw new Error(`GET /api/library/export answered ${answer.status}`);
		if (performance.now() - began > EXPORT_WAIT_MS)
			throw new Error("the export was still not built after ten minutes");
		await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
	}
}

const toArrayBuffer = (bytes: Buffer) =>
	bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;

function columnsOf(plain: Buffer): { columns: ColumnCost[]; other: number } {
	const headerBytes = plain.readUInt32LE(4);
	const header = JSON.parse(plain.subarray(8, 8 + headerBytes).toString()) as {
		columns: WireColumn[];
		spine: Record<string, WireColumn>;
	};

	const costOf = (column: WireColumn) =>
		column.ids.count * column.ids.width +
		column.dict.text.length +
		column.dict.ends.count * column.dict.ends.width;

	const columns = [
		...header.columns.map((column) => ({
			column: column.name ?? "",
			bytes: costOf(column),
		})),
		...Object.entries(header.spine).map(([name, column]) => ({
			column: `spine.${name}`,
			bytes: costOf(column),
		})),
	].map((entry) => ({ ...entry, share: entry.bytes / plain.byteLength }));

	const counted = columns.reduce((sum, entry) => sum + entry.bytes, 0);
	return { columns, other: plain.byteLength - counted };
}

export interface Pages {
	trackCount: number;
	revision: number;
	album: string;
	artist: string;
	genre: string;
}

// An album, an artist and a genre that the middle of the library holds, as the hashes that open them.
function pagesOf(buffer: ArrayBuffer): Pages {
	const library = decodeJlib(buffer);
	if (library.kind !== "snapshot")
		throw new Error("the export is not a snapshot");
	const middle = library.trackCount >> 1;
	const at = (field: keyof typeof FIELD) =>
		library.columns.get(TRACK_EXPRESSIONS[FIELD[field]])?.at(middle) ?? "";
	const artist = at("albumArtist") || at("artist");
	return {
		trackCount: library.trackCount,
		revision: library.revision,
		album: `#/${albumRoute(artist, at("album"))}`,
		artist: `#/${artistRoute(artist)}`,
		genre: `#/${genreRoute(at("genre"))}`,
	};
}

const round = (ms: number) => Math.round(ms * 100) / 100;

async function deltaAnswerMs(origin: string, since: number) {
	const played = await postControl(origin, "play", { ordinal: 0 });
	if (!played.ok) return null;
	const answer = await get(
		new URL(`/api/library/changes?since=${since}`, origin),
		"gzip",
	);
	return answer.status === 200 ? round(answer.ms) : null;
}

export async function measureExport(
	origin: string,
	repeats: number,
): Promise<{ cost: ExportCost; pages: Pages }> {
	const identity = await exported(origin, "identity");
	const plain =
		identity.answer.encoding === "gzip"
			? gunzipSync(identity.answer.body)
			: identity.answer.body;

	const compressed = await exported(origin, "gzip");
	const server = compressed.answer.encoding === "gzip";
	const gzippedBytes = server
		? compressed.answer.body.byteLength
		: gzipSync(plain).byteLength;

	const buffer = toArrayBuffer(plain);
	const decodes: number[] = [];
	for (let run = 0; run < repeats; run += 1) {
		const began = performance.now();
		decodeJlib(buffer);
		decodes.push(performance.now() - began);
	}

	const { columns, other } = columnsOf(plain);
	const cost: ExportCost = {
		plainBytes: plain.byteLength,
		gzippedBytes,
		gzippedBy: server ? "server" : "local",
		ceilingBytes: MAX_LIBRARY_BYTES,
		aboveCeiling: plain.byteLength > MAX_LIBRARY_BYTES,
		columns,
		otherBytes: other,
		decodeMs: summarise(decodes),
		answerMs: { first: round(identity.ms), second: round(compressed.ms) },
		deltaAnswerMs: null,
	};
	const pages = pagesOf(buffer);
	cost.deltaAnswerMs = await deltaAnswerMs(origin, pages.revision);
	return { cost, pages };
}
