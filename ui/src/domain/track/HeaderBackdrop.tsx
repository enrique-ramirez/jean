import { Artwork } from "@/shared/ui/Artwork";
import styles from "./HeaderBackdrop.module.css";
import type { LibrarySource } from "./librarySource";
import type { CoverPicks } from "./useCoverPicks";

const generations = new WeakMap<object, number>();
let generation = 0;
const generationOf = (picks: object) => {
	let known = generations.get(picks);
	if (known === undefined) {
		generation += 1;
		known = generation;
		generations.set(picks, known);
	}
	return known;
};

export function HeaderBackdrop({
	source,
	covers,
}: {
	source: LibrarySource;
	covers: CoverPicks;
}) {
	const { albumCount, tiles, picks, settled, isReady, hasCover } = covers;

	if (albumCount === null || tiles === 0) return null;
	if (isReady && !hasCover) return null;

	return (
		<div
			className={styles.backdrop}
			data-backdrop=""
			data-tiles={tiles}
			data-ready={isReady ? "true" : undefined}
			aria-hidden="true"
		>
			<div key={generationOf(picks)} className={styles.stage}>
				{picks.map((pick, position) => (
					<Artwork
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of tiles, never reordered, so the slot is the identity
						key={`${pick.ref}-${position}`}
						src={source.artworkUrl(pick.ref)}
						identity={pick.identity}
						size="100%"
						className={styles.tile}
						onSettled={settled}
					/>
				))}
			</div>
		</div>
	);
}
