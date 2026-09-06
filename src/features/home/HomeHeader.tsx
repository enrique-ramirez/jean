import { ChevronRight, Shuffle } from "lucide-react";
import { GENRES_HREF } from "@/domain/library/genreRoute";
import { spellDuration } from "@/domain/track/stats";
import { pluralise } from "@/shared/lib/text";
import { Artwork } from "@/shared/ui/Artwork";
import { Button } from "@/shared/ui/Button";
import { PlayIcon } from "@/shared/ui/icons";
import styles from "./HomeHeader.module.css";
import type { LibraryStats } from "./libraryStats";

interface Door {
	id: string;
	label: string;
	count: number;
	href: string | null;
	onOpen?: () => void;
	hint: string | null;
	name: string | null;
	cover: string | null;
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

	const doors: Door[] = [
		{
			id: "tracks",
			label: "track",
			count: stats.trackCount,
			href: "#/all",
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
			href: GENRES_HREF,
			hint: "browse",
			name: "All genres",
			cover: null,
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

			{isLoading ? <p className={styles.counting}>still counting</p> : null}
		</header>
	);
}

function Doorway({ door }: { door: Door }) {
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
