import { libraryOfShape } from "./libraryShapes.ts";
import { createServer } from "./server.ts";
import { createState } from "./state.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string | null) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : fallback;
};

const port = Number(flag("--port", "8881"));
const serveDir = flag("--serve", null);
const tracks = flag("--tracks", null);
const noCeiling = args.includes("--no-ceiling");

const TRACKS_PER_ALBUM = 10;
const ALBUMS_PER_ARTIST = 10;
const GENRES = 40;
const YEARS: [number, number] = [1960, 2024];

const largeLibrary = (count: number) =>
	libraryOfShape({
		tracks: count,
		albums: Math.max(1, Math.ceil(count / TRACKS_PER_ALBUM)),
		artists: Math.max(
			1,
			Math.ceil(count / (TRACKS_PER_ALBUM * ALBUMS_PER_ARTIST)),
		),
		genres: GENRES,
		years: YEARS,
	});

// `createState()`'s own default holds no component, since that is what the suite's worker
// fixture resets away before any spec sees it. Standalone, nothing resets it, so this is the
// one caller that has to ask for a component that is there.
const server = createServer({
	serveDir,
	state: createState({
		fooJean: noCeiling ? { libraryCeiling: null } : {},
		...(tracks === null
			? null
			: { mediaLibrary: largeLibrary(Number(tracks)) }),
	}),
});

server.listen(port, () => {
	console.log(
		`fake foo_jean on http://localhost:${port}${serveDir ? ` (serving ${serveDir})` : ""}`,
	);
});
