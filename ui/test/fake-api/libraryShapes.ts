import { allTracks, type Track } from "./capturedLibrary.ts";

export function generateTracks(count: number): Track[] {
	const source = allTracks();
	const tracks: Track[] = new Array(count);
	for (let index = 0; index < count; index += 1) {
		const template = source[index % source.length];
		tracks[index] = {
			...template,
			"%title%": `${template["%title%"]} (${index + 1})`,
			"%tracknumber%": String((index % 99) + 1).padStart(2, "0"),
			"%path%": `${template["%path%"]}#${index}`,
		};
	}
	return tracks;
}

export function libraryOfShape({
	tracks = 12,
	albums = 1,
	artists = 1,
	genres = 1,
	seconds = 240,
	years = [2000, 2000],
	omit = [],
	// The same artist written two ways, differing in case and in spacing, as
	// collections look once more than one tool has touched them.
	mixedCase = false,
	// A cue sheet or a disc image: this many tracks inside one file, sharing a
	// `%path%` and told apart by `%subsong%` alone. foobar2000 numbers them from 1.
	subsongsPerFile = 1,
}: {
	tracks?: number;
	albums?: number;
	artists?: number;
	genres?: number;
	seconds?: number;
	years?: [number, number];
	omit?: string[];
	mixedCase?: boolean;
	subsongsPerFile?: number;
} = {}): Track[] {
	const template = allTracks()[0];
	const [first, last] = years;
	const built: Track[] = new Array(tracks);

	for (let index = 0; index < tracks; index += 1) {
		const album = index % albums;
		const artist = album % artists;
		const year =
			albums > 1
				? first + Math.round((album * (last - first)) / (albums - 1))
				: first;

		const named = `Artist ${artist + 1}`;
		const spelling =
			mixedCase && index % 2 === 1
				? named.toUpperCase().replace(" ", "  ")
				: named;

		const track: Track = {
			...template,
			"%title%": `Track ${index + 1}`,
			"%tracknumber%": String((index % 99) + 1).padStart(2, "0"),
			"%album%": `Album ${album + 1}`,
			"%artist%": spelling,
			"%album artist%": spelling,
			"%genre%": `Genre ${(index % genres) + 1}`,
			"%year%": String(year),
			"%length_seconds%": String(seconds),
			"%path%": `C:\\Music\\S\\Artist ${artist + 1}\\Album ${album + 1}\\${Math.floor(index / subsongsPerFile) + 1}.mp3`,
		};

		if (subsongsPerFile > 1)
			track["%subsong%"] = String((index % subsongsPerFile) + 1);

		for (const field of omit) delete track[field];
		built[index] = track;
	}

	return built;
}
