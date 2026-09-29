import { type QueryKey, skipToken, useQuery } from "@tanstack/react-query";

export const useCacheOnly = <T>(queryKey: QueryKey) =>
	useQuery<T>({
		queryKey,
		queryFn: skipToken,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
	});
