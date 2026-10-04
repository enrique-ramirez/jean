#include "core/artwork.h"

#include "core/text.h"

#include <memory>
#include <utility>

namespace jean {

namespace {

struct Signature {
    const char* bytes;
    size_t length;
    const char* type;
};

constexpr Signature kSignatures[] = {
    {"\xFF\xD8\xFF", 3, "image/jpeg"},
    {"\x89PNG\r\n\x1A\n", 8, "image/png"},
    {"GIF87a", 6, "image/gif"},
    {"GIF89a", 6, "image/gif"},
    {"BM", 2, "image/bmp"},
};

// RIFF is a container: the type is four bytes past the length, so it is not a prefix.
constexpr size_t kWebpTypeAt = 8;
constexpr size_t kWebpTypeLength = 4;

bool beginsWith(const std::string& bytes, const char* signature, size_t length) {
    return bytes.size() >= length && bytes.compare(0, length, signature, length) == 0;
}

bool isWebp(const std::string& bytes) {
    return beginsWith(bytes, "RIFF", 4) && bytes.size() >= kWebpTypeAt + kWebpTypeLength &&
           bytes.compare(kWebpTypeAt, kWebpTypeLength, "WEBP") == 0;
}

}  // namespace

std::string trackAddressRefusal(const std::string& track) {
    if (track.empty())
        return "'track' is required";

    if (track.size() > kMaxTrackAddressLength || !isPrintable(track)) {
        return "'track' must be printable text of at most " +
               std::to_string(kMaxTrackAddressLength) + " characters";
    }

    return {};
}

std::string artworkTag(const std::string& picture) {
    return eTagFor(picture);
}

std::string imageTypeOf(const std::string& bytes) {
    for (const Signature& signature : kSignatures) {
        if (beginsWith(bytes, signature.bytes, signature.length))
            return signature.type;
    }

    return isWebp(bytes) ? "image/webp" : std::string();
}

std::string publishablePicture(std::string chosen,
                               const std::function<std::string()>& readEmbedded) {
    if (chosen.empty() || !imageTypeOf(chosen).empty())
        return chosen;

    const auto embedded = readEmbedded();
    return imageTypeOf(embedded).empty() ? chosen : embedded;
}

bool oversized(const ArtworkSource& source) {
    return source.picture ? source.picture->size() > kMaxArtworkBytes : !source.tag.empty();
}

void NowPlayingArtwork::hold(std::string picture) {
    if (picture.empty()) {
        clear();
        return;
    }

    ArtworkSource source;
    source.tag = artworkTag(picture);
    source.picture = std::make_shared<const std::string>(std::move(picture));

    const std::lock_guard<std::mutex> held(mutex_);
    held_ = std::move(source);
}

void NowPlayingArtwork::clear() {
    const std::lock_guard<std::mutex> held(mutex_);
    held_ = ArtworkSource{};
}

ArtworkSource NowPlayingArtwork::current() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return held_;
}

}  // namespace jean
