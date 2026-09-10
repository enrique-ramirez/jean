#include "core/artwork.h"

#include "core/text.h"

namespace jean {

namespace {

// FNV-1a. The basis and the prime are the algorithm's own and not a choice made here.
constexpr uint64_t kFoldBasis = 14695981039346656037ULL;
constexpr uint64_t kFoldPrime = 1099511628211ULL;

constexpr size_t kHexDigitsPerByte = 2;

uint64_t foldBytes(uint64_t digest, const char* bytes, size_t length) {
    for (size_t at = 0; at < length; ++at) {
        digest ^= static_cast<unsigned char>(bytes[at]);
        digest *= kFoldPrime;
    }
    return digest;
}

uint64_t foldText(uint64_t digest, const std::string& text) {
    return foldBytes(digest, text.data(), text.size());
}

uint64_t foldNumber(uint64_t digest, uint64_t value) {
    for (size_t byte = 0; byte < sizeof(value); ++byte) {
        digest ^= (value >> (byte * 8U)) & 0xFFU;
        digest *= kFoldPrime;
    }
    return digest;
}

std::string quotedHex(uint64_t digest) {
    constexpr char kDigits[] = "0123456789abcdef";

    std::string text(sizeof(digest) * kHexDigitsPerByte, '0');
    for (size_t at = text.size(); at > 0; --at) {
        text[at - 1] = kDigits[digest & 0xFU];
        digest >>= 4U;
    }

    return "\"" + text + "\"";
}

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

std::string artworkTag(const std::vector<ArtworkFile>& files) {
    uint64_t digest = kFoldBasis;

    for (const ArtworkFile& file : files) {
        digest = foldText(digest, file.path);
        digest = foldNumber(digest, file.size);
        digest = foldNumber(digest, file.modified);
    }

    return quotedHex(digest);
}

std::string artworkTagOfBytes(const std::string& bytes) {
    return quotedHex(foldText(kFoldBasis, bytes));
}

std::string imageTypeOf(const std::string& bytes) {
    for (const Signature& signature : kSignatures) {
        if (beginsWith(bytes, signature.bytes, signature.length))
            return signature.type;
    }

    return isWebp(bytes) ? "image/webp" : std::string();
}

}  // namespace jean
