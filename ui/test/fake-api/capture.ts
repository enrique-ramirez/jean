import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";
import { JEAN_MODE_BY_ORDER } from "./fooJean.ts";
import type { FakePlayerState } from "./state.ts";

type Schema = components["schemas"];

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
	args.get("--url") ?? process.env.CAPTURE_URL ?? "http://localhost:8881";

const out = args.has("--out") ? resolve(args.get("--out") as string) : null;

const listed = args.get("--albums");

const COVER_PIXELS = 400;
const sips = spawnSync("sips", ["--help"]).status === 0;

const shrink = (file: string) => {
	if (!sips) return false;
	spawnSync("sips", ["-Z", String(COVER_PIXELS), file], { stdio: "ignore" });
	return true;
};

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

const getJson = async <T>(path: string) =>
	(await (await get(path)).json()) as T;

const rowsOf = async (
	playlist: Schema["PlaylistAnnotation"],
	columns: string[],
) => {
	const declared = columns
		.map((column) => `columns=${encodeURIComponent(column)}`)
		.join("&");
	const page = await getJson<Schema["PlaylistPage"]>(
		`/api/playlists/${playlist.id}/items?offset=0&count=${playlist.itemCount}&${declared}`,
	);
	return page.items;
};

async function findLibrary() {
	const { playlists } = await getJson<{
		playlists: Schema["PlaylistAnnotation"][];
	}>("/api/playlists");
	// The biggest playlist is the library on any install that has one.
	const library = [...playlists].sort((a, b) => b.itemCount - a.itemCount)[0];
	if (!library) throw new Error("no playlists on this player");
	return library;
}

const dir = out ?? HERE;

async function main() {
	const library = await findLibrary();
	const capabilities =
		await getJson<Schema["Capabilities"]>("/api/capabilities");
	const playerName = `${capabilities.playerName} ${capabilities.playerVersion}`;
	console.log(
		`capturing from ${playerName}, playlist ${library.title} (${library.itemCount})`,
	);

	const toTrack = (
		item: { columns: string[] },
		index: number,
	): CapturedTrack => ({
		index,
		fields: Object.fromEntries(
			EXPRESSIONS.map((expression, at) => [expression, item.columns[at]]),
		),
	});

	const all = (await rowsOf(library, EXPRESSIONS)).map(toTrack);

	const wanted = await albumsToCapture();
	const lyrics = new Map<number, string>();
	if (wanted.some((album) => album.lyrics)) {
		(await rowsOf(library, [LYRIC])).forEach((item, index) => {
			const text = item.columns[0];
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
		`${JSON.stringify({ capturedFrom: playerName, expressions: EXPRESSIONS, albums }, null, 2)}\n`,
	);

	if (!listed) {
		const { player: playing } = await getJson<Schema["State"]>("/api/state");
		const orders = Object.entries(JEAN_MODE_BY_ORDER);
		const player: Omit<FakePlayerState, "activeItem" | "options"> = {
			info: {
				name: capabilities.playerName,
				version: capabilities.playerVersion,
			},
			playbackMode: Math.max(
				orders.findIndex(([, mode]) => mode === playing.playbackMode),
				0,
			),
			playbackState: playing.playback,
			volume: {
				isMuted: playing.muted,
				max: capabilities.volumeMax,
				min: capabilities.volumeMin,
				type: capabilities.volumeUnit,
				value: playing.volume,
			},
		};
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
		new URL(`/api/artwork/playlists/${playlistId}/${index}`, base),
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
