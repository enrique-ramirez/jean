import { Play, Shuffle } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { Library } from "@/domain/library/useLibrary";
import type { ArtistTracks } from "@/domain/track/artists";
import {
	FIELD,
	lastPlayedOf,
	playCountOf,
	titleOf,
	value,
} from "@/domain/track/fields";
import { Mosaic } from "@/domain/track/Mosaic";
import { project, type Refs, type TrackView } from "@/domain/track/project";
import { summarise } from "@/domain/track/stats";
import { useAvailableFields } from "@/domain/track/useAvailableFields";
import { ViewHeader } from "@/domain/track/ViewHeader";
import { albumsOf } from "@/features/home/albums";
import { Artist } from "@/features/now-playing/Artist";
import { plural, pluralise } from "@/shared/lib/text";
import { Artwork } from "@/shared/ui/Artwork";
import { Button } from "@/shared/ui/Button";
import styles from "./ArtistView.module.css";

const inLibrarySpace = (refs: Refs, view: TrackView) =>
	Int32Array.from(refs, (at) => view.indices[at]);

function historyOf(view: TrackView) {
	let plays = 0;
	let unplayed = 0;
	let lastPlayed = 0;
	let best: { title: string; plays: number } | null = null;

	for (const row of view.rows) {
		const count = playCountOf(row) ?? 0;
		plays += count;
		if (count === 0) unplayed += 1;
		else if (best === null || count > best.plays)
			best = { title: titleOf(row), plays: count };

		const at = lastPlayedOf(row);
		if (at !== null && at > lastPlayed) lastPlayed = at;
	}

	return { plays, unplayed, lastPlayed, best };
}

const shortDate = (at: number) =>
	new Date(at).toLocaleDateString(undefined, {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

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
		() => summarise(own?.rows ?? [], own?.playedCount ?? 0),
		[own],
	);

	const discography = useMemo(() => {
		if (!own) return [];
		return albumsOf(own.rows)
			.map((album) => ({ ...album, refs: inLibrarySpace(album.refs, own) }))
			.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
	}, [own]);

	const history = useMemo(() => (own ? historyOf(own) : null), [own]);
	const { hasPlayCounts } = useAvailableFields(own?.rows ?? []);

	const held = (own?.rows.length ?? 0) + (guest?.rows.length ?? 0);
	const allRefs = tracks.all;

	return (
		<div className={styles.artist}>
			<ViewHeader
				eyebrow="Artist"
				title={name}
				stats={stats}
				hasPlayCounts={hasPlayCounts}
				tabs={tabs}
				leading={
					<>
						<b>{discography.length.toLocaleString()}</b>{" "}
						{pluralise(discography.length, "album")}
					</>
				}
				// No artist image to fall back to -- see this feature's CLAUDE.md.
				aside={
					own && discography.length > 0 ? (
						<Mosaic
							source={library.source}
							rows={own.rows}
							indices={own.indices}
							seed={name}
							size={176}
						/>
					) : undefined
				}
				actions={
					held > 0 ? (
						<>
							<Button
								variant="primary"
								icon={Play}
								onClick={() => onPlay(allRefs, 0)}
								disabled={!canPlay}
							>
								Play
							</Button>
							{canShuffle ? (
								<Button icon={Shuffle} onClick={() => onShuffle(allRefs)}>
									Shuffle
								</Button>
							) : null}
						</>
					) : null
				}
			/>

			{held === 0 ? (
				<p className={styles.notice}>
					{library.isLoading
						? "Reading your library..."
						: "Nothing by them in your library."}
				</p>
			) : null}

			{own && history && hasPlayCounts ? (
				<section className={styles.section}>
					<h2 className={styles.heading}>Your history</h2>
					<dl className={styles.history}>
						<div>
							<dt>Plays</dt>
							<dd className="tabular">{history.plays.toLocaleString()}</dd>
						</div>
						<div>
							<dt>Never played</dt>
							<dd className="tabular">
								{history.unplayed.toLocaleString()} of{" "}
								{own.rows.length.toLocaleString()}
							</dd>
						</div>
						{history.lastPlayed > 0 ? (
							<div>
								<dt>Last listened</dt>
								<dd>{shortDate(history.lastPlayed)}</dd>
							</div>
						) : null}
						{history.best ? (
							<div>
								<dt>Most played</dt>
								<dd>
									{history.best.title}{" "}
									<span className={styles.faint}>
										{plural(history.best.plays, "play")}
									</span>
								</dd>
							</div>
						) : null}
					</dl>
				</section>
			) : null}

			{held > 0 ? (
				<section className={styles.section}>
					<h2 className={styles.heading}>About</h2>
					<Artist name={name} />
				</section>
			) : null}

			{discography.length > 0 ? (
				<section className={styles.section}>
					<h2 className={styles.heading}>Discography</h2>
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
									<span>{plural(album.trackCount, "track")}</span>
								</span>
							</button>
						))}
					</div>
				</section>
			) : null}

			{guest && guest.rows.length > 0 ? (
				<section className={styles.section}>
					<h2 className={styles.heading}>Appears on</h2>
					<ul className={styles.guests}>
						{guest.rows.map((row, position) => (
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
										<span className={styles.guestTitle}>{titleOf(row)}</span>
										<span className={styles.guestUnder}>
											{value(row, FIELD.artist)}
										</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}
