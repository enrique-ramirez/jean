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

const knownState = (src: string | null | undefined): ArtworkState | null =>
	src ? (outcomeFor(src) ?? null) : src === null ? "failed" : null;

// The artwork endpoint 404s for a track with no embedded cover, which is a normal state rather than
// an error.
// Three gates, and none of them is `loading="lazy"`, whose answer to "is this visible" is yes for
// every row a jump scrolls past: `whenNearViewport` decides whether to ask at all, `artworkCache`
// whether the network is involved, and the artwork queue how many ask at once.
export function Artwork({
	src,
	size,
	alt = "",
	className,
	onSettled,
}: {
	// `undefined` is not known yet and holds the shimmer; `null` is there is no cover here and settles.
	src: string | null | undefined;
	size?: number | string;
	alt?: string;
	className?: string;
	onSettled?: (outcome: ArtworkOutcome) => void;
}) {
	const [state, setState] = useState<ArtworkState>(
		() => knownState(src) ?? "waiting",
	);
	const [href, setHref] = useState<string | null>(null);
	const box = useRef<HTMLDivElement | null>(null);
	const release = useRef<((outcome?: ArtworkOutcome) => void) | null>(null);

	useEffect(() => {
		const known = knownState(src);

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

		// `ok` means this address resolved earlier in this session, so the hold is not shown again -- but
		// the picture still has to be resolved: a blob URL belongs to whichever component made it and
		// was revoked when that one went away.
		setState(known ?? "waiting");
		setHref(null);

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
		// One address is one refcounted blob URL shared by every row drawing that album, so a drop this
		// component never claimed revokes a picture still on screen elsewhere.
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

				if (!live) {
					dropClaim();
					return;
				}

				setHref(url);
				setState((current) => (current === "ok" ? current : "granted"));
			} catch {
				if (!live) return;
				release.current?.("failed");
				release.current = null;
				setState("failed");
			}
		};

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
	// ever mounting one report too.
	const settledRef = useRef(onSettled);
	settledRef.current = onSettled;
	useEffect(() => {
		if (state === "ok" || state === "failed") settledRef.current?.(state);
	}, [state]);

	const classes = classNames(styles.artwork, className);

	return (
		// The only element here that outlives the picture arriving, so a gesture that began on a sleeve
		// is still on the same element when the sleeve resolves.
		<div
			ref={box}
			className={classes}
			style={size === undefined ? undefined : { width: size, height: size }}
			data-artwork={state}
		>
			{state === "ok" && href ? null : (
				<span
					className={`${styles.placeholder}${state === "failed" ? "" : " loading"}`}
					aria-hidden="true"
				>
					<DiscAlbum strokeWidth={1.5} />
				</span>
			)}

			{href && (state === "granted" || state === "ok") ? (
				// Transparent until it has loaded, which keeps the alt text off the screen: the browser
				// paints it in the box the moment the element exists.
				<img
					className={styles.image}
					src={href}
					alt={alt}
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
