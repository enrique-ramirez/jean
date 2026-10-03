import { useCallback, useSyncExternalStore } from "react";

import {
	dirtyGuard,
	type LeaveGuard,
	leaveGuarded,
	onGuardGone,
} from "@/shared/hooks/useLeaveGuard";

const listeners = new Set<() => void>();
const notify = () => {
	for (const listener of [...listeners]) listener();
};

let held: string | null = null;
let asked: LeaveGuard | null = null;
let own: string | null = null;
// `history.length` counts forward entries too and only a push grows it, so growth tells a push from
// a traversal. A push at the cap (Chrome and Firefox keep 50) drops the oldest entry and a push after
// Back drops the forward ones, and the length stays: either reads as a traversal.
let knownLength = history.length;
let returningTo: string | null = null;

const hashOf = (url: string) => new URL(url).hash;

const release = () => {
	held = null;
	asked = null;
	notify();
};

// Setting `location.hash` pushes an entry and fires `hashchange` later.
function assignHash(next: string) {
	const before = window.location.hash;
	window.location.hash = next;
	if (window.location.hash !== before) own = window.location.hash;
	knownLength = history.length;
}

// A browser moves the address before it fires `hashchange`, and fires listeners in the order they
// were added. This one is added when the module loads, ahead of every one `subscribe` adds.
const holdRouteWhileAsking = (event: HashChangeEvent) => {
	const isPush = history.length > knownLength;
	knownLength = history.length;
	const wasReturningTo = returningTo;
	returningTo = null;
	if (wasReturningTo !== null && hashOf(event.newURL) === wasReturningTo) {
		held = null;
		asked = null;
		return;
	}
	if (hashOf(event.newURL) === own) {
		own = null;
		return;
	}
	const guard = dirtyGuard();
	if (!guard) {
		held = null;
		asked = null;
		return;
	}
	if (held !== null) return;

	held = hashOf(event.oldURL);
	asked = guard;
	guard.ask(release, () => {
		if (isPush) {
			// A script can only go back from a pushed entry, which stays as a forward one.
			returningTo = hashOf(event.oldURL);
			history.go(-1);
			return;
		}
		history.pushState(null, "", event.oldURL);
		knownLength = history.length;
		held = null;
		asked = null;
	});
};

const askBeforeFollowingLink = (event: MouseEvent) => {
	if (
		event.defaultPrevented ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey ||
		!dirtyGuard()
	)
		return;
	const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
		'a[href^="#"]:not([target], [download])',
	);
	if (!link || link.hash === window.location.hash) return;
	event.preventDefault();
	event.stopPropagation();
	leaveGuarded(() => assignHash(link.hash));
};

window.addEventListener("hashchange", holdRouteWhileAsking);
document.addEventListener("click", askBeforeFollowingLink, true);
const stopWatchingGuards = onGuardGone((guard) => {
	if (guard === asked) release();
});
// Vite evaluates a reloaded module again without removing the listeners of the old one.
import.meta.hot?.dispose(() => {
	window.removeEventListener("hashchange", holdRouteWhileAsking);
	document.removeEventListener("click", askBeforeFollowingLink, true);
	stopWatchingGuards();
});

const subscribe = (onChange: () => void) => {
	listeners.add(onChange);
	window.addEventListener("hashchange", onChange);
	return () => {
		listeners.delete(onChange);
		window.removeEventListener("hashchange", onChange);
	};
};

export function useHashRoute(): [
	string,
	(next: string, options?: { replace?: boolean }) => void,
] {
	const hash = useSyncExternalStore(
		subscribe,
		() => held ?? window.location.hash,
	);

	const navigate = useCallback(
		(next: string, options?: { replace?: boolean }) =>
			leaveGuarded(() => {
				held = null;
				asked = null;
				if (!options?.replace) {
					assignHash(next);
					return;
				}

				// `replaceState` fires no `hashchange`, unlike a plain hash assignment, so the
				// subscribers this hook hands out have to be told by hand.
				history.replaceState(
					null,
					"",
					`#${next.startsWith("/") ? next : `/${next}`}`,
				);
				notify();
			}),
		[],
	);

	return [hash.replace(/^#\/?/, ""), navigate];
}
