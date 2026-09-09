const SEARCH_PREFIX = "search/";

export const SEARCH_ROUTE = "search";

export const searchRoute = (query: string) =>
	query.trim() ? `${SEARCH_PREFIX}${encodeURIComponent(query)}` : SEARCH_ROUTE;

export const searchHref = (query: string) => `#/${searchRoute(query)}`;

/**
 * Percent-encoded, so a query with a `/` in it survives, and decoded inside a `try`: a hand-edited
 * hash with a stray `%` throws rather than returning anything.
 */
export const queryOfRoute = (route: string): string | null => {
	if (!route.startsWith(SEARCH_PREFIX)) return null;
	try {
		return decodeURIComponent(route.slice(SEARCH_PREFIX.length)) || null;
	} catch {
		return null;
	}
};

export const isSearchRoute = (route: string) =>
	route === SEARCH_ROUTE || route.startsWith(SEARCH_PREFIX);
