import { alternativeReader } from "@/domain/track/fields";
import { fieldTable } from "@/shared/api/fieldTable";

// This list must never reach the stream: `UPDATES_URL` re-evaluates its `trcolumns` on every push.
// beefweb splits `trcolumns` on commas before evaluating, so no multi-argument title-format function may appear here.

const FIELDS = [
	["path", "%path%"],
	["subsong", "%subsong%"],

	["lyrics", "$meta(unsynced lyrics)"],
	["rating", "%rating%"],

	["album", "%album%"],
	["albumArtist", "%album artist%"],
	// Not drawn -- the stream already carries it. It is here because a record is addressed by the
	// album artist falling back to this, the way the library groups them.
	["artist", "%artist%"],
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

	["playCountLocal", "%play_count%"],
	["lastPlayedLocal", "%last_played%"],
	["firstPlayedLocal", "%first_played%"],
] as const;

export const {
	expressions: NOW_PLAYING_EXPRESSIONS,
	index: NOW_PLAYING_FIELD,
} = fieldTable(FIELDS);

export const readNowPlaying = alternativeReader({
	[NOW_PLAYING_FIELD.playCount]: NOW_PLAYING_FIELD.playCountLocal,
	[NOW_PLAYING_FIELD.lastPlayed]: NOW_PLAYING_FIELD.lastPlayedLocal,
	[NOW_PLAYING_FIELD.firstPlayed]: NOW_PLAYING_FIELD.firstPlayedLocal,
});
