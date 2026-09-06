import { DiscAlbum } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
	type ArtworkOutcome,
	outcomeFor,
	requestArtwork,
} from "./artworkQueue";

type ArtworkState = "waiting" | "granted" | ArtworkOutcome;

import styles from "./Artwork.module.css";

// What is already known about an address, or null where the answer is still open. A cover this session has resolved before is settled without another request, and `null` -- there is no cover here -- is settled before there is anything to ask.
const settled = (src: string | null | undefined): ArtworkState | null =>
	src ? (outcomeFor(src) ?? null) : src === null ? "failed" : null;

// Every cover in the app, at every size: the status bar, the wheel, an album group, a row, a shelf card. One component because they are one thing, and because a cover that arrives differently in six places is six different flickers.
// The artwork endpoint 404s when a track has no embedded cover, which is common enough to be a normal state rather than an error. Takes a URL, not an address: where artwork lives is the source's business.
// Loading goes through the artwork queue rather than loading="lazy", whose answer to "is this visible" is yes for every row a jump scrolls past.
export function Artwork({
	src,
	size,
	alt = "",
	className,
}: {
	/** `undefined` is *not known yet* and holds the shimmer; `null` is *there is no cover here* and settles. A caller that has an address always has a string, so the two are worth telling apart: a wheel slot the player has not named is loading, and the track before the first one is not. */
	src: string | null | undefined;
	// Omit to let the caller's stylesheet own the box: an inline width/height beats the class that sizes the now-playing cover against the space it has.
	size?: number | string;
	alt?: string;
	className?: string;
}) {
	const [state, setState] = useState<ArtworkState>(
		() => settled(src) ?? "waiting",
	);
	const image = useRef<HTMLImageElement | null>(null);
	const release = useRef<((outcome?: ArtworkOutcome) => void) | null>(null);

	useEffect(() => {
		const known = settled(src);
		if (known) {
			setState(known);
			return;
		}

		setState("waiting");
		// No address to ask for yet, and so nothing to release: the hold stands until one arrives.
		if (!src) return;

		release.current = requestArtwork(src, () => setState("granted"));

		return () => {
			// Detaching an <img> mid-load does not stop the request; the socket stays busy until the response arrives, and clearing the src is what abandons it.
			if (image.current && !image.current.complete)
				image.current.removeAttribute("src");
			release.current?.();
			release.current = null;
		};
	}, [src]);

	const settle = (outcome: ArtworkOutcome) => {
		release.current?.(outcome);
		release.current = null;
		setState(outcome);
	};

	const classes = [styles.artwork, className].filter(Boolean).join(" ");

	return (
		// The box, and the only element in here that outlives the picture arriving. A caller's class lands on this, so its size, its rounding and its shadow are settled before anything is known about the cover -- and a gesture that began on a sleeve is still on the same element when the sleeve resolves.
		<div
			className={classes}
			style={size === undefined ? undefined : { width: size, height: size }}
			data-artwork={state}
		>
			{state === "ok" ? null : (
				// The same hold in every state before the picture, sheen and all, because "queued", "downloading" and "there is no cover" are one answer to the only question being asked: is there a sleeve here yet. Only a settled failure stops shimmering.
				<span
					className={`${styles.placeholder}${state === "failed" ? "" : " loading"}`}
					aria-hidden="true"
				>
					<DiscAlbum strokeWidth={1.5} />
				</span>
			)}

			{state === "granted" || state === "ok" ? (
				// Transparent until it has loaded, which is what keeps the alt text off the screen: a browser paints it in the box the moment the element exists, and a wall of "Rastaman Vibration cover" is not a loading state.
				<img
					ref={image}
					className={styles.image}
					src={src ?? undefined}
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
