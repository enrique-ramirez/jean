import { useQuery } from '@tanstack/react-query'

import { fetchLibraryInfo } from '../api/beefweb.js'

export const LIBRARY_INFO_KEY = ['library', 'info']

// Which library Jean is talking to, asked once on connect.
//
// Three outcomes, and they are three different sentences to the user:
//
//   supported: false   this player has no media library API at all. DeaDBeeF,
//                      where the endpoints are 501, and every beefweb up to
//                      0.10, where they are 404. Both mean: use an
//                      autoplaylist.
//   enabled: false     foobar2000 has one and the user has not configured it.
//                      Fixable in foobar's own preferences, not in Jean, and
//                      not by making an autoplaylist.
//   both true          use it.
//
// Collapsing the first two into "no library" would send someone to build an
// autoplaylist when the real fix is switching their media library on.
//
// *Measured*: 8 ms against a 30,441-track library, so this is free enough to do
// before anything else. It is also the only library call that answers on a
// player without the API -- everything else 501s -- which is what makes it the
// detector.
export function useLibraryInfo() {
  const { data, isLoading } = useQuery({
    queryKey: LIBRARY_INFO_KEY,
    queryFn: fetchLibraryInfo,
    // The library does not appear or disappear while the app is open, and
    // there is no `library` event on the update stream to tell us if it did.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const info = data ?? { supported: false, enabled: false, itemCount: 0 }

  return {
    isLoading,
    info,
    // The only question most callers have.
    hasLibraryApi: info.supported && info.enabled,
    // The one that needs its own message rather than the setup screen.
    needsLibraryEnabled: info.supported && !info.enabled,
  }
}
