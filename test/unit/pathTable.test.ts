import assert from "node:assert/strict";
import test from "node:test";

import { pathCollector } from "../../src/domain/track/pathTable.ts";

const tableOf = (paths: string[]) => {
	const collector = pathCollector();
	for (const path of paths) collector.add(path);
	return collector.table();
};

const readBack = (paths: string[]) => {
	const table = tableOf(paths);
	return Array.from({ length: table.length }, (_, i) => table.at(i));
};

test("forward-slashed paths come back byte for byte", () => {
	const paths = [
		"B/Babasónicos/(2001) Jessico/01. Los Calientes.mp3",
		"B/Babasónicos/(2001) Jessico/02. Fizz.mp3",
		"M/Metallica/(1991) Metallica/01. Enter Sandman.mp3",
	];
	assert.deepEqual(readBack(paths), paths);
});

test("backslashed paths come back byte for byte", () => {
	const paths = [
		"C:\\Music\\M\\Metallica\\(1991) Metallica\\01. Enter Sandman.mp3",
		"C:\\Music\\M\\Metallica\\(1991) Metallica\\02. Sad but True.mp3",
	];
	assert.deepEqual(readBack(paths), paths);
});

test("an empty library has no rows and answers nothing", () => {
	const table = tableOf([]);
	assert.equal(table.length, 0);
	assert.equal(table.at(0), "");
});

test("a single track", () => {
	assert.deepEqual(readBack(["a/b/c.flac"]), ["a/b/c.flac"]);
});

test("paths sharing no prefix at all", () => {
	const paths = ["a.mp3", "b.mp3", "x/1.mp3", "y/1.mp3", "z/deep/er/1.mp3"];
	assert.deepEqual(readBack(paths), paths);
});

test("non-ASCII survives in the directory and in the remainder", () => {
	const paths = [
		"日本/椎名林檎/(1999) 勝訴ストリップ/01. 虚言症.flac",
		"日本/椎名林檎/(1999) 勝訴ストリップ/02. 依存症.flac",
		"Ω/Sigur Rós/( )/01. Vaka.mp3",
		"emoji 🎵/track 🎧.mp3",
	];
	assert.deepEqual(readBack(paths), paths);
});

test("a directory recurring out of path order still reads back", () => {
	const paths = ["a/1.mp3", "b/1.mp3", "a/2.mp3", "b/2.mp3", "a/3.mp3"];
	assert.deepEqual(readBack(paths), paths);
});

// The remainders are joined in blocks, so the boundaries are where an off-by-one would show.
test("reading across block boundaries", () => {
	const paths = Array.from(
		{ length: 1030 },
		(_, i) => `root/album ${Math.floor(i / 7)}/${i}. track ${i}.mp3`,
	);
	assert.deepEqual(readBack(paths), paths);
});

test("a view is fixed at the length it was taken with", () => {
	const collector = pathCollector();
	collector.add("a/1.mp3");
	const early = collector.table();
	collector.add("a/2.mp3");
	const later = collector.table();

	assert.equal(early.length, 1);
	assert.equal(early.at(0), "a/1.mp3");
	assert.equal(early.at(1), "");
	assert.equal(later.length, 2);
	assert.equal(later.at(1), "a/2.mp3");
});

test("a view taken with a block still open reads the rows in it", () => {
	const collector = pathCollector();
	const paths = Array.from({ length: 300 }, (_, i) => `root/${i}.mp3`);
	for (const path of paths.slice(0, 260)) collector.add(path);
	const early = collector.table();
	assert.deepEqual(
		Array.from({ length: early.length }, (_, i) => early.at(i)),
		paths.slice(0, 260),
	);

	for (const path of paths.slice(260)) collector.add(path);
	const later = collector.table();
	assert.deepEqual(
		Array.from({ length: later.length }, (_, i) => later.at(i)),
		paths,
	);
});

test("a path with no separator is its own remainder", () => {
	const paths = ["one.mp3", "two.mp3", "a/three.mp3", "four.mp3"];
	assert.deepEqual(readBack(paths), paths);
});
