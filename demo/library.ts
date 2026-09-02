import { allTracks, type Track } from "../test/fake-api/state.ts";

// The library the demo browses: the five captured albums, plus enough
// synthesised ones to make the app behave the way it does in front of a real
// collection. Both halves matter. The capture is what keeps the covers, the
// accents and the play counts honest -- it is bytes a real foobar2000 produced
// -- and the filler is what makes the shelves scroll, the search have more than
// one answer, and the virtualiser hold a screenful rather than the whole list.
//
// Everything here is derived from a seed, so every visitor gets the same
// library and a reload rebuilds it exactly. The demo replays what somebody did
// on top of it (see `journal.ts`), which only works if what they did it to is
// the same library each time.

const SEED = 0x1e_a2_10_c3;

// mulberry32: small, fast, and the same sequence in every engine, which is the
// only property being asked of it.
const random = (seed: number) => {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d_2b_79_f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
};

// Invented, and meant to read as invented: a demo library that borrowed real
// bands would be claiming to hold music it does not have. Assembled rather than
// listed so a few dozen words cover a couple of hundred records.
const FIRST = [
	"Paper",
	"Neon",
	"Ivory",
	"Slow",
	"Winter",
	"Radio",
	"Velvet",
	"Hollow",
	"Gold",
	"Quiet",
	"Marble",
	"Amber",
	"Coastal",
	"Iron",
	"Lunar",
	"Static",
	"Sable",
	"Northern",
	"Glass",
	"Wilder",
	"Halcyon",
	"Salt",
	"Copper",
	"Vast",
];
const SECOND = [
	"Harbour",
	"Machines",
	"Foxes",
	"Cinema",
	"Cathedral",
	"Arcade",
	"Divers",
	"Lantern",
	"Orchard",
	"Signals",
	"Parade",
	"Kingdom",
	"Weather",
	"Atlas",
	"Choir",
	"Motel",
	"Mountain",
	"Anthem",
	"Circuit",
	"Garden",
];
const TITLES = [
	"Small Hours",
	"The Long Way Round",
	"Everything Louder",
	"Blue Hour",
	"Nothing Rhymes with Orange",
	"Held Together",
	"Low Ceilings",
	"Tape Hiss",
	"A Better Map",
	"Weather for Ducks",
	"Second Language",
	"Sleeping Cities",
	"Not for Nothing",
	"The Quiet Part",
	"Rooms We Left",
	"Half Measures",
	"Signal to Noise",
	"Come Back Later",
	"Paper Weather",
	"Tall Grass",
	"Under the Overpass",
	"Distance in Miles",
	"Loose Threads",
	"First Light",
];
const WORDS = [
	"Anywhere",
	"Ceiling",
	"Radio",
	"Autumn",
	"Static",
	"Harbour",
	"Telephone",
	"Cassette",
	"Boulevard",
	"Foxglove",
	"Overture",
	"Marigold",
	"Streetlight",
	"Undertow",
	"Lighthouse",
	"Paperback",
	"Saltwater",
	"Firelight",
	"Nightshift",
	"Clockwork",
	"Driftwood",
	"Moonlight",
	"Sundial",
	"Wintering",
];
const GENRES = [
	"Indie Rock",
	"Post-Punk",
	"Shoegaze",
	"Ambient",
	"Folk",
	"Electronic",
	"Jazz",
	"Dream Pop",
	"Post-Rock",
	"Alternative",
	"Soul",
	"Rock En Español",
];

const ALBUMS = 214;
const TRACKS_PER_ALBUM = [6, 13] as const;

