import { ChevronRight, Shuffle } from "lucide-react";
import { spellDuration } from "@/domain/track/stats";
import { pluralise } from "@/shared/lib/text";
import { Artwork } from "@/shared/ui/Artwork";
import { Button } from "@/shared/ui/Button";
import { PlayIcon } from "@/shared/ui/icons";
import styles from "./HomeHeader.module.css";
import type { LibraryStats } from "./libraryStats";

// A claim, then three doors.
//
// The headline is the *duration*, because a track count is a number and "85 days
// of music" is a feeling, and a front door should be the second thing. Under it
// the counts -- which used to be five figures separated by hairlines, and are
// now three cards that each end in something you can press.
//
// Reference pass. Sonara's dashboard puts a row of stat cards beside its hero
// and each one carries a percentage delta and a sparkline; Jean can draw neither
// honestly, because `%lastfm_last_played%` records only the most recent play, so
// there is no history to plot and no previous period to compare against. Every
// one of those figures would be invented. What replaces them is the move
// underneath Last.fm's three-card set: the bottom of each card is a *named
// record*, not a trend. Rejected: the KPI grid with a growth-rate tile, which is
// what this screen already was; and Wrapped's gradient panels, on the standing
// rule.
// **A destination is an anchor; an action is a button.** The tracks door is
// nothing but a route, so it is a link and cmd-click opens it in a tab. The
// other two run a search, and a search's query lives in memory rather than in
// the hash -- `#/search` carries the route and not what was typed -- so an
// anchor there would promise a tab that opens on an empty field. They are
// buttons, which is what the project's own rule says: an anchor is for a thing
// that is *only* a destination.
interface Door {
	id: string;
	label: string;
	count: number;
	href: string | null;
	onOpen?: () => void;
	hint: string | null;
	name: string | null;
	// The sleeve of the record this card names, drawn beside it. Null on the one
	// card that names a destination rather than a record -- and that difference
	// is the point: a cover means "this is a thing in your library".
	cover: string | null;
	// Dropped on a phone when there is another card to show. The headline already
	// says how big the library is, so the tracks figure is the one repeating
	// itself; two cards at a readable size beat three squeezed.
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

	// A figure at nothing is not drawn. Zero albums means no album tag rather
	// than a library without albums, and either way it is an absence dressed as
	// a fact -- so a brand new install gets a header that shrinks to what it can
	// honestly say instead of a row of noughts.
	//
	// The named half is dropped the same way: an install the player keeps no play
	// counts for gets the count and no "most played", never a record picked
	// arbitrarily and captioned as a favourite.
	const doors: Door[] = [
		{
			id: "tracks",
			label: "track",
			count: stats.trackCount,
			href: "#/all",
			// Carries a hint like the other two rather than the bare name it started
			// with: without one its link sat a line higher than theirs, and three
			// cards whose bottom lines do not agree read as one of them having
			// failed to load.
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
			// Their most played record, not an arbitrary one of theirs: `artistsOf`
			// keeps the busiest album as the artist's cover for exactly this.
			cover: stats.topArtist?.cover.artworkUrl ?? null,
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

			{/* The same two a playlist header has, meaning the same two things. A
          single button would have had to be Play doing a shuffle's job, which
          contradicts the header two clicks away: Shuffle is the one worth
          pressing on thirty thousand tracks, and Play is the one that has to
          exist for Shuffle to be honest. */}
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

			{/* The rows arrive in chunks, so every figure here is provisional until
          the last one lands. Saying so is cheaper than watching numbers tick
          upward and wondering whether they have finished. */}
			{isLoading ? <p className={styles.counting}>still counting</p> : null}
		</header>
	);
}

// Both shapes share every class, because they are the same card: what differs
// is only whether the browser can be told where it goes in advance.
function Doorway({ door }: { door: Door }) {
	// Spans rather than the `dl`/`dt`/`dd` this used to be. A definition list is
	// the right shape for a figure and its noun, and it is flow content: legal
	// inside the anchor, illegal inside the button. One markup for both beats
	// correct semantics in half the cards, and the accessible name -- "2,360
	// albums, most played, Infame" -- comes off the text either way.
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
							{/* Its own element, because `text-overflow` acts on a block's own
                  text and not on an anonymous text node beside a flex sibling:
                  with the chevron in the same box, "Chrono Cross Original
                  Soundtrack" was cut mid-word with no ellipsis at all. */}
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
