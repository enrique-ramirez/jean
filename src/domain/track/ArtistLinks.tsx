import { artistHref } from "./artistRoute";
import { namesAnArtist } from "./artists";
import { collapseRepeatedTag, isCreditSeparator, splitCredit } from "./fields";

/**
 * A credit line drawn as links, one per name it credits. The tag's own text is preserved exactly --
 * the separators come back from the split rather than being written out again, so `Feat.` stays
 * `Feat.` and a name Jean would have spelled differently is still shown the way the file spells it.
 * Only the address is normalised. A name that is not somewhere you can go -- `Various Artists` on a
 * compilation -- is drawn as the plain text it always was.
 */
export function ArtistLinks({
	credit,
	className,
}: {
	credit: string | null | undefined;
	className?: string;
}) {
	if (!credit) return null;

	return (
		<span className={className}>
			{splitCredit(credit).map((part, at) =>
				isCreditSeparator(at) ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: the position in the credit is the identity
					<span key={at}>{part}</span>
				) : namesAnArtist(part) ? (
					<a
						// biome-ignore lint/suspicious/noArrayIndexKey: as above
						key={at}
						className="tag-link"
						href={artistHref(collapseRepeatedTag(part.trim()))}
						data-link=""
					>
						{part}
					</a>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: the position in the credit is the identity
					<span key={at}>{part}</span>
				),
			)}
		</span>
	);
}
