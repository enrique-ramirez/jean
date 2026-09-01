import { useQuery } from "@tanstack/react-query";

import { fetchLibraryInfo } from "@/shared/api/beefweb";

const LIBRARY_INFO_KEY = ["library", "info"];

// Which library Jean is talking to, asked once on connect. Three outcomes, and
// they are three different sentences to the user:
//
//   supported: false   no API at all -- DeaDBeeF (501), beefweb <=0.10 (404)
//   enabled: false     foobar2000 has one, unconfigured. Fixed in foobar.
//   both true          use it.
//
// Collapsing the first two into "no library" would send someone to build an
// autoplaylist when the real fix is switching their media library on.
//
// The only library call that answers without the API, which makes it the
// detector.
export function useLibraryInfo() {
	const { data, isLoading } = useQuery({
		queryKey: LIBRARY_INFO_KEY,
		queryFn: fetchLibraryInfo,
		// The library does not appear or disappear while the app is open, and
		// there is no `library` event on the update stream to tell us if it did.
		staleTime: Infinity,
		// Its *size* does change, and there is no event for that either, so drift
		// can only be noticed by asking. This is the whole reconciliation: rows are
		// keyed `library:{itemCount}`, so a changed count is a new key, a fresh load
		// and a fresh index, while an unchanged one touches nothing. Not a poll -- a
		// library grows when its owner adds music on the desktop, which is exactly
		// the trip away from this tab it fires on.
		refetchOnWindowFocus: true,
		retry: false,
	});

	const info = data ?? { supported: false, enabled: false, itemCount: 0 };

	return {
		isLoading,
		info,
		// The only question most callers have.
		hasLibraryApi: info.supported && info.enabled,
		// The one that needs its own message rather than the setup screen.
		needsLibraryEnabled: info.supported && !info.enabled,
	};
}
