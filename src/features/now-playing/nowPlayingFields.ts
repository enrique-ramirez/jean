import { alternativeReader } from "@/domain/track/fields";
import { fieldTable } from "@/shared/api/fieldTable";

// What the now-playing screen asks the player for, over and above the expressions the update stream already carries.
// This list must never reach the stream: `UPDATES_URL` re-evaluates its `trcolumns` on every push, and the lyric tag alone runs to kilobytes.
// beefweb splits `trcolumns` on commas before evaluating, so no multi-argument title-format function may appear here.

const FIELDS = [
	["path", "%path%"],
	["subsong", "%subsong%"],

	["lyrics", "$meta(unsynced lyrics)"],
	["rating", "%rating%"],

	["album", "%album%"],
	["albumArtist", "%album artist%"],
	["year", "%year%"],
	["date", "%date%"],
	["genre", "%genre%"],
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

	// foo_playcount's spellings of the three above it, so the panel agrees with the list rather than reading `?` for a track the Plays column has a number for. Appended: the table is positional.
	["playCountLocal", "%play_count%"],
	["lastPlayedLocal", "%last_played%"],
	["firstPlayedLocal", "%first_played%"],
] as const;

export const {
	expressions: NOW_PLAYING_EXPRESSIONS,
	index: NOW_PLAYING_FIELD,
} = fieldTable(FIELDS);

// Same two components, same order of preference as the track list. Its own indices, because an index means nothing outside the table that numbered it.
export const readNowPlaying = alternativeReader({
	[NOW_PLAYING_FIELD.playCount]: NOW_PLAYING_FIELD.playCountLocal,
	[NOW_PLAYING_FIELD.lastPlayed]: NOW_PLAYING_FIELD.lastPlayedLocal,
	[NOW_PLAYING_FIELD.firstPlayed]: NOW_PLAYING_FIELD.firstPlayedLocal,
});

// `%comment%`, `%isrc%`, `%barcode%`, `%catalognumber%`, `%label%`, `%media%`, `%mood%`, `%style%`, `%key%`, `%language%` and the MusicBrainz ids are deliberately absent: they cost a column each and resolve on almost nothing.
