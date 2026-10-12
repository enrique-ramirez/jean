import { useEffect, useRef } from "react";

import type { LibrarySearch } from "@/domain/library/useLibrarySearch";

export function useSearchFollowsRoute(
	search: LibrarySearch,
	isSearch: boolean,
	searchQuery: string | null,
) {
	const restoredSearch = useRef(false);
	const {
		hasQuery,
		query: committedQuery,
		commit: commitSearch,
		remembered: rememberedQuery,
		restore: restoreSearch,
	} = search;

	useEffect(() => {
		if (!searchQuery || searchQuery === committedQuery) return;
		commitSearch(searchQuery);
	}, [searchQuery, committedQuery, commitSearch]);

	useEffect(() => {
		if (
			restoredSearch.current ||
			!isSearch ||
			hasQuery ||
			searchQuery ||
			!rememberedQuery
		)
			return;
		restoredSearch.current = true;
		restoreSearch();
	}, [isSearch, hasQuery, searchQuery, rememberedQuery, restoreSearch]);
}
