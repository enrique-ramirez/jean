import { type SearchClient, searchClient } from "./searchClient";

let held: SearchClient | null | undefined;

// `node`, which runs the unit tests, has no `Worker`.
export function librarySearcher(): SearchClient | null {
	if (held === undefined) {
		held =
			typeof Worker === "undefined"
				? null
				: searchClient(
						new Worker(new URL("./searchWorker.ts", import.meta.url), {
							type: "module",
						}),
					);
	}
	return held;
}
