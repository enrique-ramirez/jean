import type { Steps } from "@/shared/lib/idle";
import type { LibraryColumns } from "./libraryColumns";

type Work = (columns: LibraryColumns, key: string) => Steps<unknown>;

const works = new Set<Work>();

export const buildBeforeLanding = (work: Work) => {
	works.add(work);
};

export function* landingWorkSteps(
	columns: LibraryColumns,
	key: string,
): Steps<void> {
	for (const work of works) yield* work(columns, key);
}
