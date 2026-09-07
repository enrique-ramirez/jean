import { ChevronRight, Shuffle } from "lucide-react";
import { GENRES_HREF } from "@/domain/library/genreRoute";
import { spellDuration } from "@/domain/track/stats";
import type { Phrase } from "@/shared/i18n/en";
import { useFormats, useTranslate } from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import { Button } from "@/shared/ui/Button";
import { PlayIcon } from "@/shared/ui/icons";
import styles from "./HomeHeader.module.css";
import type { LibraryStats } from "./libraryStats";

// Two types, not one: a door's noun is pluralised by its count, a hint is one fixed word.
type DoorPhrase = Extract<Phrase, `home.door.${string}`>;
type HintPhrase = Extract<Phrase, `home.hint.${string}`>;

interface Door {
	id: string;
	label: DoorPhrase;
	count: number;
	href: string | null;
	onOpen?: () => void;
	hint: HintPhrase | null;
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
	const t = useTranslate();
	const duration = spellDuration(stats.seconds);
	const span =
		stats.earliest && stats.latest && stats.earliest !== stats.latest
			? `${stats.earliest}–${stats.latest}`
			: (stats.earliest ?? null);

	const doors = (
		[
			{
				id: "tracks",
				label: "home.door.tracks",
				count: stats.trackCount,
				href: "#/all",
				hint: "home.hint.browse",
				name: t("library.allMusic"),
				cover: null,
				minor: true,
			},
			{
				id: "albums",
				label: "home.door.albums",
				count: stats.albumCount,
				href: null,
				onOpen: () => stats.topAlbum && onSearch(stats.topAlbum.album),
				hint: stats.topAlbum ? "home.hint.mostPlayed" : null,
				name: stats.topAlbum?.album ?? null,
				cover: stats.topAlbum?.artworkUrl ?? null,
			},
			{
				id: "artists",
				label: "home.door.artists",
				count: stats.artistCount,
				href: null,
				onOpen: () => stats.topArtist?.name && onSearch(stats.topArtist.name),
				hint: stats.topArtist ? "home.hint.mostPlayed" : null,
				name: stats.topArtist?.name ?? null,
				cover: stats.topArtist?.cover.artworkUrl ?? null,
			},
			{
				id: "genres",
				label: "home.door.genres",
				count: stats.genreCount,
				href: GENRES_HREF,
				hint: "home.hint.browse",
				name: t("home.allGenres"),
				cover: null,
				minor: true,
			},
		] as Door[]
	).filter((door) => door.count > 0);

	return (
		<header className={styles.header}>
			<div className={styles.said}>
				<p className={styles.eyebrow}>
					{t("home.yourLibrary")}
					{span ? <span className={styles.span}>{span}</span> : null}
				</p>

				<h1 className={styles.title}>
					{duration ? (
						<>
							{duration.lead}
							{duration.trail ? (
								<span className={styles.trail}> {duration.trail}</span>
							) : null}
							<span className={styles.of}> {t("home.ofMusic")}</span>
						</>
					) : (
						t("home.yourLibrary")
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
							{t("player.play")}
						</Button>
					) : null}
					{canShuffle ? (
						<Button icon={Shuffle} onClick={onShuffleEverything}>
							{t("player.shuffle")}
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

			{isLoading ? (
				<p className={styles.counting}>{t("home.counting")}</p>
			) : null}
		</header>
	);
}

function Doorway({ door }: { door: Door }) {
	const t = useTranslate();
	const format = useFormats();
	const body = (
		<>
			<span className={styles.figure}>
				<span className={styles.count}>{format.number(door.count)}</span>
				<span className={styles.label}>
					{t(door.label, { count: door.count })}
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
							<span className={styles.hint}>{t(door.hint)}</span>
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
