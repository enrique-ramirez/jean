import { Play, Shuffle } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { libraryNoticeFor } from "@/domain/library/LibraryNotice";
import {
	isLibraryReading,
	readingNotice,
} from "@/domain/library/libraryStatus";
import type { Library } from "@/domain/library/useLibrary";
import { albumsOf } from "@/domain/track/albums";
import type { ArtistTracks } from "@/domain/track/artists";
import { useAvailableFields } from "@/domain/track/fieldAvailability";
import {
	columnReader,
	FIELD,
	readNumber,
	readTimestamp,
	titleOf,
	value,
} from "@/domain/track/fields";
import { Mosaic } from "@/domain/track/Mosaic";
import {
	EMPTY_VIEW,
	project,
	type Refs,
	type TrackView,
} from "@/domain/track/project";
import { summarise } from "@/domain/track/stats";
import { ViewHeader } from "@/domain/track/ViewHeader";
import { Artist } from "@/features/now-playing/Artist";
import { permitsPlaybackControl } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { Trans } from "@/shared/i18n/Trans";
import {
	type Translate,
	useFormats,
	useTranslate,
} from "@/shared/i18n/useTranslate";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Artwork } from "@/shared/ui/Artwork";
import { Button } from "@/shared/ui/Button";
import styles from "./ArtistView.module.css";

const inLibrarySpace = (refs: Refs, view: TrackView) =>
	Int32Array.from(refs, (at) => view.indices[at]);

function historyOf(view: TrackView, t: Translate) {
	const playsOf = columnReader(view.columns, FIELD.playCount, readNumber);
	const playedAt = columnReader(view.columns, FIELD.lastPlayed, readTimestamp);

	let plays = 0;
	let unplayed = 0;
	let lastPlayed = 0;
	let best: { title: string; plays: number } | null = null;

	for (let position = 0; position < view.length; position += 1) {
		const ref = view.ref(position);
		const count = playsOf(ref) ?? 0;
		plays += count;
		if (count === 0) unplayed += 1;
		else if (best === null || count > best.plays)
			best = { title: titleOf(view.at(position), t), plays: count };

		const at = playedAt(ref);
		if (at !== null && at > lastPlayed) lastPlayed = at;
	}

	return { plays, unplayed, lastPlayed, best };
}

