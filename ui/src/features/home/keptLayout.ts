import { useEffect } from "react";
import type { LibrarySummary } from "@/shared/api/librarySummary";
import { useStoredState } from "@/shared/hooks/useStoredState";

export interface KeptLayout {
	shelves: string[];
	band: boolean;
}

const LAYOUT_KEY = "jean.homeLayout";

const FIRST_VISIT_LAYOUT: KeptLayout = {
	shelves: ["added", "recent", "top"],
	band: true,
};

const isKeptLayout = (stored: unknown): stored is KeptLayout =>
	typeof stored === "object" &&
	stored !== null &&
	"band" in stored &&
	typeof stored.band === "boolean" &&
	"shelves" in stored &&
	Array.isArray(stored.shelves) &&
	stored.shelves.every((id) => typeof id === "string");

export const hasBandOf = (summary: LibrarySummary) =>
	summary.topTracks.length > 0 || summary.topGenres.length > 0;

const sameLayout = (a: KeptLayout, b: KeptLayout) =>
	a.band === b.band &&
	a.shelves.length === b.shelves.length &&
	a.shelves.every((id, at) => id === b.shelves[at]);

export function useKeptLayout(summary: LibrarySummary | null) {
	const [kept, keep] = useStoredState(
		LAYOUT_KEY,
		FIRST_VISIT_LAYOUT,
		isKeptLayout,
	);

	useEffect(() => {
		if (!summary) return;
		const drawn = {
			shelves: summary.shelves.map((shelf) => shelf.id),
			band: hasBandOf(summary),
		};
		if (!sameLayout(kept, drawn)) keep(drawn);
	}, [summary, kept, keep]);

	return kept;
}
