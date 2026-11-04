import { fieldTable } from "@/shared/api/fieldTable";
import {
	everyValueOf,
	GENRE_EXPRESSION,
	PLAYER_JOINER,
} from "@/shared/api/multiValue";
import type { WriteFields } from "@/shared/api/tags";
import type { TrackColumns } from "@/shared/api/types";
import type { Phrase } from "@/shared/i18n/en";
import { EARLIER, HIGHER, LATER, pairedReader } from "./fields";

// `details.of` and `details.saveForbidden` take a field, so they stay out of the union a runtime key
// is typed by.
export type DetailPhrase = Exclude<
	Extract<Phrase, `details.${string}`>,
	"details.of" | "details.saveForbidden"
>;

const one = (tag: string) => `$meta(${tag})`;

// The tags the form offers, in the order it lists them. `read` is what the file holds rather than
// what title formatting derives from it, so a form opened on a track shows what Save would write back.
// `column` names that read among the columns requested, and `drawnAs` the column the view draws the
// tag from, where it draws one.
export const DETAIL_FIELDS = [
	{
		label: "details.title",
		column: "titleRaw",
		tag: "TITLE",
		read: one("title"),
		multi: false,
	},
	{
		label: "details.artist",
		column: "artistRaw",
		tag: "ARTIST",
		drawnAs: "artist",
		read: everyValueOf("artist"),
		multi: true,
	},
	{
		label: "details.album",
		column: "albumRaw",
		tag: "ALBUM",
		drawnAs: "album",
		read: one("album"),
		multi: false,
	},
	{
		label: "details.albumArtist",
		column: "albumArtistRaw",
		tag: "ALBUM ARTIST",
		drawnAs: "albumArtist",
		read: everyValueOf("album artist"),
		multi: true,
	},
	{
		label: "details.date",
		column: "dateRaw",
		tag: "DATE",
		drawnAs: "date",
		read: one("date"),
		multi: false,
	},
	{
		label: "details.genre",
		column: "genreRaw",
		tag: "GENRE",
		drawnAs: "genre",
		read: everyValueOf("genre"),
		multi: true,
	},
	{
		label: "details.publisher",
		column: "publisherRaw",
		tag: "PUBLISHER",
		drawnAs: "publisher",
		read: one("publisher"),
		multi: false,
	},
	{
		label: "details.composer",
		column: "composerRaw",
		tag: "COMPOSER",
		drawnAs: "composer",
		read: everyValueOf("composer"),
		multi: true,
	},
	{
		label: "details.track",
		column: "trackNumberRaw",
		tag: "TRACKNUMBER",
		drawnAs: "trackNumber",
		read: one("tracknumber"),
		multi: false,
	},
	{
		label: "details.totalTracks",
		column: "totalTracksRaw",
		tag: "TOTALTRACKS",
		drawnAs: "totalTracks",
		read: one("totaltracks"),
		multi: false,
	},
	{
		label: "details.disc",
		column: "discNumberRaw",
		tag: "DISCNUMBER",
		drawnAs: "discNumber",
		read: one("discnumber"),
		multi: false,
	},
	{
		label: "details.totalDiscs",
		column: "totalDiscsRaw",
		tag: "TOTALDISCS",
		drawnAs: "totalDiscs",
		read: one("totaldiscs"),
		multi: false,
	},
	{
		label: "details.bpm",
		column: "bpmRaw",
		tag: "BPM",
		drawnAs: "bpm",
		read: one("bpm"),
		multi: false,
	},
] as const satisfies readonly {
	label: DetailPhrase;
	column: string;
	tag: string;
	drawnAs?: string;
	read: string;
	multi: boolean;
}[];

const COLUMNS = [
	["album", "%album%"],
	["albumArtist", "%album artist%"],
	// Not drawn -- the stream already carries it. It is here because a record is addressed by the
	// album artist falling back to this, the way the library groups them.
	["artist", "%artist%"],
	["year", "%year%"],
	["date", "%date%"],
	["genre", GENRE_EXPRESSION],
	["publisher", "%publisher%"],
	["composer", "%composer%"],

	["trackNumber", "%tracknumber%"],
	["totalTracks", "%totaltracks%"],
	["discNumber", "%discnumber%"],
	["totalDiscs", "%totaldiscs%"],

	["codec", "%codec%"],
	["codecProfile", "%codec_profile%"],
	["bitrate", "%bitrate%"],
	["sampleRate", "%samplerate%"],
	["channels", "%channels%"],
	["fileSize", "%filesize_natural%"],
	["fileName", "%filename_ext%"],

	["playCount", "%lastfm_play_count%"],
	["lastPlayed", "%lastfm_last_played%"],
	["firstPlayed", "%lastfm_first_played%"],

	["trackGain", "%replaygain_track_gain%"],
	["albumGain", "%replaygain_album_gain%"],
	["bpm", "%bpm%"],

	["playCountLocal", "%play_count%"],
	["lastPlayedLocal", "%last_played%"],
	["firstPlayedLocal", "%first_played%"],
] as const;

export const { expressions: DETAIL_EXPRESSIONS, index: DETAIL_FIELD } =
	fieldTable([
		...COLUMNS,
		...DETAIL_FIELDS.map(({ column, read }) => [column, read] as const),
	]);

export const readDetail = pairedReader([
	{
		scrobbled: DETAIL_FIELD.playCount,
		local: DETAIL_FIELD.playCountLocal,
		by: HIGHER,
	},
	{
		scrobbled: DETAIL_FIELD.lastPlayed,
		local: DETAIL_FIELD.lastPlayedLocal,
		by: LATER,
	},
	{
		scrobbled: DETAIL_FIELD.firstPlayed,
		local: DETAIL_FIELD.firstPlayedLocal,
		by: EARLIER,
	},
]);

const SEPARATOR = String.fromCharCode(31);

/**
 * The row as the file holds it once `fields` are written, so the view can draw them before the host
 * has read the track again.
 */
export function rowWith(row: TrackColumns, fields: WriteFields): TrackColumns {
	const next = [...row];
	for (const field of DETAIL_FIELDS) {
		const value = fields[field.tag];
		if (value === undefined) continue;
		const values = typeof value === "string" ? [value] : value;
		next[DETAIL_FIELD[field.column]] = values.join(SEPARATOR);
		if ("drawnAs" in field)
			next[DETAIL_FIELD[field.drawnAs]] = values.join(
				field.tag === "GENRE" ? SEPARATOR : PLAYER_JOINER,
			);
		if (field.tag === "DATE")
			next[DETAIL_FIELD.year] = /^\d{4}/.exec(values[0] ?? "")?.[0] ?? "";
	}
	return next;
}
