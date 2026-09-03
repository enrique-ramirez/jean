import { Disc3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
	type ArtworkOutcome,
	outcomeFor,
	requestArtwork,
} from "./artworkQueue";

type ArtworkState = "waiting" | "granted" | ArtworkOutcome;

import styles from "./Artwork.module.css";

// The artwork endpoint 404s when a track has no embedded cover, which is common enough to be a normal state rather than an error. Takes a URL, not an address: where artwork lives is the source's business.
// Loading goes through the artwork queue rather than loading="lazy", whose answer to "is this visible" is yes for every row a jump scrolls past.
export function Artwork({
	src,
	size,
	alt = "",
	className,
}: {
	src: string | null | undefined;
	// Omit to let the caller's stylesheet own the box: an inline width/height beats the class that sizes the now-playing cover against the space it has.
	size?: number | string;
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
	const style = size === undefined ? undefined : { width: size, height: size };

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
			// The queue governs how many requests start; this governs where the browser puts them among everything else on the same six connections.
			fetchPriority="low"
			decoding="async"
			draggable="false"
			onLoad={() => settle("ok")}
			onError={() => settle("failed")}
		/>
	);
}
