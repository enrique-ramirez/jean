import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Mic2, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlayingFrom } from "@/domain/library/usePlayingFrom";
import { formatTime } from "@/domain/player/position";
import { useAudibleVolume } from "@/domain/player/useListener";
import { useOutputs } from "@/domain/player/useOutputs";
import { usePlaybackOrder } from "@/domain/player/usePlaybackOrder";
import { useAudiblePlayer, usePlayer } from "@/domain/player/usePlayer";
import { useResolvedPlaylistId } from "@/domain/player/usePlaylists";
import {
	usePlayPause,
	usePrevious,
	useSeek,
	useTransport,
} from "@/domain/player/useTransport";
import { ArtistLinks } from "@/domain/track/ArtistLinks";
import { coverKey, readValue } from "@/domain/track/fields";
import {
	canonicalArtworkUrl,
	canonicalPlayingArtworkUrl,
} from "@/domain/track/librarySource";
import { MAX_STARS, starsOf, toStars } from "@/domain/track/rating";
import { setRatingLayer } from "@/domain/track/ratingTarget";
import { albumRoute, href, type PanelTab } from "@/domain/track/routes";
import { playingArtworkUrl, playlistRowArtworkUrl } from "@/shared/api/artwork";
import { orThrow } from "@/shared/api/client";
import { isFooJeanReady, permitsPlaybackControl } from "@/shared/api/discovery";
import { fetchPlaylistRows } from "@/shared/api/playlists";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { usePresence } from "@/shared/hooks/usePresence";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useKeyboardOwner } from "@/shared/keyboard/keyboardOwner";
import { Artwork } from "@/shared/ui/Artwork";
import { SkipBackIcon, SkipForwardIcon } from "@/shared/ui/icons";
import { Stars, StarsInput } from "@/shared/ui/Stars";
import { CoverWheel, type NeighbourArtwork, useCoverWheel } from "./CoverWheel";
import { ListenHere, playerNameOf } from "./ListenHere";
import { LyricsScreen } from "./LyricsScreen";
import { parseLyrics } from "./lyricsFormat";
import styles from "./NowPlaying.module.css";
import { NOW_PLAYING_FIELD } from "./nowPlayingFields";
import type { OutputPicker } from "./OutputDevices";
import { PlayToggle } from "./PlayToggle";
import { QueueButton } from "./QueueButton";
import { SeekBar, useElapsedSeconds } from "./SeekBar";
import { ShuffleToggle } from "./ShuffleToggle";
import { INFO_EXIT_MS, TrackInfo } from "./TrackInfo";
import { TrackPanels } from "./TrackPanels";
import { useNowPlayingMenu } from "./useNowPlayingMenu";
import { useNowPlayingRating } from "./useNowPlayingRating";
import { useNowPlayingTrack } from "./useNowPlayingTrack";
import { VolumePopover } from "./Volume";

function Times({ snapshot }: { snapshot: PlayerSnapshot | null | undefined }) {
	const elapsed = useElapsedSeconds(snapshot);
	const duration = snapshot?.player?.activeItem?.duration ?? 0;

	return (
		<div className={styles.times}>
			<span className="tabular">{formatTime(elapsed)}</span>
			<span className="tabular">
				{duration > 0 ? `−${formatTime(Math.max(0, duration - elapsed))}` : "—"}
			</span>
		</div>
	);
}

function Rating() {
	const { raw, isLocalFile, canWrite, write } = useNowPlayingRating();

	useEffect(() => {
		setRatingLayer(write);
		return () => setRatingLayer(null);
	}, [write]);

	if (!isLocalFile) return null;

	const rating = starsOf(raw);
	const stars = rating === null ? 0 : toStars(rating);
	const label = rating === null ? "Unrated" : `${stars} of ${MAX_STARS} stars`;

	if (!canWrite) return <Stars value={stars} label={label} />;

	return <StarsInput value={stars} label={label} onRate={write} />;
}

// Must match the exit animation in NowPlaying.module.css.
const SLIDE_MS = 280;

const NOOP = () => {};

