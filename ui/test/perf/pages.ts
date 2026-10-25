import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import {
	albumRoute,
	artistRoute,
	genreRoute,
} from "../../src/domain/track/routes.ts";
import { decodeRows } from "../../src/shared/api/jlib.ts";

export interface Pages {
	trackCount: number;
	album: string;
	artist: string;
	genre: string;
}

interface LibraryState {
	ready: boolean;
	structure: number;
	columns: string[];
	trackCount: number;
}

const WAIT_MS = 600_000;
const RETRY_MS = 1000;

const sameMembers = (held: string[], asked: readonly string[]) =>
	held.length === asked.length && asked.every((one) => held.includes(one));

// The middle track of the library, read through the rows route a client declares with, names the
// album, artist and genre pages the cells open. A player answers 202 while it builds the declared
// set, and the same request is asked again.
export async function readPages(origin: string): Promise<Pages> {
	const began = performance.now();
	for (;;) {
		const { library } = (await (await fetch(`${origin}/api/state`)).json()) as {
			library: LibraryState;
		};
		const built =
			library.ready && sameMembers(library.columns, TRACK_EXPRESSIONS);
		const answer = await fetch(`${origin}/api/library/rows`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				columns: TRACK_EXPRESSIONS,
				structure: String(library.structure),
				ordinals: [built ? library.trackCount >> 1 : 0],
			}),
		});

		if (answer.status === 200 && built) {
			const rows = decodeRows(await answer.arrayBuffer());
			const at = (field: keyof typeof FIELD) =>
				rows.columns.get(TRACK_EXPRESSIONS[FIELD[field]])?.at(0) ?? "";
			const artist = at("albumArtist") || at("artist");
			return {
				trackCount: rows.trackCount,
				album: `#/${albumRoute(artist, at("album"))}`,
				artist: `#/${artistRoute(artist)}`,
				genre: `#/${genreRoute(at("genre"))}`,
			};
		}
		await answer.arrayBuffer();

		if (![200, 202, 409, 429].includes(answer.status))
			throw new Error(`POST /api/library/rows answered ${answer.status}`);
		if (performance.now() - began > WAIT_MS)
			throw new Error("the library was still not built after ten minutes");
		await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
	}
}
