#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

// One cover, addressed by the library-relative path the snapshot published for a track.
// Pure: this half decides what a client may ask for, what validates the copy it already
// holds, and what type the bytes may be published as, and fb2k/ asks the player.
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

struct ArtworkFile {
    std::string path;
    uint64_t size = 0;
    uint64_t modified = 0;
};

// Strong, quoted, and it publishes no path: a fold over each source's path, size and
// modification time. The stat is the whole point, for the reason CLAUDE.md, *Facts about
// the player*, gives.
std::string artworkTag(const std::vector<ArtworkFile>& files);

// For a source naming no file. Costs a read, and there is nothing cheaper to validate against.
std::string artworkTagOfBytes(const std::string& bytes);

// The Content-Type these bytes may be published as, and empty for anything else. Never
// image/svg+xml, for the reason CLAUDE.md, *Facts about the player*, gives.
std::string imageTypeOf(const std::string& bytes);

// The tag arrives with the answer and `read` is called only once the client's copy is known
// to be stale, so a conditional request costs a stat and never a picture. A null `read` is
// how "the player has no cover for that track" is said.
struct ArtworkSource {
    std::string tag;
    std::function<std::string()> read;
};

using ArtworkReader = std::function<ArtworkSource(const std::string& track)>;

}  // namespace jean