const pad = (value: number) => String(value).padStart(2, "0");
const clock = (seconds: number) =>
	`${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;

// A play count worth drawing. A flat distribution makes the heat shading and
// the top-tracks shelf meaningless -- everything is equally warm, which is the
// one thing no real library is. So most tracks are cold, a few are played to
// death, and the shape in between is what the front door is a picture of.
const playCount = (roll: number) => {
	if (roll < 0.34) return 0;
	if (roll < 0.78) return Math.round(roll * 24);
	if (roll < 0.97) return Math.round(roll * 140);
	return Math.round(roll * 480);
};

// Heavily played tracks were played recently, which is the correlation that
// makes a listening history look like one rather than like noise. Squaring the
// roll pulls the whole set towards the recent end; the play count pulls the
// well-worn ones further.
const DAY = 24 * 60 * 60 * 1000;

const lastPlayed = (roll: number, plays: number) => {
	const reach = plays > 90 ? 45 : plays > 20 ? 240 : 700;
	const at = new Date(Date.now() - roll * roll * reach * DAY);
	return (
		`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
		`${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
	);
};

let cached: Track[] | null = null;

export function demoLibrary(): Track[] {
	if (cached) return cached;

	const next = random(SEED);
	const template = allTracks()[0];
	const tracks: Track[] = [...allTracks()];

	for (let album = 0; album < ALBUMS; album += 1) {
		const artist = `${FIRST[Math.floor(next() * FIRST.length)]} ${
			SECOND[Math.floor(next() * SECOND.length)]
		}`;
		const title =
			next() < 0.55
				? TITLES[Math.floor(next() * TITLES.length)]
				: `${WORDS[Math.floor(next() * WORDS.length)]} ${
						WORDS[Math.floor(next() * WORDS.length)]
					}`;
		const year = 1993 + Math.floor(next() * 33);
		const genre = GENRES[Math.floor(next() * GENRES.length)];
		const flac = next() < 0.22;
		const count =
			TRACKS_PER_ALBUM[0] +
			Math.floor(next() * (TRACKS_PER_ALBUM[1] - TRACKS_PER_ALBUM[0] + 1));

		// One album, one set of titles: a record with the same song on it twice is
		// a mistake nobody's tagger makes, and it is the first thing the eye finds
		// in a list.
		const used = new Set<string>();

		for (let number = 1; number <= count; number += 1) {
			const seconds = 96 + Math.floor(next() * 340);
			const plays = playCount(next());
			const letter = artist[0].toUpperCase();
			let name = "";
			do {
				const first = WORDS[Math.floor(next() * WORDS.length)];
				const second = WORDS[Math.floor(next() * WORDS.length)];
				name = next() < 0.4 && second !== first ? `${first} ${second}` : first;
			} while (used.has(name));
			used.add(name);

			const track: Track = {
				...template,
				"%tracknumber%": pad(number),
				"%title%": name,
				"%artist%": artist,
				"%album artist%": artist,
				"%album%": `${title}${album % 37 === 0 ? " (Deluxe)" : ""}`,
				"%year%": String(year),
				"%genre%": genre,
				"%length_seconds%": String(seconds),
				"%length%": clock(seconds),
				"%lastfm_play_count%": String(plays),
				"%codec%": flac ? "FLAC" : "MP3",
				"%bitrate%": flac ? "1006" : next() < 0.5 ? "320" : "256",
				"%samplerate%": "44100",
				"%filesize%": String(seconds * (flac ? 125_000 : 40_000)),
				// Exists and is empty, rather than missing. A missing field is a
				// player that cannot resolve it at all, which is a different state and
				// the one the whole capability detection rests on -- so the filler
				// must not accidentally claim this install has no lyrics component.
				"$len($meta(unsynced lyrics))": next() < 0.28 ? "1140" : "0",
				"%path%": `F:\\Musica\\${letter}\\${artist}\\(${year}) ${title}\\${pad(
					number,
				)}. ${name}.mp3`,
			};

			// Played at all, and only then dated -- a last-played on a track with no
			// plays is the kind of contradiction a real library never has. Dated
			// backwards from today rather than from a year written into the source,
			// because half of what the home screen draws is *recency*: a fixture
			// stamped 2024 makes "recently played" mean "two years ago" the moment
			// the demo is a year old, and the shelf goes quietly wrong rather than
			// empty.
			if (plays === 0) delete track["%lastfm_last_played%"];
			else track["%lastfm_last_played%"] = lastPlayed(next(), plays);

			// Sparse, and *rated at all*. `%rating%` answering `?` is a player that
			// cannot resolve the field, which is what the capture holds and what
			// renders a row's stars read-only -- correct there, and the wrong thing
			// to fill a demo with. So the synthesised half is an install where the
			// tag exists: mostly unrated, a few rated. **Measured** on a real
			// library, `%rating%` answers on 500 of 30,441 tracks, which is why this
			// is 2% rather than a screenful of stars.
			track["%rating%"] =
				next() < 0.02 ? String(3 + Math.floor(next() * 3)) : "0";

			tracks.push(track);
		}
	}

	cached = tracks;
	return tracks;
}

// What `createState`'s `artworkOf` asks for: the captured albums answer with
// their own file before this is reached, so everything arriving here is
// synthesised and gets a cover drawn for it. Keyed by album rather than by
// track, so the twelve rows of one record share a URL and therefore a cache
// entry -- which is the same reason `albumCoverRows` exists in the app.
export const coverOf = (track: Track) =>
	track["%album%"] ? `album:${track["%album%"]}` : null;
