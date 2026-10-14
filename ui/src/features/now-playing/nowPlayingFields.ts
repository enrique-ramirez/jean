import { EARLIER, HIGHER, LATER, pairedReader } from "@/domain/track/fields";
import { fieldTable } from "@/shared/api/fieldTable";
import { GENRE_EXPRESSION } from "@/shared/api/multiValue";
import { RATING_EXPRESSION } from "@/shared/api/rating";

// foo_openlyrics reads these tags in this order.
const LYRICS_EXPRESSION =
	"$if2($meta(unsynced lyrics),$if2($meta(lyrics),$if2($meta(syncedlyrics),$meta(unsyncedlyrics))))";

export const LYRICS_EXPRESSIONS = [LYRICS_EXPRESSION];

const FIELDS = [
	["lyrics", LYRICS_EXPRESSION],
	["rating", RATING_EXPRESSION],

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

export const {
	expressions: NOW_PLAYING_EXPRESSIONS,
	index: NOW_PLAYING_FIELD,
} = fieldTable(FIELDS);

export const readNowPlaying = pairedReader([
	{
		scrobbled: NOW_PLAYING_FIELD.playCount,
		local: NOW_PLAYING_FIELD.playCountLocal,
		by: HIGHER,
	},
	{
		scrobbled: NOW_PLAYING_FIELD.lastPlayed,
		local: NOW_PLAYING_FIELD.lastPlayedLocal,
		by: LATER,
	},
	{
		scrobbled: NOW_PLAYING_FIELD.firstPlayed,
		local: NOW_PLAYING_FIELD.firstPlayedLocal,
		by: EARLIER,
	},
]);
