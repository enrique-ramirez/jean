import { useQuery } from "@tanstack/react-query";

import { fetchLibraryInfo } from "@/shared/api/beefweb";

const LIBRARY_INFO_KEY = ["library", "info"];

export function useLibraryInfo() {
	const { data, isLoading } = useQuery({
		queryKey: LIBRARY_INFO_KEY,
		queryFn: fetchLibraryInfo,
		// There is no `library` event on the update stream: neither the library's existence nor its size is ever pushed, so a window focus is the only reconciliation.
		staleTime: Infinity,
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
