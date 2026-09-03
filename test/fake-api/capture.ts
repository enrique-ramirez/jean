// Pulls fixture data off a real player. Everything it writes is committed, so
// the tests themselves never touch a real player.
//
// With no arguments it writes the test fixture, five albums chosen for the
// branches the UI has:
//
//   node test/fake-api/capture.ts --url http://player.local:8880
//
// Given a list and somewhere to put it, it writes the demo's larger library
// instead:
//
//   node test/fake-api/capture.ts --albums demo/albums.ts --out demo

import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
	PlayerState,
	PlaylistInfo,
	PlaylistItemsResponse,
} from "../../src/shared/api/types.ts";

interface CapturedTrack {
	index: number;
	fields: Record<string, string>;
}

const HERE = dirname(fileURLToPath(import.meta.url));

// Wider than TRACK_EXPRESSIONS: a fixture is expensive to recapture and cheap to
// store.
const EXPRESSIONS = [
	"%tracknumber%",
	"%title%",
	"%artist%",
	"%album%",
	"%album artist%",
	"%length_seconds%",
	"%lastfm_play_count%",
	"%lastfm_last_played%",
	"%rating%",
	"%year%",
	"%genre%",
	"%codec%",
	"%bitrate%",
	"%path%",
	"%length%",
	"%discnumber%",
	"%filesize%",
	"%last_modified%",
	"%samplerate%",
	"%channels%",
	"$len($meta(unsynced lyrics))",
];

// The fixture albums cover the branches the UI has rather than a representative
// library:
//
//   Jessico            accented artist, for fold(); hot throughout
//   Deja Entendu       the heat range -- one 0-play track among 180-play ones
//   Jar Of Flies       FLAC rather than MP3, and short
//   Lafcadio           never played at all: no heat, no patina, no last-played
//   Deathconsciousness two discs, so %tracknumber% restarts mid-album
interface Wanted {
	albumArtist: string;
	album: string;
	slug?: string;
	// Capture the lyric text as well as the length probe in EXPRESSIONS. Opt-in
	// per album, in a second pass, so the fixture carries no lyrics of its own --
	// its specs supply them with `retagged`.
	lyrics?: true;
}

// `$len(...)` of this tag is in EXPRESSIONS for capability detection; this is
// the words.
const LYRIC = "$meta(unsynced lyrics)";

const FIXTURE_ALBUMS: Wanted[] = [
	{ albumArtist: "Babasónicos", album: "Jessico", slug: "jessico" },
	{ albumArtist: "Brand New", album: "Deja Entendu", slug: "deja-entendu" },
	{
		albumArtist: "Alice in Chains",
		album: "Jar Of Flies",
		slug: "jar-of-flies",
	},
	{ albumArtist: "As Tall as Lions", album: "Lafcadio", slug: "lafcadio" },
	{
		albumArtist: "Have a Nice Life",
		album: "Deathconsciousness",
		slug: "deathconsciousness",
	},
];

const args = new Map(
	process.argv.slice(2).map((arg, index, all) => [arg, all[index + 1]]),
);
const base =
	args.get("--url") ?? process.env.BEEFWEB_URL ?? "http://localhost:8880";

// Where library.json and artwork/ land. Defaults to beside this file.
const out = args.has("--out") ? resolve(args.get("--out") as string) : null;

// A module exporting `ALBUMS`, so the list can carry comments a JSON file could
// not.
const listed = args.get("--albums");

// The covers a real player serves are as large as whatever is embedded in the
// file, which for 150 albums is tens of megabytes of repository. `sips` is
// macOS-only, so a machine without it gets full-size covers and is told so.
const COVER_PIXELS = 400;
const sips = spawnSync("sips", ["--help"]).status === 0;

const shrink = (file: string) => {
	if (!sips) return false;
	spawnSync("sips", ["-Z", String(COVER_PIXELS), file], { stdio: "ignore" });
	return true;
};

// Both halves of the name matter: `MTV Unplugged` is Korn's and Nirvana's, and a
// slug taken from the album alone would overwrite the other's cover.
const slugOf = (wanted: Wanted, taken: Set<string>) => {
	if (wanted.slug) return wanted.slug;
	const kebab = (text: string) =>
		text
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");
	const base = `${kebab(wanted.albumArtist)}-${kebab(wanted.album)}`.slice(
		0,
		60,
	);
	let slug = base;
	for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
	taken.add(slug);
	return slug;
};

async function albumsToCapture(): Promise<Wanted[]> {
	if (!listed) return FIXTURE_ALBUMS;
	const module = (await import(pathToFileURL(resolve(listed)).href)) as {
		ALBUMS?: Wanted[];
	};
	if (!module.ALBUMS?.length)
		throw new Error(`${listed} exports no ALBUMS array`);
	return module.ALBUMS;
}

const get = async (path: string) => {
	const response = await fetch(new URL(path, base));
	if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
	return response;
};

const columns = encodeURIComponent(EXPRESSIONS.join(","));

