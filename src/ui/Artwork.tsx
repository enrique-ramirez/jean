import { Disc3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
	type ArtworkOutcome,
	outcomeFor,
	requestArtwork,
} from "./artworkQueue";

// Waiting for a turn in the queue, granted one, or settled either way.
type ArtworkState = "waiting" | "granted" | ArtworkOutcome;

import styles from "./Artwork.module.css";

// The artwork endpoint 404s when a track has no embedded cover, which is common
// enough that it is a normal state rather than an error.
// Takes a URL, not an address. Where artwork lives is the source's business:
// a playlist addresses it by index, the media library by path, and the status
// bar by whatever the player is currently on.
//
// Loading goes through `artworkQueue.js` rather than `loading="lazy"`, because
// the browser's answer to "is this visible" is yes for every row a jump scrolls
// past. Three states rather than two: waiting for a turn is a bare tile, and the
// disc icon means the player has said there is no cover.
export function Artwork({
	src,
	size,
	alt = "",
	className,
}: {
	src: string | null | undefined;
	size: number | string;
	alt?: string;
	className?: string;
}) {
	const [state, setState] = useState<ArtworkState>(() =>
		src ? (outcomeFor(src) ?? "waiting") : "failed",
	);
	const image = useRef<HTMLImageElement | null>(null);
	const release = useRef<((outcome?: ArtworkOutcome) => void) | null>(null);

	useEffect(() => {
		const known = src ? outcomeFor(src) : "failed";
		if (known) {
			setState(known);
			return;
		}

		setState("waiting");
		release.current = requestArtwork(src as string, () => setState("granted"));

		return () => {
			// Detaching an <img> mid-load does not stop the request -- the socket
			// stays busy until the response arrives, which is the whole thing this is
			// avoiding. Clearing the src is what actually abandons it.
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
	const style = { width: size, height: size };

	if (state === "failed") {
		return (
			<div
				className={`${classes} ${styles.fallback}`}
				style={style}
				aria-hidden="true"
			>
				<Disc3
					size={typeof size === "number" ? Math.round(size * 0.42) : 24}
					strokeWidth={1.5}
				/>
			</div>
		);
	}

	if (state === "waiting")
		return <div className={classes} style={style} aria-hidden="true" />;

	return (
		<img
			ref={image}
			className={classes}
			style={style}
			src={src ?? undefined}
			alt={alt}
			// The queue governs how many of these Jean starts; this governs where the
			// browser puts them among everything else on the same six connections. A
			// cover is never more urgent than a transport command.
			fetchPriority="low"
			decoding="async"
			draggable="false"
			onLoad={() => settle("ok")}
			onError={() => settle("failed")}
		/>
	);
}