// The empty string stands for a row the media library confirms carries no path, kept apart from a
// position this window has not read at all: only the former falls back to `playlistRowArtworkUrl`.
// `identity` is computed the same way `coverIdentity()` reads a list row's own columns, so a
// neighbour showing a record already on screen elsewhere shares that record's handle rather than
// minting a second one under its address.
interface RowWindowEntry {
	path: string;
	identity: string | undefined;
}

type RowWindow = ReadonlyArray<
	readonly [position: number, row: RowWindowEntry]
>;

const NEIGHBOURS_KEY = "nowPlayingNeighbours";

// A neighbour's sleeve, and the centre's, are both read off the rows this fetches: one album is
// one address, so the record a row belongs to needs that row's own path, canonicalised, rather
// than its position.
async function fetchRowWindow(
	origin: string,
	playlistId: string,
	index: number,
): Promise<RowWindow> {
	const offset = Math.max(0, index - 1);
	const { items } = orThrow(
		await fetchPlaylistRows(origin, playlistId, offset, 3, [
			"%path%",
			"%album%",
			"%album artist%",
			"%artist%",
			"%title%",
		]),
	);
	return items.map((row, at) => {
		const [, album, albumArtist, artist, title] = row.columns.map(readValue);
		const credited = albumArtist || artist;
		const identity = album
			? coverKey(credited, album)
			: title
				? coverKey(credited, title, "track")
				: undefined;
		return [offset + at, { path: row.libraryPath ?? "", identity }] as const;
	});
}

const artworkAt = (
	origin: string | null,
	playlistId: string | null,
	position: number,
	row: RowWindowEntry,
): NeighbourArtwork | null => {
	if (row.path) {
		const src = canonicalArtworkUrl(origin, row.path);
		return src ? { src, identity: row.identity ?? src } : null;
	}

	if (!origin || !playlistId) return null;
	const src = playlistRowArtworkUrl(origin, playlistId, position);
	return src
		? { src, identity: row.identity ?? `pos:${playlistId}:${position}` }
		: null;
};

