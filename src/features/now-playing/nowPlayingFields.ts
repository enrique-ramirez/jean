// What the now-playing screen asks the player for, over and above the four
// expressions the update stream already carries.
//
// **This list must never reach the stream.** `UPDATES_URL` re-evaluates its
// `trcolumns` on every push -- track change, pause, and each write of a volume
// drag -- and the lyric tag alone runs to 8.5 KB. These are fetched once per
// track instead, by `useNowPlayingTrack`.
//
// The comma limitation applies here as everywhere: the list is split before it
// is evaluated, so no multi-argument function can appear. `$meta(unsynced
// lyrics)` is fine -- one argument, and single-argument functions nest.

const FIELDS = [
	// Identity, and the check that the answer describes the track that was asked
	// about rather than the one that started while the request was in flight.
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
] as const;

export type NowPlayingField = (typeof FIELDS)[number][0];

export const NOW_PLAYING_EXPRESSIONS: string[] = FIELDS.map(
	([, expression]) => expression,
);

export const NOW_PLAYING_FIELD = Object.fromEntries(
	FIELDS.map(([name], index) => [name, index]),
) as Record<NowPlayingField, number>;

// `%comment%` is deliberately absent. It resolves on 19.9% of the measured
// library and most of what it holds is ReplayGain hex written there by an old
// tagger -- a Details row that is usually empty and, when it is not, is usually
// noise.
//
// So are `%isrc%`, `%barcode%`, `%catalognumber%`, `%label%`, `%media%`,
// `%mood%`, `%style%`, `%key%`, `%language%` and the MusicBrainz ids: *measured*
// over all 30,441 tracks, every one of them resolves on exactly zero. They cost
// a column each and would never draw a row.
