import { type SearchClient, searchClient } from "./searchClient";

let held: SearchClient | null | undefined;

// The one worker that holds the library for search. `node`, which runs the unit tests, has no
// `Worker`, so there it is absent and nothing is handed over.
export function librarySearcher(): SearchClient | null {
	if (held === undefined) {
		const spawn = () =>
			new Worker(new URL("./searchWorker.ts", import.meta.url), {
				type: "module",
			});
		held = typeof Worker === "undefined" ? null : searchClient(spawn(), spawn);
	}
	return held;
}
