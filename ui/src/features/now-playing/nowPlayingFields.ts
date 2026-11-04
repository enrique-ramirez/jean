import {
	DETAIL_EXPRESSIONS,
	DETAIL_FIELD,
	readDetail,
} from "@/domain/track/detailFields";
import { RATING_EXPRESSION } from "@/shared/api/rating";

// foo_openlyrics reads these tags in this order.
const LYRICS_EXPRESSION =
	"$if2($meta(unsynced lyrics),$if2($meta(lyrics),$if2($meta(syncedlyrics),$meta(unsyncedlyrics))))";

export const LYRICS_EXPRESSIONS = [LYRICS_EXPRESSION];

// The columns the details view asks for, then the two now playing keeps for itself, so a details
// view reads this row at the indices it reads any other.
export const NOW_PLAYING_EXPRESSIONS = [
	...DETAIL_EXPRESSIONS,
	LYRICS_EXPRESSION,
	RATING_EXPRESSION,
];

export const NOW_PLAYING_FIELD = {
	...DETAIL_FIELD,
	lyrics: DETAIL_EXPRESSIONS.length,
	rating: DETAIL_EXPRESSIONS.length + 1,
};

export const readNowPlaying = readDetail;
