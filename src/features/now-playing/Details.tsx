import { readValue } from "@/domain/track/fields";
import type { TrackColumns } from "@/shared/api/types";
import styles from "./Details.module.css";
import { NOW_PLAYING_FIELD as F } from "./nowPlayingFields";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

const read = (row: TrackColumns, field: number) => readValue(row[field]);

// `n of m` where the total is known, `n` where it is not. *Measured*,
// `%totaltracks%` resolves on none of one 30,441-track library while
// `%totaldiscs%` resolves on 90% of it, so both halves of this happen.
function counted(row: TrackColumns, position: number, total: number) {
	const at = read(row, position);
	if (!at) return null;
	const of = read(row, total);
	return of && of !== at ? `${at} of ${of}` : at;
}

// A date tag is an ordinary messy user field: *measured* over 30,441 tracks it
// is year-only on 26,891, a full ISO date on 3,022 and untidy on 434
// (`1997, 1997-02-10`, `2011-00`). So `%year%` is what gets shown, and `%date%`
// only earns its own row when it carries more than the year already says.
function released(row: TrackColumns) {
	const year = read(row, F.year);
	const date = read(row, F.date);
	if (!date || date === year) return year;
	// Parsed leniently or not at all -- rendering `2011-00` as a date would
	// invent a month nobody tagged.
	return /^\d{4}-\d{2}-\d{2}$/.test(date)
		? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
				year: "numeric",
				month: "long",
				day: "numeric",
			})
		: date;
}

function played(raw: string | null) {
	if (!raw) return null;
	// 'YYYY-MM-DD HH:MM:SS', with a trailing space from some components, and not
	// every engine parses the space separator.
	const at = Date.parse(raw.trim().replace(" ", "T"));
	return Number.isFinite(at)
		? new Date(at).toLocaleDateString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
			})
		: raw;
}

interface Row {
	label: string;
	value: string | null;
}

interface Group {
	title: string;
	rows: Row[];
}

function groupsOf(row: TrackColumns): Group[] {
	const bitrate = read(row, F.bitrate);
	const profile = read(row, F.codecProfile);
	const sampleRate = read(row, F.sampleRate);
	const plays = Number(read(row, F.playCount) ?? 0);

	return [
		{
			title: "Release",
			rows: [
				{ label: "Album", value: read(row, F.album) },
				{ label: "Album artist", value: read(row, F.albumArtist) },
				{ label: "Released", value: released(row) },
				{ label: "Genre", value: read(row, F.genre) },
				{ label: "Publisher", value: read(row, F.publisher) },
				{ label: "Composer", value: read(row, F.composer) },
				{ label: "Track", value: counted(row, F.trackNumber, F.totalTracks) },
				{ label: "Disc", value: counted(row, F.discNumber, F.totalDiscs) },
				{ label: "BPM", value: read(row, F.bpm) },
			],
		},
		{
			title: "File",
			rows: [
				{
					label: "Format",
					value:
						[read(row, F.codec), profile].filter(Boolean).join(" · ") || null,
				},
				{ label: "Bitrate", value: bitrate ? `${bitrate} kbps` : null },
				{
					label: "Sample rate",
					value: sampleRate ? `${Number(sampleRate) / 1000} kHz` : null,
				},
				{ label: "Channels", value: read(row, F.channels) },
				{ label: "Size", value: read(row, F.fileSize) },
				{ label: "ReplayGain", value: read(row, F.trackGain) },
				{ label: "Album gain", value: read(row, F.albumGain) },
				{ label: "File", value: read(row, F.fileName) },
			],
		},
		{
			title: "Listening",
			rows: [
				// Zero plays is a fact worth stating, and `readValue` reads `'0'` as a
				// value rather than as absence -- so this row appears for a track that
				// has genuinely never been played and vanishes where no component
				// supplies play counts at all.
				{
					label: "Plays",
					value: read(row, F.playCount) === null ? null : String(plays),
				},
				{ label: "First played", value: played(read(row, F.firstPlayed)) },
				{ label: "Last played", value: played(read(row, F.lastPlayed)) },
			],
		},
	];
}

export function Details() {
	const { details, isPending } = useNowPlayingTrack();

	if (isPending) return <p className={styles.notice}>Reading the tags…</p>;
	if (!details) return <p className={styles.notice}>Nothing playing.</p>;

	// Every row is dropped where this file has nothing in it, and a group with no
	// rows left is dropped whole. *Measured*, the fields vary far too much
	// between files to draw a fixed table: `%publisher%` resolves on 61% of one
	// library, `%composer%` on 25%, `%bpm%` on 0.9%. A grid with the same twenty
	// labels on every track would be mostly empty cells, and mostly empty cells
	// read as Jean failing rather than as tags nobody wrote.
	const groups = groupsOf(details.row)
		.map((group) => ({
			...group,
			rows: group.rows.filter((row) => row.value !== null),
		}))
		.filter((group) => group.rows.length > 0);

	return (
		<div className={styles.details}>
			{groups.map((group) => (
				<section key={group.title} className={styles.group}>
					<h2 className={styles.groupTitle}>{group.title}</h2>
					<dl className={styles.rows}>
						{group.rows.map((row) => (
							<div key={row.label} className={styles.row}>
								<dt className={styles.label}>{row.label}</dt>
								<dd className={styles.value}>{row.value}</dd>
							</div>
						))}
					</dl>
				</section>
			))}
		</div>
	);
}
