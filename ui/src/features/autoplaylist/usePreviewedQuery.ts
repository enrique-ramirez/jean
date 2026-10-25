import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { type Library, useSetRows } from "@/domain/library/useLibrary";
import type { ListedRows } from "@/domain/track/project";
import { orThrow, retryWhenTooFast } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import { previewQuery, type QueryPreview } from "@/shared/api/playlists";
import { useDebounced } from "@/shared/hooks/useDebounced";

// Each preview runs the Media Library on foobar2000's main thread.
const PREVIEW_PAUSE_MS = 300;

const PREVIEW_KEPT_MS = 60_000;

interface MatchStats {
	tracks: number;
}

export type Previewed =
	| { kind: "idle" }
	| { kind: "pending"; isBusy: boolean }
	| { kind: "failed" }
	| { kind: "unreadable"; error: string }
	| { kind: "noLibrary" }
	| { kind: "empty" }
	| { kind: "matches"; view: ListedRows; stats: MatchStats };

const rowsOf = (answer: QueryPreview, structure: number) =>
	answer.valid &&
	answer.libraryEnabled &&
	answer.structure === structure &&
	answer.ordinals
		? answer.ordinals
		: null;

export function usePreviewedQuery({
	library,
	query,
}: {
	library: Library;
	query: string;
}): { state: Previewed; isStale: boolean } {
	const wanted = query.trim();
	const asked = useDebounced(wanted, PREVIEW_PAUSE_MS);
	const { origin, structure } = library;
	const isLibraryReady = library.status.kind === "ready";

	const {
		data: answer,
		isError,
		isFetching,
		isPlaceholderData,
		failureCount,
	} = useQuery({
		queryKey: ["fooJeanPreview", origin, asked, "rows", structure],
		queryFn: async () =>
			orThrow(
				await previewQuery(requireFooJean(origin), asked, { rows: true }),
			),
		enabled: Boolean(origin) && isLibraryReady && asked !== "",
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: PREVIEW_KEPT_MS,
		refetchOnWindowFocus: false,
		placeholderData: keepPreviousData,
		...retryWhenTooFast(),
	});

	const rows = answer ? rowsOf(answer, structure) : null;

	const ordinals = useMemo(() => (rows ? Int32Array.from(rows) : null), [rows]);
	const view = useSetRows(library, "preview", ordinals, { isBeside: true });
	const stats = useMemo<MatchStats | null>(
		() => (ordinals ? { tracks: ordinals.length } : null),
		[ordinals],
	);

	const isCurrent =
		answer !== undefined && !isPlaceholderData && asked === wanted;

	if (wanted === "") return { state: { kind: "idle" }, isStale: false };

	if (answer && ordinals && stats && view.length > 0)
		return {
			state: { kind: "matches", view, stats },
			isStale: !isCurrent,
		};

	if (answer && isCurrent) {
		if (!answer.valid)
			return {
				state: { kind: "unreadable", error: answer.error },
				isStale: false,
			};
		if (!answer.libraryEnabled)
			return { state: { kind: "noLibrary" }, isStale: false };
		if (rows) return { state: { kind: "empty" }, isStale: false };
	}

	if (isError && !isFetching)
		return { state: { kind: "failed" }, isStale: true };

	return {
		state: { kind: "pending", isBusy: failureCount > 0 },
		isStale: true,
	};
}