export function ArtistView({
	name,
	library,
	tracks,
	tabs,
	onPlay,
	onShuffle,
	onOpenAlbum,
	canPlay,
	canShuffle,
}: {
	name: string;
	library: Library;
	tracks: ArtistTracks;
	tabs: ReactNode;
	onPlay: (refs: Refs, position: number) => void;
	onShuffle: (refs: Refs) => void;
	onOpenAlbum: (refs: Refs, position: number) => void;
	canPlay: boolean;
	canShuffle: boolean;
}) {
	const t = useTranslate();
	const format = useFormats();
	const { discovery } = useFooJean();
	const canControlPlayback = permitsPlaybackControl(discovery);
	const { snapshot } = library;

	const own = useMemo(
		() => project(snapshot, tracks.own) ?? null,
		[snapshot, tracks.own],
	);
	const guest = useMemo(
		() => project(snapshot, tracks.guest) ?? null,
		[snapshot, tracks.guest],
	);

	const stats = useMemo(
		() => summarise(own ?? EMPTY_VIEW, own?.playedCount ?? 0),
		[own],
	);

	const discography = useMemo(() => {
		if (!own) return [];
		return albumsOf(own)
			.map((album) => ({ ...album, refs: inLibrarySpace(album.refs, own) }))
			.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
	}, [own]);

	const history = useMemo(() => (own ? historyOf(own, t) : null), [own, t]);
	const { hasPlayCounts } = useAvailableFields();

	const held = (own?.length ?? 0) + (guest?.length ?? 0);
	const allRefs = tracks.all;
	const isPlayable = held > 0 && canControlPlayback;

	useKeymap(
		SCOPE.playlist,
		{ playAll: () => onPlay(allRefs, 0) },
		{ enabled: isPlayable && canPlay },
	);
	useKeymap(
		SCOPE.playlist,
		{ shufflePlay: () => onShuffle(allRefs) },
		{ enabled: isPlayable && canShuffle },
	);

	const notice = libraryNoticeFor(library);
	if (notice) return notice;

	const { status } = library;
	const isReading = isLibraryReading(status);

	return (
		<div className={styles.artist}>
			<ViewHeader
				eyebrow={t("artist.eyebrow")}
				title={name}
				stats={stats}
				hasPlayCounts={hasPlayCounts}
				tabs={tabs}
				leading={
					<Trans
						phrase="artist.albumCount"
						count={discography.length}
						total={<b>{format.number(discography.length)}</b>}
					/>
				}
				aside={
					own && discography.length > 0 ? (
						<Mosaic source={library.source} rows={own} seed={name} size={176} />
					) : undefined
				}
				actions={
					held > 0 ? (
						<>
							<Button
								variant="primary"
								icon={Play}
								onClick={
									canControlPlayback ? () => onPlay(allRefs, 0) : undefined
								}
								disabled={canControlPlayback && !canPlay}
								aria-disabled={canControlPlayback ? undefined : "true"}
								aria-label={
									canControlPlayback
										? undefined
										: t("player.controlOffName", { control: t("player.play") })
								}
							>
								{t("player.play")}
							</Button>
							{canShuffle ? (
								<Button
									icon={Shuffle}
									onClick={
										canControlPlayback ? () => onShuffle(allRefs) : undefined
									}
									aria-disabled={canControlPlayback ? undefined : "true"}
									aria-label={
										canControlPlayback
											? undefined
											: t("player.controlOffName", {
													control: t("player.shuffle"),
												})
									}
								>
									{t("player.shuffle")}
								</Button>
							) : null}
						</>
					) : null
				}
			/>

			{held === 0 ? (
				<p className={styles.notice}>
					{isReading
						? readingNotice(status, "library.reading", t)
						: t("artist.nothingBy")}
				</p>
			) : null}

			{own && history && hasPlayCounts ? (
				<section className={styles.section}>
					<h2 className={styles.heading}>{t("artist.yourHistory")}</h2>
					<dl className={styles.history}>
						<div>
							<dt>{t("details.plays")}</dt>
							<dd className="tabular">{format.number(history.plays)}</dd>
						</div>
						<div>
							<dt>{t("artist.neverPlayed")}</dt>
							<dd className="tabular">
								{t("artist.someOf", {
									some: history.unplayed,
									all: own.length,
								})}
							</dd>
						</div>
						{history.lastPlayed > 0 ? (
							<div>
								<dt>{t("artist.lastListened")}</dt>
								<dd>
									{format.date(history.lastPlayed, {
										year: "numeric",
										month: "long",
										day: "numeric",
									})}
								</dd>
							</div>
						) : null}
						{history.best ? (
							<div>
								<dt>{t("shelf.top.title")}</dt>
								<dd>
									{history.best.title}{" "}
									<span className={styles.faint}>
										{t("shelf.plays", { count: history.best.plays })}
									</span>
								</dd>
							</div>
						) : null}
					</dl>
				</section>
			) : null}

			{held > 0 ? (
				<section className={styles.section}>
					<h2 className={styles.heading}>{t("artist.about")}</h2>
					<Artist name={name} />
				</section>
			) : null}

			{discography.length > 0 ? (
				<section className={styles.section}>
					<h2 className={styles.heading}>{t("artist.discography")}</h2>
					<div className={styles.records}>
						{discography.map((album) => (
							<button
								key={album.key}
								type="button"
								className={styles.record}
								onClick={() => onOpenAlbum(album.refs, 0)}
							>
								<span className={styles.sleeve}>
									<Artwork
										src={library.source.artworkUrl(album.refs[0])}
										size="100%"
										className={styles.cover}
									/>
								</span>
								<span className={styles.recordTitle}>{album.album}</span>
								<span className={styles.recordMeta}>
									{album.year ? (
										<span className="tabular">{album.year}</span>
									) : null}
									<span>
										{t("view.trackCount", {
											count: album.trackCount,
											total: album.trackCount,
										})}
									</span>
								</span>
							</button>
						))}
					</div>
				</section>
			) : null}

			{guest && guest.length > 0 ? (
				<section className={styles.section}>
					<h2 className={styles.heading}>{t("artist.appearsOn")}</h2>
					<ul className={styles.guests}>
						{Array.from({ length: guest.length }, (_, position) => {
							const row = guest.at(position);
							return (
								<li key={`${tracks.guest[position]}`}>
									<button
										type="button"
										className={styles.guestRow}
										onClick={() => onPlay(tracks.guest, position)}
									>
										<Artwork
											src={library.source.artworkUrl(tracks.guest[position])}
											size={36}
										/>
										<span className={styles.guestText}>
											<span className={styles.guestTitle}>
												{titleOf(row, t)}
											</span>
											<span className={styles.guestUnder}>
												{value(row, FIELD.artist)}
											</span>
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			) : null}
		</div>
	);
}
