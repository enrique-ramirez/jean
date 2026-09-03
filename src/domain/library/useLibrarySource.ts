import { useQuery } from "@tanstack/react-query";

import { fetchLibraryInfo } from "@/shared/api/beefweb";

const LIBRARY_INFO_KEY = ["library", "info"];

// Which library Jean is talking to. `supported: false` is no library API at all (DeaDBeeF answers 501, beefweb 0.10 and older 404); `supported` with `enabled: false` is a foobar2000 media library that is switched off, which is fixed in foobar2000 rather than here.
// The only library call that answers without the API, which makes it the detector.
export function useLibraryInfo() {
	const { data, isLoading } = useQuery({
		queryKey: LIBRARY_INFO_KEY,
		queryFn: fetchLibraryInfo,
		// There is no `library` event on the update stream, so neither the library's existence nor its size is ever pushed.
		staleTime: Infinity,
		// The whole reconciliation: rows are keyed `library:{itemCount}`, so a changed count is a new key and a fresh load, and an unchanged one touches nothing.
		refetchOnWindowFocus: true,
		retry: false,
	});

	const info = data ?? { supported: false, enabled: false, itemCount: 0 };

	return {
		isLoading,
		info,
		hasLibraryApi: info.supported && info.enabled,
		needsLibraryEnabled: info.supported && !info.enabled,
	};
}