export function NowPlaying({
	isOpen,
	isCompactViewport,
	isQueueOpen,
	onToggleQueue,
	onOpenPlayingFrom,
	onDismiss,
	tab,
	onSelectTab,
}: {
	isOpen: boolean;
	isCompactViewport: boolean;
	isQueueOpen: boolean;
	onToggleQueue: () => void;
	onOpenPlayingFrom?: () => void;
	onDismiss: () => void;
	tab: PanelTab | null;
	onSelectTab: (tab: PanelTab) => void;
}) {
	const t = useTranslate();
	const isPresent = usePresence(isOpen, SLIDE_MS);
	const [isInfoOpen, setIsInfoOpen] = useState(false);
	const isInfoPresent = usePresence(isInfoOpen, INFO_EXIT_MS);

	useEffect(() => {
		if (!isOpen) setIsInfoOpen(false);
	}, [isOpen]);

	const snapshot = useAudiblePlayer();
	const { data: live } = usePlayer();
	const { track, details } = useNowPlayingTrack();
	const from = usePlayingFrom();
	const { discovery } = useFooJean();
	const canControlPlayback = permitsPlaybackControl(discovery);

	const playPause = usePlayPause();
	const seek = useSeek();
	const seekTo = canControlPlayback ? (at: number) => seek.mutate(at) : NOOP;
	const transport = useTransport();
	const previous = usePrevious();
	const order = usePlaybackOrder();
	const { isHere, volume, setValue, hasFader } = useAudibleVolume();
	const menu = useNowPlayingMenu();

	const [isLyricsFull, setIsLyricsFull] = useState(false);

	const keyboardOwner = useKeyboardOwner();

	const ownsEscape =
		isOpen &&
		!isInfoOpen &&
		!isQueueOpen &&
		!menu.isOpen &&
		keyboardOwner === null;
	useEscapeCapture(ownsEscape ? onDismiss : null);

	useEffect(() => {
		if (!isCompactViewport) setIsInfoOpen(false);
	}, [isCompactViewport]);

	const lyrics = useMemo(
		() => parseLyrics(readValue(details?.row[NOW_PLAYING_FIELD.lyrics])),
		[details],
	);
	const settledPath = details?.path ?? null;

	const sendSkip = useCallback(
		(by: number) =>
			by > 0 ? transport.next.mutate() : transport.previous.mutate(),
		[transport.next.mutate, transport.previous.mutate],
	);

	const player = snapshot?.player;
	const item = player?.activeItem;
	const playlistId = useResolvedPlaylistId(item?.playlistGuid ?? null);
	const hasPosition = Boolean(item && item.index >= 0);
	const isPlaying = player?.playbackState === "playing";

	const outputsQuery = useOutputs();
	// Absent while listening here, for the reason `StatusBar` gives: this screen's own fader is
	// already this device's, and a picker beside it would reach nothing.
	const outputs: OutputPicker | undefined =
		!isHere && outputsQuery.isAvailable
			? {
					devices: outputsQuery.devices,
					activeId: player?.outputDeviceId ?? null,
					onChoose: outputsQuery.choose,
					onOpen: outputsQuery.refetch,
				}
			: undefined;

	const isReady = isFooJeanReady(discovery);
	const origin = isReady ? discovery.origin : null;

	const artworkKey =
		hasPosition && item && playlistId !== undefined
			? `${playlistId}:${item.index}`
			: null;

	const album = readValue(details?.row[NOW_PLAYING_FIELD.album]);
	const year = readValue(details?.row[NOW_PLAYING_FIELD.year]);
	const albumArtist = readValue(details?.row[NOW_PLAYING_FIELD.albumArtist]);

	const windowQuery = useQuery({
		queryKey: [NEIGHBOURS_KEY, origin, playlistId, item?.index],
		enabled: isOpen && hasPosition && Boolean(origin && playlistId),
		queryFn: () =>
			origin && playlistId && item
				? fetchRowWindow(origin, playlistId, item.index)
				: null,
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		retry: false,
	}).data;

	// Every row a window has ever named, by position, so a row seen as a neighbour once is not
	// re-fetched the moment it becomes the centre. Kept only for the playlist it was read against:
	// a position means nothing once the playing playlist changes. A position absent from the map is
	// one this window has not read yet.
	const [knownRows, setKnownRows] = useState<Map<number, RowWindowEntry>>(
		() => new Map(),
	);
	const knownRowsPlaylist = useRef<string | null | undefined>(playlistId);
	// Cleared during render rather than in the effect below: the query for a new playlist answers
	// `undefined` until it lands, and waiting for that to clear the map would read a former
	// playlist's rows at the new one's positions for however long the fetch takes.
	if (knownRowsPlaylist.current !== playlistId) {
		knownRowsPlaylist.current = playlistId;
		setKnownRows(new Map());
	}
	useEffect(() => {
		if (!windowQuery) return;
		setKnownRows((current) => {
			const merged = new Map(current);
			let changed = false;
			for (const [position, row] of windowQuery) {
				const held = merged.get(position);
				if (!held || held.path !== row.path || held.identity !== row.identity) {
					merged.set(position, row);
					changed = true;
				}
			}
			return changed ? merged : current;
		});
	}, [windowQuery]);

	const rowAt = (position: number) => knownRows.get(position);

	// `undefined` is a neighbour this window has not read yet, and draws nothing rather than the
	// positional fallback: firing that now and the canonical address once the read lands would be
	// two requests for a neighbour library holds a path for all along.
	const neighbourAt = (position: number) => {
		const row = rowAt(position);
		return row === undefined
			? null
			: artworkAt(origin, playlistId ?? null, position, row);
	};

	const neighbours =
		order.isInOrder && hasPosition && item && playlistId
			? {
					nextArtwork: neighbourAt(item.index + 1),
					previousArtwork: neighbourAt(item.index - 1),
				}
			: { nextArtwork: null, previousArtwork: null };

	const playingAlbum = item?.album ?? null;
	const playingCredited = item?.albumArtist || item?.columns[0] || null;
	const centreCanonical = playingAlbum
		? canonicalPlayingArtworkUrl(origin, playingAlbum, playingCredited || "")
		: null;

	const artwork = !track
		? null
		: (centreCanonical ?? playingArtworkUrl(origin));

	const playingCover = !track
		? undefined
		: playingAlbum
			? coverKey(playingCredited, playingAlbum)
			: coverKey(track.artist, track.title, "track");

	// Read off the same window a neighbour would be: the address a neighbour's own fetch would have
	// produced for this position, so a slot already showing it is left alone once it becomes the
	// centre.
	const centreRow = hasPosition && item ? rowAt(item.index) : undefined;
	const neighbourArtworkSrc =
		hasPosition && item && playlistId && centreRow
			? (artworkAt(origin, playlistId, item.index, centreRow)?.src ?? null)
			: null;

	const liveItem = live?.player?.activeItem;
	const livePlaylistId = useResolvedPlaylistId(liveItem?.playlistGuid ?? null);

	const coverName = album ? t("album.coverAlt", { album }) : "";

	const wheel = useCoverWheel({
		audibleTrackKey: artworkKey,
		audibleCover: playingCover,
		playerTrackKey:
			liveItem && liveItem.index >= 0 && livePlaylistId !== undefined
				? `${livePlaylistId}:${liveItem.index}`
				: null,
		artwork,
		neighbourArtworkSrc,
		alt: coverName,
		...neighbours,
		onSkip: sendSkip,
	});

	const swipe = useSwipe(
		isCompactViewport
			? {
					onDown: onDismiss,
					onUp: () => setIsInfoOpen(true),
					onDrag: canControlPlayback ? wheel.onDrag : undefined,
					onDragEnd: canControlPlayback ? wheel.onDragEnd : undefined,
				}
			: { onDown: onDismiss },
	);

	const loading = wheel.isAwaiting ? " loading" : "";

	const fromLine = from?.isPlaying ? (
		<>
			<span className={styles.fromLabel}>{t("playlist.playingFrom")}</span>
			<b>{from.name}</b>
		</>
	) : (
		<span className={styles.fromLabel}>{t("player.nowPlaying")}</span>
	);

	const cover = (
		<Artwork
			key={artworkKey}
			src={artwork}
			identity={playingCover}
			alt={coverName}
			className={styles.cover}
		/>
	);

	const previousLabel = canControlPlayback
		? t("shortcut.previousTrack")
		: t("player.controlOffName", { control: t("shortcut.previousTrack") });
	const nextLabel = canControlPlayback
		? t("shortcut.nextTrack")
		: t("player.controlOffName", { control: t("shortcut.nextTrack") });

	if (!isPresent) return null;

	return (
		<>
			<section
				className={styles.screen}
				data-compact={isCompactViewport}
				data-leaving={!isOpen}
				data-now-playing=""
				{...swipe}
				aria-label={t("player.currentTrack")}
			>
				<header className={styles.head}>
					<button
						type="button"
						className={styles.dismiss}
						aria-label={t("player.closeNowPlaying")}
						onClick={onDismiss}
					>
						<ChevronDown size={20} strokeWidth={2} />
					</button>

					{from?.isPlaying && onOpenPlayingFrom ? (
						<button
							type="button"
							className={styles.fromLink}
							onClick={onOpenPlayingFrom}
						>
							{fromLine}
						</button>
					) : (
						<p className={styles.from}>{fromLine}</p>
					)}

					<div className={styles.headActions}>
						<button
							type="button"
							className={styles.more}
							aria-label={t("track.actions")}
							aria-haspopup="menu"
							disabled={!track}
							onClick={menu.open}
						>
							<MoreHorizontal size={20} strokeWidth={2} />
						</button>
					</div>
				</header>

				<div className={styles.spread}>
					{isCompactViewport ? (
						<div className={styles.stage}>
							<CoverWheel ref={wheel.ref} slots={wheel.slots} />
						</div>
					) : null}

					<div className={styles.identity} data-awaiting={wheel.isAwaiting}>
						{isCompactViewport ? null : (
							<div className={styles.stage}>{cover}</div>
						)}

						<h1 className={`${styles.title}${loading}`}>
							{wheel.isAwaiting
								? " "
								: (track?.title ?? t("player.nothingPlaying"))}
						</h1>
						<p className={`${styles.artist}${loading}`}>
							{wheel.isAwaiting ? (
								" "
							) : track?.artist ? (
								<ArtistLinks credit={track.artist} />
							) : (
								"—"
							)}
						</p>
						{album && !wheel.isAwaiting ? (
							<p className={styles.album}>
								<a
									className="tag-link"
									href={href(albumRoute(albumArtist ?? track?.artist, album))}
								>
									{album}
								</a>
								{year ? <span className={styles.year}> · {year}</span> : null}
							</p>
						) : null}

						<div className={styles.rating}>
							<Rating />

							{isCompactViewport ? (
								<button
									type="button"
									className={styles.lyricsButton}
									aria-expanded={isInfoOpen}
									onClick={() => setIsInfoOpen(true)}
								>
									<Mic2 size={15} strokeWidth={2} aria-hidden="true" />
									{t("panel.lyrics")}
								</button>
							) : null}
						</div>
					</div>

					{isCompactViewport ? null : (
						<TrackPanels
							variant="gatefold"
							lyrics={lyrics}
							snapshot={snapshot}
							onSeek={seekTo}
							trackKey={settledPath ?? ""}
							onExpand={() => setIsLyricsFull(true)}
							isExpanded={isLyricsFull}
							tab={tab}
							onSelectTab={onSelectTab}
						/>
					)}
				</div>

				{!isCompactViewport ? null : (
					<div className={styles.controls}>
						<SeekBar
							snapshot={snapshot}
							onSeek={seekTo}
							disabled={!canControlPlayback}
						/>
						<Times snapshot={snapshot} />

						<div className={styles.transport}>
							<div className={styles.next}>
								<ShuffleToggle
									order={order}
									className={styles.order}
									size={18}
									disabled={!canControlPlayback}
								/>

								<QueueButton
									isOpen={isQueueOpen}
									onToggle={onToggleQueue}
									variant="screen"
								/>
							</div>

							<div className={styles.keys}>
								<button
									type="button"
									className={styles.skip}
									aria-disabled={canControlPlayback ? undefined : "true"}
									aria-label={previousLabel}
									onClick={
										canControlPlayback
											? () => previous(() => wheel.skip(-1))
											: undefined
									}
								>
									<SkipBackIcon size={22} />
								</button>

								<PlayToggle
									isPlaying={isPlaying}
									onToggle={() => playPause.mutate()}
									variant="screen"
									disabled={!canControlPlayback}
								/>

								<button
									type="button"
									className={styles.skip}
									aria-disabled={canControlPlayback ? undefined : "true"}
									aria-label={nextLabel}
									onClick={canControlPlayback ? () => wheel.skip(1) : undefined}
								>
									<SkipForwardIcon size={22} />
								</button>
							</div>

							<div className={styles.outputs}>
								{player ? (
									<ListenHere playerName={playerNameOf(player.info)} />
								) : null}

								{hasFader ? (
									<VolumePopover
										volume={volume}
										onChange={setValue}
										label={t(isHere ? "player.volumeHere" : "player.volume")}
										disabled={!canControlPlayback}
										outputs={outputs}
									/>
								) : null}
							</div>
						</div>

						{canControlPlayback ? null : (
							<p className={styles.reason}>{t("player.controlOff")}</p>
						)}
					</div>
				)}

				{menu.element}
			</section>

			{isCompactViewport && isInfoPresent ? (
				<TrackInfo
					isOpen={isInfoOpen}
					title={track?.title ?? t("player.nothingPlaying")}
					artist={track?.artist ?? "—"}
					lyrics={lyrics}
					snapshot={snapshot}
					onSeek={seekTo}
					trackKey={settledPath ?? ""}
					onClose={() => setIsInfoOpen(false)}
					tab={tab}
					onSelectTab={onSelectTab}
				/>
			) : null}

			{isLyricsFull ? (
				<LyricsScreen
					lyrics={lyrics}
					snapshot={snapshot}
					onSeek={seekTo}
					onClose={() => setIsLyricsFull(false)}
				/>
			) : null}
		</>
	);
}
