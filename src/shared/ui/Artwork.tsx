import { DiscAlbum } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { classNames } from "@/shared/lib/classNames";
import {
	canCacheArtwork,
	dropArtwork,
	heldArtwork,
	holdArtwork,
} from "./artworkCache";
import {
	type ArtworkOutcome,
	outcomeFor,
	requestArtwork,
} from "./artworkQueue";
import { whenNearViewport } from "./nearViewport";

type ArtworkState = "waiting" | "granted" | ArtworkOutcome;

import styles from "./Artwork.module.css";

// What is already known about an address, or null where the answer is still open. A cover this session has resolved before is settled without another request, and `null` -- there is no cover here -- is settled before there is anything to ask.
const knownState = (src: string | null | undefined): ArtworkState | null =>
	src ? (outcomeFor(src) ?? null) : src === null ? "failed" : null;

// Every cover in the app, at every size: the status bar, the wheel, an album group, a row, a shelf card. One component because they are one thing, and because a cover that arrives differently in six places is six different flickers.
// The artwork endpoint 404s when a track has no embedded cover, which is common enough to be a normal state rather than an error. Takes a URL, not an address: where artwork lives is the source's business.
//
// Three gates, and they answer different questions. `whenNearViewport` decides *whether to ask at all* -- a grid can mount far more covers than it shows, and the genres page is a hundred and forty tiles of which a dozen are on screen. `artworkCache` decides *whether the network is involved*, because beefweb's own `max-age=3` makes the browser re-download every cover on every visit. The artwork queue then decides *how many ask at once*. None of them is `loading="lazy"`, whose answer to "is this visible" is yes for every row a jump scrolls past.
export function Artwork({
	src,
	size,
	alt = "",
	className,
	onSettled,
}: {
	/** `undefined` is *not known yet* and holds the shimmer; `null` is *there is no cover here* and settles. A caller that has an address always has a string, so the two are worth telling apart: a wheel slot the player has not named is loading, and the track before the first one is not. */
	src: string | null | undefined;
	// Omit to let the caller's stylesheet own the box: an inline width/height beats the class that sizes the now-playing cover against the space it has.
	size?: number | string;
	alt?: string;
	className?: string;
	/**
	 * Called once this cover has resolved, either way. For a caller that draws several as one thing
	 * and has to hold them all until the last has arrived -- `Mosaic` is the only one.
	 * Held in a ref, so a caller passing a fresh closure per render does not re-fire it.
	 */
	onSettled?: (outcome: ArtworkOutcome) => void;
}) {
	const [state, setState] = useState<ArtworkState>(
		() => knownState(src) ?? "waiting",
	);
	// What the `<img>` points at: the address itself where the browser fetches it, or a blob held on
	// disk. Null until the queue has granted a turn.
	const [href, setHref] = useState<string | null>(null);
	const box = useRef<HTMLDivElement | null>(null);
	const release = useRef<((outcome?: ArtworkOutcome) => void) | null>(null);

	useEffect(() => {
		const known = knownState(src);

		// Nothing to ask for. `null` is *there is no cover here* and settles; `undefined` holds.
		if (!src) {
			setState(known ?? "waiting");
			setHref(null);
			return;
		}

		if (known === "failed") {
			setState("failed");
			setHref(null);
			return;
		}

		// `ok` means this address resolved earlier in this session, so the hold is not shown again --
		// but the picture still has to be resolved, because a blob URL belongs to whichever component
		// made it and was revoked when that one went away.
		setState(known ?? "waiting");
		setHref(null);

		// Without a cache there is nothing to resolve: the `<img>` fetches the address, the browser
		// decides whether it already has it, and this is exactly what Jean did before.
		if (!canCacheArtwork()) {
			setHref(src);
			if (!known) setState("granted");
			return;
		}

		const element = box.current;
		if (!element) return;

		// Set true here and not only in the cleanup: StrictMode mounts, unmounts and remounts in
		// development, and a flag only ever cleared would be permanently off on the second run.
		let live = true;
		// One address is one refcounted blob URL shared by every row drawing that album, so a drop
		// this component never claimed revokes a picture still on screen elsewhere -- and the
		// `onError` that follows remembers the address as failed for the rest of the session.
		let claimed = false;
		const abort = new AbortController();

		const dropClaim = () => {
			if (!claimed) return;
			claimed = false;
			dropArtwork(src);
		};

		const resolve = async () => {
			try {
				const url = await holdArtwork(src, abort.signal);
				claimed = true;

				// The claim outlived the component: give it back rather than leaking a handle nobody
				// will ever drop.
				if (!live) {
					dropClaim();
					return;
				}

				setHref(url);
				setState((current) => (current === "ok" ? current : "granted"));
			} catch {
				// An abort lands here too, and there is nothing to report: the component is going away.
				if (!live) return;
				release.current?.("failed");
				release.current = null;
				setState("failed");
			}
		};

		// A cover already on disk skips the queue entirely. That queue bounds how many *requests* run at
		// once; a Cache Storage read is not one, and going through it made a cached screen fill in three
		// tiles at a time exactly as a cold one does.
		let cancel = whenNearViewport(element, async () => {
			const held = await heldArtwork(src);
			if (held) claimed = true;
			if (!live) {
				dropClaim();
				return;
			}

			if (held) {
				setHref(held);
				setState((current) => (current === "ok" ? current : "granted"));
				return;
			}

			release.current = requestArtwork(src, resolve);
		});

		return () => {
			live = false;
			cancel();
			cancel = () => {};
			abort.abort();
			dropClaim();
			release.current?.();
			release.current = null;
		};
	}, [src]);

	const settle = (outcome: ArtworkOutcome) => {
		release.current?.(outcome);
		release.current = null;
		setState(outcome);
	};

	// Reported from the state rather than from the `<img>` handlers, so the paths that settle without
	// ever mounting one -- a cover this session already answered for, an address of `null` -- report too.
	const settledRef = useRef(onSettled);
	settledRef.current = onSettled;
	useEffect(() => {
		if (state === "ok" || state === "failed") settledRef.current?.(state);
	}, [state]);

	const classes = classNames(styles.artwork, className);

	return (
		// The box, and the only element in here that outlives the picture arriving. A caller's class lands on this, so its size, its rounding and its shadow are settled before anything is known about the cover -- and a gesture that began on a sleeve is still on the same element when the sleeve resolves.
		<div
			ref={box}
			className={classes}
			style={size === undefined ? undefined : { width: size, height: size }}
			data-artwork={state}
		>
			{state === "ok" && href ? null : (
				// The same hold in every state before the picture, sheen and all, because "queued", "downloading" and "there is no cover" are one answer to the only question being asked: is there a sleeve here yet. Only a settled failure stops shimmering.
				<span
					className={`${styles.placeholder}${state === "failed" ? "" : " loading"}`}
					aria-hidden="true"
				>
					<DiscAlbum strokeWidth={1.5} />
				</span>
			)}

			{href && (state === "granted" || state === "ok") ? (
				// Transparent until it has loaded, which is what keeps the alt text off the screen: a browser paints it in the box the moment the element exists, and a wall of "Rastaman Vibration cover" is not a loading state.
				<img
					className={styles.image}
					src={href}
					alt={alt}
					// The queue governs how many requests start; this governs where the browser puts them among everything else on the same six connections.
					fetchPriority="low"
					decoding="async"
					draggable="false"
					onLoad={() => settle("ok")}
					onError={() => settle("failed")}
				/>
			) : null}
		</div>
	);
}