async function findLibrary() {
	const { playlists } = (await (await get("/api/playlists")).json()) as {
		playlists: PlaylistInfo[];
	};
	// The biggest playlist is the library on any install that has one.
	const library = [...playlists].sort((a, b) => b.itemCount - a.itemCount)[0];
	if (!library) throw new Error("no playlists on this player");
	return library;
}

const dir = out ?? HERE;

async function main() {
	const library = await findLibrary();
	const info = (await (await get("/api/player")).json()) as {
		player: PlayerState;
	};
	console.log(
		`capturing from ${info.player.info.title} ${info.player.info.version}, playlist ${library.title} (${library.itemCount})`,
	);

	const { playlistItems } = (await (
		await get(
			`/api/playlists/${library.id}/items/0:${library.itemCount}?columns=${columns}`,
		)
	).json()) as { playlistItems: PlaylistItemsResponse };

	// Keyed by expression, not the positional arrays the API returns, so the fake
	// can answer whatever column set the app asks for. It also preserves what
	// capability detection rests on: an expression absent from the object
	// resolves to '?', exactly as an unsupported field does on a real player.
	const toTrack = (
		item: { columns: string[] },
		index: number,
	): CapturedTrack => ({
		index,
		fields: Object.fromEntries(
			EXPRESSIONS.map((expression, at) => [expression, item.columns[at]]),
		),
	});

	const all = playlistItems.items.map(toTrack);

	// Second pass, one column wide, and only when an album asked for lyrics.
	const wanted = await albumsToCapture();
	const lyrics = new Map<number, string>();
	if (wanted.some((album) => album.lyrics)) {
		const { playlistItems: withLyrics } = (await (
			await get(
				`/api/playlists/${library.id}/items/0:${library.itemCount}?columns=${encodeURIComponent(LYRIC)}`,
			)
		).json()) as { playlistItems: PlaylistItemsResponse };
		withLyrics.items.forEach((item, index) => {
			const text = item.columns[0];
			// `?` is a player that cannot resolve the field; '' is a file with
			// nothing in it. Neither is a lyric.
			if (text && text !== "?") lyrics.set(index, text);
		});
	}

	const taken = new Set<string>();
	const albums: unknown[] = [];
	const absent: string[] = [];

	for (const want of wanted) {
		const tracks = all.filter(
			(track) =>
				track.fields["%album artist%"] === want.albumArtist &&
				track.fields["%album%"] === want.album,
		);
		// The fixture's five must be there -- a spec depends on each. A supplied
		// list is one typo away from a missing album, so those are collected and
		// reported at the end rather than losing the whole capture.
		if (tracks.length === 0) {
			const line = `${want.albumArtist} -- ${want.album}`;
			if (!listed) throw new Error(`not found: ${line}`);
			absent.push(line);
			continue;
		}

		const slug = slugOf(want, taken);
		const artwork = await captureArtwork(library.id, tracks[0].index, slug);

		let lyricsOn = 0;
		const fields = tracks.map((track) => {
			if (!want.lyrics) return track.fields;
			const text = lyrics.get(track.index);
			if (!text) return track.fields;
			lyricsOn += 1;
			return { ...track.fields, [LYRIC]: text };
		});

		albums.push({
			albumArtist: want.albumArtist,
			album: want.album,
			slug,
			artwork,
			tracks: fields,
		});
		console.log(
			`  ${want.albumArtist} -- ${want.album}: ${tracks.length} tracks${artwork ? ", cover" : ", no cover"}${lyricsOn ? `, ${lyricsOn} lyrics` : ""}`,
		);
	}

	if (absent.length > 0)
		console.log(
			`\n${absent.length} not found, and skipped:\n  ${absent.join("\n  ")}\n`,
		);
	if (!sips)
		console.log(
			"no `sips` on this machine, so the covers are whatever size the files hold.",
		);

	await writeFile(
		join(dir, "library.json"),
		`${JSON.stringify({ capturedFrom: `${info.player.info.title} ${info.player.info.version} / beefweb ${info.player.info.pluginVersion}`, expressions: EXPRESSIONS, albums }, null, 2)}\n`,
	);

	// The player state, so the fake's idle state is a real one rather than a guess
	// at which fields beefweb sends. It belongs to the fake rather than to a
	// library, so a demo capture leaves it alone.
	if (!listed) {
		const { player } = (await (
			await get(
				`/api/query?player=true&trcolumns=${encodeURIComponent("%artist%,%title%")}`,
			)
		).json()) as { player: PlayerState };
		await writeFile(
			join(dir, "player.json"),
			`${JSON.stringify(player, null, 2)}\n`,
		);
	}

	console.log(
		`wrote ${join(dir, "library.json")}${listed ? "" : ", player.json"}`,
	);
}

async function captureArtwork(playlistId: string, index: number, slug: string) {
	const response = await fetch(
		new URL(`/api/artwork/${playlistId}/${index}`, base),
	);
	if (!response.ok) return null;
	const name = `${slug}.jpg`;
	const file = join(dir, "artwork", name);
	await mkdir(join(dir, "artwork"), { recursive: true });
	await writeFile(file, Buffer.from(await response.arrayBuffer()));
	shrink(file);
	return name;
}

await main();
