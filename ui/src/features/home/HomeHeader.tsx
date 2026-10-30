import { ChevronRight, Shuffle } from "lucide-react";
import {
	useCanControlPlayback,
	whenControllable,
} from "@/domain/player/usePlaybackControl";
import { href, ROUTE } from "@/domain/track/routes";
import { spellDuration } from "@/domain/track/stats";
import type { Phrase } from "@/shared/i18n/en";
import {
	useFormats,
	useSpoken,
	useTranslate,
} from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import { Button } from "@/shared/ui/Button";
import { PlayIcon } from "@/shared/ui/icons";
import { BusyNote, busyProps, Skeleton } from "@/shared/ui/Skeleton";
import type { CoveredAlbum } from "./cover";
import styles from "./HomeHeader.module.css";

type DoorPhrase = Extract<Phrase, `home.door.${string}`>;
type HintPhrase = Extract<Phrase, `home.hint.${string}`>;

export interface HeaderFigures {
	seconds: number;
	earliestYear: number | null;
	latestYear: number | null;
	trackCount: number;
	albumCount: number;
	artistCount: number;
	genreCount: number;
	topAlbum: CoveredAlbum | null;
	topArtist: { name: string | null; cover: CoveredAlbum } | null;
}

export const NO_FIGURES: HeaderFigures = {
	seconds: 0,
	earliestYear: null,
	latestYear: null,
	trackCount: 0,
	albumCount: 0,
	artistCount: 0,
	genreCount: 0,
	topAlbum: null,
	topArtist: null,
};

interface Door {
	id: string;
	label: DoorPhrase;
	count: number | null;
	href: string | null;
	onOpen?: () => void;
	hint: HintPhrase | null;
	name: string | null;
	cover: CoveredAlbum | null;
	minor?: boolean;
}

export function HomeHeader({
	figures,
	onPlayEverything,
	onShuffleEverything,
	onSearch,
	canPlay,
	canShuffle,
}: {
	figures: HeaderFigures | null;
	onPlayEverything: () => void;
	onShuffleEverything: () => void;
	onSearch: (query: string) => void;
	canPlay: boolean;
	canShuffle: boolean;
}) {
	const t = useTranslate();
	const canControlPlayback = useCanControlPlayback();
	const say = useSpoken();
	const playLabel = t("player.play");
	const shuffleLabel = t("player.shuffle");
	const isWaiting = figures === null;
	const duration = figures ? spellDuration(figures.seconds) : null;
	const span =
		figures?.earliestYear &&
		figures.latestYear &&
		figures.earliestYear !== figures.latestYear
			? `${figures.earliestYear}–${figures.latestYear}`
			: (figures?.earliestYear ?? null);

	const doors = (
		[
			{
				id: "tracks",
				label: "home.door.tracks",
				count: figures?.trackCount ?? null,
				href: href(ROUTE.all),
				hint: "home.hint.browse",
				name: t("library.allMusic"),
				cover: null,
				minor: true,
			},
			{
				id: "albums",
				label: "home.door.albums",
				count: figures?.albumCount ?? null,
				href: null,
				onOpen: () => figures?.topAlbum && onSearch(figures.topAlbum.album),
				hint: figures?.topAlbum || isWaiting ? "home.hint.mostPlayed" : null,
				name: figures?.topAlbum?.album ?? null,
				cover: figures?.topAlbum ?? null,
			},
			{
				id: "artists",
				label: "home.door.artists",
				count: figures?.artistCount ?? null,
				href: null,
				onOpen: () =>
					figures?.topArtist?.name && onSearch(figures.topArtist.name),
				hint: figures?.topArtist || isWaiting ? "home.hint.mostPlayed" : null,
				name: figures?.topArtist?.name ?? null,
				cover: figures?.topArtist?.cover ?? null,
			},
			{
				id: "genres",
				label: "home.door.genres",
				count: figures?.genreCount ?? null,
				href: href(ROUTE.genres),
				hint: "home.hint.browse",
				name: t("home.allGenres"),
				cover: null,
				minor: true,
			},
		] as Door[]
	).filter((door) => door.count === null || door.count > 0);

	return (
		<header className={styles.header}>
			<div className={styles.said}>
				<p className={styles.eyebrow}>
					{t("home.yourLibrary")}
					{span ? <span className={styles.span}>{span}</span> : null}
				</p>

				<h1 className={styles.title} {...busyProps(isWaiting)}>
					{isWaiting ? (
						<>
							<Skeleton />
							<BusyNote />
						</>
					) : duration ? (
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
							{...whenControllable(
								canControlPlayback,
								onPlayEverything,
								say("player.play"),
								say,
							)}
						>
							{playLabel}
						</Button>
					) : null}
					{canShuffle ? (
						<Button
							icon={Shuffle}
							{...whenControllable(
								canControlPlayback,
								onShuffleEverything,
								shuffleLabel,
								t,
							)}
						>
							{shuffleLabel}
						</Button>
					) : null}
				</div>
			) : null}

			{doors.length > 0 ? (
				<div className={styles.doors} {...busyProps(isWaiting)}>
					{doors.map((door) => (
						<Doorway key={door.id} door={door} isWaiting={isWaiting} />
					))}
				</div>
			) : null}
		</header>
	);
}

function Doorway({ door, isWaiting }: { door: Door; isWaiting: boolean }) {
	const t = useTranslate();
	const format = useFormats();
	const isNamed = door.name !== null || (isWaiting && door.hint !== null);
	const body = (
		<>
			<span className={styles.figure}>
				<span className={styles.count}>
					{door.count === null ? <Skeleton /> : format.number(door.count)}
				</span>
				<span className={styles.label}>
					{t(door.label, { count: door.count ?? 0 })}
				</span>
			</span>

			{isNamed ? (
				<span className={styles.named}>
					{door.cover || isWaiting ? (
						<span className={styles.thumb}>
							{door.cover ? (
								<Artwork
									src={door.cover.artworkUrl}
									identity={door.cover.identity}
									size="100%"
									alt=""
								/>
							) : (
								<Skeleton height="100%" />
							)}
						</span>
					) : null}

					<span className={styles.namedText}>
						{door.hint ? (
							<span className={styles.hint}>{t(door.hint)}</span>
						) : null}
						<span className={styles.name}>
							<span className={styles.nameText}>
								{door.name ?? <Skeleton />}
							</span>
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

	if (door.href)
		return (
			<a
				className={styles.door}
				href={door.href}
				data-door={door.id}
				data-minor={door.minor}
			>
				{body}
			</a>
		);

	return isWaiting ? (
		<div className={styles.door} data-door={door.id} data-minor={door.minor}>
			{body}
		</div>
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
