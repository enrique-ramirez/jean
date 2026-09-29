import { useTranslate } from "@/shared/i18n/useTranslate";
import { Crumb } from "@/shared/ui/Crumb";
import { namesAnArtist } from "./fields";
import { artistRoute, href } from "./routes";

// Up from a record is whoever made it, where that is somewhere to go: a compilation's `Various
// Artists` has no page, and a record whose files carry neither artist tag names nobody at all.
export function AlbumCrumb({ artist }: { artist: string | null }) {
	const t = useTranslate();

	return artist && namesAnArtist(artist) ? (
		<Crumb href={href(artistRoute(artist))}>{artist}</Crumb>
	) : (
		t("album.crumb")
	);
}
