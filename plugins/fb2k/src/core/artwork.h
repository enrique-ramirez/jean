#pragma once

#include <cstddef>
#include <functional>
#include <mutex>
#include <string>

// Two covers: one addressed by the library-relative path the snapshot published for a track,
// and one addressed by nothing, held for whatever the player is showing right now. Pure: this
// half decides what a client may ask for, what validates the copy it already holds, and what
// type the bytes may be published as, and fb2k/ asks the player and feeds it.
namespace jean {

// A cover is a JPEG or a PNG of a few hundred kilobytes, and a scan of a gatefold is a few
// megabytes. A bound on the response and not on the read: foobar2000's album art loader has
// the whole picture in memory before anything here sees a byte of it.
constexpr size_t kMaxArtworkBytes = size_t{16} * 1024 * 1024;

// Longer than any filesystem produces a path, and the whole of a client's say in this request.
constexpr size_t kMaxTrackAddressLength = 4096;

// Empty when the address is usable. The address never becomes a path this component builds
// anything from -- it is matched against what the player reported and nothing else -- so
// what is checked here is length and printability rather than shape.
std::string trackAddressRefusal(const std::string& track);

// Strong, quoted, and a fold of the picture itself: nothing the player can be asked names
// the file a cover came from until the cover has been loaded, for the reason ARCHITECTURE.md,
// *Facts about the player*, gives.
std::string artworkTag(const std::string& picture);

// The Content-Type these bytes may be published as, and empty for anything else. Never
// image/svg+xml, for the reason ARCHITECTURE.md, *Facts about the player*, gives.
std::string imageTypeOf(const std::string& bytes);

struct ArtworkSource {
    std::string tag;
    std::string picture;
};

using ArtworkReader = std::function<ArtworkSource(const std::string& track)>;

// The cover of whatever is playing, addressed by nothing: held rather than looked up, so a
// route serving it never touches the reader above. `hold` folds the picture once, on whatever
// thread the player's own now-playing loader calls back on; `current` is read from a connection
// thread. `PlayerStateStore`'s own shape, for the same reason: a value several threads share.
class NowPlayingArtwork {
public:
    NowPlayingArtwork() = default;

    void hold(std::string picture);

    void clear();

    ArtworkSource current() const;

    NowPlayingArtwork(const NowPlayingArtwork&) = delete;
    NowPlayingArtwork& operator=(const NowPlayingArtwork&) = delete;

private:
    mutable std::mutex mutex_;
    ArtworkSource held_;
};

}  // namespace jean
