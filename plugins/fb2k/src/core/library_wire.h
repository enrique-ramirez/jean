#pragma once

#include "core/library.h"
#include "third_party/json.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

// The JLIB framing the rows route writes: a magic number, a length-prefixed JSON header and a
// blob of ids and dictionaries the header places by offset.
namespace jean {

// `new Int32Array(buffer, offset, n)` in a browser throws unless the byte offset is a
// multiple of four, and a client's offsets are absolute, so the header is padded to keep the
// blob's own start aligned as well as every section inside it.
constexpr size_t kAlignment = 4;

constexpr char kMagic[] = "JLIB";
constexpr size_t kMagicBytes = sizeof(kMagic) - 1;
constexpr size_t kHeaderLengthBytes = 4;

struct ColumnFacts {
    size_t distinct = 0;
    bool hasUnresolved = false;
    bool allUnresolved = false;
};

ColumnFacts factsOf(const Column& column);

size_t paddingTo(size_t alignment, size_t size);

void appendLittleEndian(std::string& out, uint64_t value, size_t bytes);

class Blob {
public:
    Blob() = default;
    explicit Blob(std::string& out) : out_(&out) {}

    size_t size() const { return size_; }

    void align() { pad(paddingTo(kAlignment, size_)); }

    void appendIds(const std::vector<uint32_t>& ids, IdWidth width) {
        const auto bytes = static_cast<size_t>(width);
        if (out_ != nullptr)
            for (const uint32_t id : ids)
                appendLittleEndian(*out_, id, bytes);
        size_ += ids.size() * bytes;
    }

    void appendText(const std::vector<std::string>& values, size_t length) {
        if (out_ != nullptr)
            for (const std::string& value : values)
                out_->append(value);
        size_ += length;
    }

    void appendEnds(const std::vector<std::string>& values, IdWidth width) {
        const auto bytes = static_cast<size_t>(width);
        if (out_ != nullptr) {
            size_t end = 0;
            for (const std::string& value : values) {
                end += value.size();
                appendLittleEndian(*out_, end, bytes);
            }
        }
        size_ += values.size() * bytes;
    }

private:
    void pad(size_t count) {
        if (out_ != nullptr)
            out_->append(count, '\0');
        size_ += count;
    }

    std::string* out_ = nullptr;
    size_t size_ = 0;
};

nlohmann::json placeIds(Blob& blob, const std::vector<uint32_t>& ids, IdWidth width);

nlohmann::json placeDictionary(Blob& blob, const std::vector<std::string>& values);

nlohmann::json placeColumn(Blob& blob, const std::vector<uint32_t>& ids, size_t distinct,
                           const std::vector<std::string>& values, const ColumnFacts& facts);

struct Framing {
    std::string prefix;
    size_t blobBytes = 0;

    size_t total() const { return prefix.size() + blobBytes; }
};

Framing frameOf(const nlohmann::json& header, size_t blobBytes);

template <typename Describe>
Framing measured(const Describe& describe) {
    Blob blob;
    const nlohmann::json header = describe(blob);
    return frameOf(header, blob.size());
}

template <typename Describe>
std::string written(const Describe& describe) {
    const Framing framing = measured(describe);

    std::string out;
    out.reserve(framing.total());
    out.append(framing.prefix);

    Blob blob(out);
    describe(blob);
    return out;
}

}  // namespace jean
