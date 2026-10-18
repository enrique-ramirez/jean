import type { Member } from "@/domain/artist/credits";
import { creditSpans } from "./creditSpans";
import { artistRoute, href } from "./routes";

const NOBODY: readonly Member[] = [];

/**
 * A credit line drawn as links, one per name it credits. The tag's own text is preserved exactly --
 * the separators come back from the credit rather than being written out again, so `Feat.` stays
 * `Feat.` and a name Jean would have spelled differently is still shown the way the file spells it.
 * Only the address is normalised. A name that is not somewhere you can go -- `Various Artists` on a
 * compilation -- is drawn as the plain text it always was.
 */
export function ArtistLinks({
	credit,
	members = NOBODY,
	className,
}: {
	credit: string | null | undefined;
	members?: readonly Member[];
	className?: string;
}) {
	if (!credit) return null;

	return (
		<span className={className}>
			{creditSpans(credit, members).map((span, at) =>
				span.name === null ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: the position in the credit is the identity
					<span key={at}>{span.text}</span>
				) : (
					<a
						// biome-ignore lint/suspicious/noArrayIndexKey: as above
						key={at}
						className="tag-link"
						href={href(artistRoute(span.name))}
						data-link=""
					>
						{span.text}
					</a>
				),
			)}
		</span>
	);
}
