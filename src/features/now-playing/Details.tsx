import { readValue } from "@/domain/track/fields";
import type { TrackColumns } from "@/shared/api/types";
import styles from "./Details.module.css";
import { NOW_PLAYING_FIELD as F } from "./nowPlayingFields";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

const read = (row: TrackColumns, field: number) => readValue(row[field]);

// `n of m` where the total is known, `n` where it is not. Both halves happen: `%totaltracks%` is far rarer in tags than `%totaldiscs%`.
function counted(row: TrackColumns, position: number, total: number) {
	const at = read(row, position);
	if (!at) return null;
	const of = read(row, total);
	return of && of !== at ? `${at} of ${of}` : at;
}

// A date tag is a messy user field: mostly year-only, sometimes a full ISO date, sometimes neither (`1997, 1997-02-10`, `2011-00`).
function released(row: TrackColumns) {
	const year = read(row, F.year);
	const date = read(row, F.date);
	if (!date || date === year) return year;
	// Parsed only where it is a full ISO date: rendering `2011-00` would invent a month nobody tagged.
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
	// 'YYYY-MM-DD HH:MM:SS', sometimes with a trailing space, and not every engine parses the space separator.
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
				// `readValue` reads `'0'` as a value rather than absence, so this row shows a never-played track and vanishes where no component supplies play counts.
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

	// Empty rows are dropped and a group with none left goes whole: which tags a file carries varies too much for a fixed table.
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
