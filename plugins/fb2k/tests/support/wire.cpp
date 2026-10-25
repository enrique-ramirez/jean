#include "support/wire.h"

#include "core/library.h"
#include "third_party/doctest.h"

#include <algorithm>
#include <functional>
#include <limits>
#include <ranges>

namespace jean::testing {

namespace {

constexpr size_t kMagicBytes = 4;
constexpr size_t kHeaderLengthBytes = 4;

}  // namespace

uint64_t littleEndianAt(const std::string& bytes, size_t offset, size_t width) {
    uint64_t value = 0;
    for (size_t byte = 0; byte < width; ++byte)
        value |= static_cast<uint64_t>(static_cast<unsigned char>(bytes[offset + byte]))
                 << (8 * byte);

    return value;
}

Wire decode(const std::string& message) {
    REQUIRE(message.size() >= kMagicBytes + kHeaderLengthBytes);
    REQUIRE(message.substr(0, kMagicBytes) == "JLIB");

    const auto headerLength =
        static_cast<size_t>(littleEndianAt(message, kMagicBytes, kHeaderLengthBytes));

    Wire wire;
    wire.blobStart = kMagicBytes + kHeaderLengthBytes + headerLength;
    REQUIRE(message.size() >= wire.blobStart);

    wire.header =
        nlohmann::json::parse(message.substr(kMagicBytes + kHeaderLengthBytes, headerLength));
    wire.blob = message.substr(wire.blobStart);
    return wire;
}

std::vector<uint32_t> ids(const Wire& wire, const nlohmann::json& placed) {
    const auto offset = placed.at("offset").get<size_t>();
    const auto count = placed.at("count").get<size_t>();
    const auto width = placed.at("width").get<size_t>();

    // A width of zero would read one byte for every id, and a run past the end of the blob
    // would read whatever the allocator left there: both are a wrong header, not an answer.
    REQUIRE((width == 1 || width == 2 || width == 4));
    REQUIRE(offset + (count * width) <= wire.blob.size());

    std::vector<uint32_t> values;
    values.reserve(count);
    for (size_t index = 0; index < count; ++index)
        values.push_back(
            static_cast<uint32_t>(littleEndianAt(wire.blob, offset + (index * width), width)));

    return values;
}

std::vector<std::string> dictionary(const Wire& wire, const nlohmann::json& dict) {
    const auto textOffset = dict.at("text").at("offset").get<size_t>();
    const auto ends = ids(wire, dict.at("ends"));

    std::vector<std::string> values;
    size_t start = 0;
    for (const uint32_t end : ends) {
        REQUIRE(end >= start);
        REQUIRE(textOffset + end <= wire.blob.size());

        values.push_back(wire.blob.substr(textOffset + start, end - start));
        start = end;
    }

    return values;
}

std::vector<std::string> column(const Wire& wire, const nlohmann::json& placed) {
    const auto values = dictionary(wire, placed.at("dict"));

    std::vector<std::string> read;
    for (const uint32_t id : ids(wire, placed.at("ids"))) {
        REQUIRE(id < values.size());
        read.push_back(values[id]);
    }

    return read;
}

nlohmann::json namedColumn(const Wire& wire, const std::string& name) {
    const auto& columns = wire.header.at("columns");
    const auto found =
        std::find_if(columns.begin(), columns.end(),
                     [&name](const nlohmann::json& placed) { return placed.at("name") == name; });

    return found == columns.end() ? nlohmann::json::object() : *found;
}

std::vector<std::string> columnNames(const nlohmann::json& header) {
    std::vector<std::string> names;
    for (const auto& placed : header.at("columns"))
        names.push_back(placed.at("name").get<std::string>());

    return names;
}

}  // namespace jean::testing
