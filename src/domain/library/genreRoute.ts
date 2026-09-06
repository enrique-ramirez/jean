const GENRE_PREFIX = "genre/";

export const GENRES_ROUTE = "genres";
export const GENRES_HREF = `#/${GENRES_ROUTE}`;

export const genreRoute = (name: string) =>
	`${GENRE_PREFIX}${encodeURIComponent(name)}`;

export const genreHref = (name: string) => `#/${genreRoute(name)}`;

export const genreOfRoute = (route: string): string | null => {
	if (!route.startsWith(GENRE_PREFIX)) return null;
	try {
		return decodeURIComponent(route.slice(GENRE_PREFIX.length)) || null;
	} catch {
		return null;
	}
};
