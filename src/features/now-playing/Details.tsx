import { genreHref } from "@/domain/library/genreRoute";
import { ArtistLinks } from "@/domain/track/ArtistLinks";
import { readTimestamp, readValue } from "@/domain/track/fields";
import type { TrackColumns } from "@/shared/api/types";
import type { Phrase } from "@/shared/i18n/en";
import {
	type Formats,
	useFormats,
	useTranslate,
} from "@/shared/i18n/useTranslate";
import styles from "./Details.module.css";
import { NOW_PLAYING_FIELD as F, readNowPlaying } from "./nowPlayingFields";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

type DetailPhrase = Extract<Phrase, `details.${string}`>;

const read = (row: TrackColumns, field: number) =>
	readValue(readNowPlaying(row, field));

function counted(row: TrackColumns, position: number, total: number) {
	const at = read(row, position);
	if (!at) return null;
	const of = read(row, total);
	return of && of !== at ? `${at} of ${of}` : at;
}

function released(row: TrackColumns, format: Formats) {
	const year = read(row, F.year);
	const date = read(row, F.date);
	if (!date || date === year) return year;
	return /^\d{4}-\d{2}-\d{2}$/.test(date)
		? format.date(new Date(`${date}T00:00:00`), {
				year: "numeric",
				month: "long",
				day: "numeric",
			})
		: date;
}

function played(raw: string | null, format: Formats) {
	if (!raw) return null;
	const at = readTimestamp(raw);
	return at === null
		? raw
		: format.date(at, { year: "numeric", month: "short", day: "numeric" });
}

interface Row {
	credit?: true;
	label: DetailPhrase;
	value: string | null;
	href?: string;
}

interface Group {
	title: DetailPhrase;
	rows: Row[];
}

const genreOf = (genre: string | null) =>
	genre ? genreHref(genre) : undefined;

function groupsOf(row: TrackColumns, format: Formats): Group[] {
	const bitrate = read(row, F.bitrate);
	const profile = read(row, F.codecProfile);
	const sampleRate = read(row, F.sampleRate);
	const plays = Number(read(row, F.playCount) ?? 0);

	return [
		{
			title: "details.group.release",
			rows: [
				{ label: "details.album", value: read(row, F.album) },
				{
					label: "details.albumArtist",
					value: read(row, F.albumArtist),
					credit: true,
				},
				{ label: "details.released", value: released(row, format) },
				{
					label: "details.genre",
					value: read(row, F.genre),
					href: genreOf(read(row, F.genre)),
				},
				{ label: "details.publisher", value: read(row, F.publisher) },
				{ label: "details.composer", value: read(row, F.composer) },
				{
					label: "details.track",
					value: counted(row, F.trackNumber, F.totalTracks),
				},
				{
					label: "details.disc",
					value: counted(row, F.discNumber, F.totalDiscs),
				},
				{ label: "details.bpm", value: read(row, F.bpm) },
			],
		},
		{
			title: "details.group.file",
			rows: [
				{
					label: "details.format",
					value:
						[read(row, F.codec), profile].filter(Boolean).join(" · ") || null,
				},
				{ label: "details.bitrate", value: bitrate ? `${bitrate} kbps` : null },
				{
					label: "details.sampleRate",
					value: sampleRate ? `${Number(sampleRate) / 1000} kHz` : null,
				},
				{ label: "details.channels", value: read(row, F.channels) },
				{ label: "details.size", value: read(row, F.fileSize) },
				{ label: "details.replayGain", value: read(row, F.trackGain) },
				{ label: "details.albumGain", value: read(row, F.albumGain) },
				{ label: "details.file", value: read(row, F.fileName) },
			],
		},
		{
			title: "details.group.listening",
			rows: [
				{
					label: "details.plays",
					value: read(row, F.playCount) === null ? null : format.number(plays),
				},
				{
					label: "details.firstPlayed",
					value: played(read(row, F.firstPlayed), format),
				},
				{
					label: "details.lastPlayed",
					value: played(read(row, F.lastPlayed), format),
				},
			],
		},
	];
}

export function Details() {
	const t = useTranslate();
	const format = useFormats();
	const { details, isPending } = useNowPlayingTrack();

	if (isPending) return <p className={styles.notice}>{t("details.reading")}</p>;
	if (!details)
		return <p className={styles.notice}>{t("details.nothingPlaying")}</p>;

	const groups = groupsOf(details.row, format)
		.map((group) => ({
			...group,
			rows: group.rows.filter((row) => row.value !== null),
		}))
		.filter((group) => group.rows.length > 0);

	return (
		<div className={styles.details}>
			{groups.map((group) => (
				<section key={group.title} className={styles.group}>
					<h2 className={styles.groupTitle}>{t(group.title)}</h2>
					<dl className={styles.rows}>
						{group.rows.map((row) => (
							<div key={row.label} className={styles.row}>
								<dt className={styles.label}>{t(row.label)}</dt>
								<dd className={styles.value}>
									{row.credit ? (
										<ArtistLinks credit={row.value} />
									) : row.href && row.value ? (
										<a className={styles.link} href={row.href}>
											{row.value}
										</a>
									) : (
										row.value
									)}
								</dd>
							</div>
						))}
					</dl>
				</section>
			))}
		</div>
	);
}
