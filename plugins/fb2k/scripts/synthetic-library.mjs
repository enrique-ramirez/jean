import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const TRACKS_PER_ALBUM = 10;
const ALBUMS_PER_ARTIST = 10;
const GENRES = 40;
const FIRST_YEAR = 1960;
const LAST_YEAR = 2024;
const SECONDS = 240;
const MARKER = ".synthetic-library";
const CONCURRENT_WRITES = 64;

// MPEG-1 Layer III, 32 kbit/s, 32 kHz, mono: a 144-byte frame of 1152 samples, 36 ms.
const FRAME_HEADER = [0xff, 0xfb, 0x18, 0xc0];
const FRAME_BYTES = 144;
const SAMPLES_PER_FRAME = 1152;
const SAMPLE_RATE = 32000;
// A mono MPEG-1 frame carries 17 bytes of side information after the header.
const XING_OFFSET = FRAME_HEADER.length + 17;
const XING_FRAMES_FLAG = 1;

function fail(message) {
	console.error(`synthetic-library: ${message}`);
	process.exit(1);
}

function textFrame(id, text) {
	const body = Buffer.concat([Buffer.from([0]), Buffer.from(text, "latin1")]);
	const header = Buffer.alloc(10);
	header.write(id, 0, "latin1");
	header.writeUInt32BE(body.length, 4);
	return Buffer.concat([header, body]);
}

// ID3v2.3: the tag's own size is four 7-bit bytes, a frame's is a plain big-endian integer.
function id3Tag(fields) {
	const frames = Buffer.concat(
		Object.entries(fields).map(([id, text]) => textFrame(id, text)),
	);
	const header = Buffer.alloc(10);
	header.write("ID3", 0, "latin1");
	header[3] = 3;
	for (let at = 0; at < 4; at += 1)
		header[6 + at] = (frames.length >> (7 * (3 - at))) & 0x7f;
	return Buffer.concat([header, frames]);
}

// foobar2000 takes an MP3's length from the frame count in an Info header, without reading as many
// frames, so one frame claims SECONDS and a second is all the audio the file holds.
function audio() {
	const first = Buffer.alloc(FRAME_BYTES);
	Buffer.from(FRAME_HEADER).copy(first);
	first.write("Info", XING_OFFSET, "latin1");
	first.writeUInt32BE(XING_FRAMES_FLAG, XING_OFFSET + 4);
	first.writeUInt32BE(
		Math.round((SECONDS * SAMPLE_RATE) / SAMPLES_PER_FRAME),
		XING_OFFSET + 8,
	);
	const silent = Buffer.alloc(FRAME_BYTES);
	Buffer.from(FRAME_HEADER).copy(silent);
	return Buffer.concat([first, silent, silent]);
}

function shapeOf(count) {
	const albums = Math.max(1, Math.ceil(count / TRACKS_PER_ALBUM));
	const artists = Math.max(1, Math.ceil(albums / ALBUMS_PER_ARTIST));
	return { albums, artists };
}

function trackAt(index, { albums, artists }) {
	const album = index % albums;
	const artist = album % artists;
	const year =
		albums > 1
			? FIRST_YEAR +
				Math.round((album * (LAST_YEAR - FIRST_YEAR)) / (albums - 1))
			: FIRST_YEAR;
	const number = String(Math.floor(index / albums) + 1).padStart(2, "0");
	const title = `Track ${index + 1}`;
	const artistName = `Artist ${artist + 1}`;
	return {
		directory: join(artistName, `Album ${album + 1}`),
		file: `${number} ${title}.mp3`,
		tag: {
			TIT2: title,
			TPE1: artistName,
			TPE2: artistName,
			TALB: `Album ${album + 1}`,
			TRCK: number,
			TCON: `Genre ${(index % GENRES) + 1}`,
			TYER: String(year),
		},
	};
}

async function write(root, count) {
	if (existsSync(root)) fail(`${root} exists already; remove it first.`);
	const shape = shapeOf(count);
	const sound = audio();
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, MARKER), `${count}\n`);

	const made = new Set();
	let next = 0;
	let bytes = 0;
	async function worker() {
		while (next < count) {
			const track = trackAt(next, shape);
			next += 1;
			const directory = join(root, track.directory);
			if (!made.has(directory)) {
				made.add(directory);
				mkdirSync(directory, { recursive: true });
			}
			const file = Buffer.concat([id3Tag(track.tag), sound]);
			bytes += file.length;
			await writeFile(join(directory, track.file), file);
		}
	}
	await Promise.all(Array.from({ length: CONCURRENT_WRITES }, worker));
	process.stdout.write(
		`synthetic-library: wrote ${count} files, ${shape.albums} albums, ${shape.artists} artists, ${bytes} bytes (${Math.round(bytes / count)} per file) under ${root}\n`,
	);
}

function remove(root) {
	let marked;
	try {
		marked = readFileSync(join(root, MARKER), "utf8");
	} catch {
		fail(`${root} holds no ${MARKER}; it is not a root this script wrote.`);
	}
	rmSync(root, { recursive: true, maxRetries: 3 });
	process.stdout.write(
		`synthetic-library: removed ${root} (${marked.trim()} files)\n`,
	);
}

const [command, root, tracks] = process.argv.slice(2);
if (
	command === "write" &&
	root &&
	Number.isInteger(Number(tracks)) &&
	Number(tracks) > 0
)
	await write(root, Number(tracks));
else if (command === "remove" && root) remove(root);
else fail("usage: write <root> <tracks> | remove <root>");
