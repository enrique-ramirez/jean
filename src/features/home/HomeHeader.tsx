import { ChevronRight, Shuffle } from "lucide-react";
import { GENRES_HREF } from "@/domain/library/genreRoute";
import { spellDuration } from "@/domain/track/stats";
import { pluralise } from "@/shared/lib/text";
import { Artwork } from "@/shared/ui/Artwork";
import { Button } from "@/shared/ui/Button";
import { PlayIcon } from "@/shared/ui/icons";
import styles from "./HomeHeader.module.css";
import type { LibraryStats } from "./libraryStats";

// A claim, then three doors.
// A destination is an anchor and an action is a button: `#/search` carries the route and not what was typed, so a search door has to be a button or it promises a tab that opens on an empty field.
interface Door {
	id: string;
	label: string;
	count: number;
	href: string | null;
	onOpen?: () => void;
	hint: string | null;
	name: string | null;
	/** The sleeve of the record this card names. Null on a card that names a destination rather than a record. */
	cover: string | null;
	/** Dropped on a phone when there is another card to show. */
	minor?: boolean;
}

export function HomeHeader({
	stats,
	isLoading,
	onPlayEverything,
	onShuffleEverything,
	onSearch,
	canPlay,
	canShuffle,
}: {
	stats: LibraryStats;
	isLoading: boolean;
	onPlayEverything: () => void;
	onShuffleEverything: () => void;
	onSearch: (query: string) => void;
	canPlay: boolean;
	canShuffle: boolean;
}) {
	const duration = spellDuration(stats.seconds);
	const span =
		stats.earliest && stats.latest && stats.earliest !== stats.latest
			? `${stats.earliest}–${stats.latest}`
			: (stats.earliest ?? null);

	// A figure at nothing is not drawn: zero albums means no album tag rather than a library without albums. The named half drops the same way where the player keeps no play counts.
	const doors: Door[] = [
		{
			id: "tracks",
			label: "track",
			count: stats.trackCount,
			href: "#/all",
			// Carries a hint like the other two, or its link sits a line higher than theirs and the row reads as one card having failed to load.
			hint: "browse",
			name: "All music",
			cover: null,
			minor: true,
		},
		{
			id: "albums",
			label: "album",
			count: stats.albumCount,
			href: null,
			onOpen: () => stats.topAlbum && onSearch(stats.topAlbum.album),
			hint: stats.topAlbum ? "most played" : null,
			name: stats.topAlbum?.album ?? null,
			cover: stats.topAlbum?.artworkUrl ?? null,
		},
		{
			id: "artists",
			label: "artist",
			count: stats.artistCount,
			href: null,
			onOpen: () => stats.topArtist && onSearch(stats.topArtist.name),
			hint: stats.topArtist ? "most played" : null,
			name: stats.topArtist?.name ?? null,
			cover: stats.topArtist?.cover.artworkUrl ?? null,
		},
		{
			id: "genres",
			label: "genre",
			count: stats.genreCount,
			// A destination, like the tracks card, so the row is two doors and two records rather than
			// three records and an odd one out. No sleeve: a cover means the thing named is *in* your
			// library, and "All genres" is not a record.
			href: GENRES_HREF,
			hint: "browse",
			name: "All genres",
			cover: null,
			// Dropped on a phone, like the tracks card: three cards there leave a lone one on a second
			// row, and this screen carries two other doors to the same place -- the sidebar row and the
			// `Genres` heading further down.
			minor: true,
		},
	].filter((door) => door.count > 0);

	return (
		<header className={styles.header}>
			<div className={styles.said}>
				<p className={styles.eyebrow}>
					Your library
					{span ? <span className={styles.span}>{span}</span> : null}
				</p>

				<h1 className={styles.title}>
					{duration ? (
						<>
							{duration.lead}
							{duration.trail ? (
								<span className={styles.trail}> {duration.trail}</span>
							) : null}
							<span className={styles.of}> of music</span>
						</>
					) : (
						"Your library"
					)}
				</h1>
			</div>

			{canPlay || canShuffle ? (
				<div className={styles.actions}>
					{canPlay ? (
						<Button
							variant="primary"
							icon={PlayIcon}
							onClick={onPlayEverything}
						>
							Play
						</Button>
					) : null}
					{canShuffle ? (
						<Button icon={Shuffle} onClick={onShuffleEverything}>
							Shuffle
						</Button>
					) : null}
				</div>
			) : null}

			{doors.length > 0 ? (
				<div className={styles.doors}>
					{doors.map((door) => (
						<Doorway key={door.id} door={door} />
					))}
				</div>
			) : null}

			{/* The rows arrive in chunks, so every figure above is provisional until the last one lands. */}
			{isLoading ? <p className={styles.counting}>still counting</p> : null}
		</header>
	);
}

function Doorway({ door }: { door: Door }) {
	// Spans rather than a `dl`: a definition list is flow content, legal inside the anchor and illegal inside the button, and one markup has to serve both.
	const body = (
		<>
			<span className={styles.figure}>
				<span className={styles.count}>{door.count.toLocaleString()}</span>
				<span className={styles.label}>
					{pluralise(door.count, door.label)}
				</span>
			</span>

			{door.name ? (
				<span className={styles.named}>
					{door.cover ? (
						<span className={styles.thumb}>
							<Artwork src={door.cover} size="100%" alt="" />
						</span>
					) : null}

					<span className={styles.namedText}>
						{door.hint ? (
							<span className={styles.hint}>{door.hint}</span>
						) : null}
						<span className={styles.name}>
							{/* Its own element: `text-overflow` acts on a block's own text, not on an anonymous text node sitting beside a flex sibling. */}
							<span className={styles.nameText}>{door.name}</span>
							<ChevronRight
								className={styles.nameChevron}
								size={14}
								strokeWidth={2.5}
								aria-hidden="true"
							/>
						</span>
					</span>
				</span>
			) : null}
		</>
	);

	return door.href ? (
		<a
			className={styles.door}
			href={door.href}
			data-door={door.id}
			data-minor={door.minor}
		>
			{body}
		</a>
	) : (
		<button
			type="button"
			className={styles.door}
			data-door={door.id}
			data-minor={door.minor}
			onClick={door.onOpen}
		>
			{body}
		</button>
	);
}
