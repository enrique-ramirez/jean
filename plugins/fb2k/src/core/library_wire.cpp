#include "core/library_wire.h"

#include <numeric>

using nlohmann::json;

namespace jean {

ColumnFacts factsOf(const Column& column) {
    ColumnFacts facts;
    facts.distinct = column.dictionary.values.size();
    facts.hasUnresolved = column.dictionary.find(kUnresolved).has_value();
    facts.allUnresolved = facts.distinct == 1 && facts.hasUnresolved;
    return facts;
}

size_t paddingTo(size_t alignment, size_t size) {
    return (alignment - (size % alignment)) % alignment;
}

void appendLittleEndian(std::string& out, uint64_t value, size_t bytes) {
    for (size_t byte = 0; byte < bytes; ++byte)
        out.push_back(static_cast<char>((value >> (8 * byte)) & 0xFFU));
}

json placeIds(Blob& blob, const std::vector<uint32_t>& ids, IdWidth width) {
    blob.align();

    const json placed{
        {"offset", blob.size()}, {"count", ids.size()}, {"width", static_cast<int>(width)}};

    blob.appendIds(ids, width);
    return placed;
}

json placeDictionary(Blob& blob, const std::vector<std::string>& values) {
    const size_t length =
        std::accumulate(values.begin(), values.end(), size_t{0},
                        [](size_t total, const std::string& v) { return total + v.size(); });

    blob.align();
    const json text{{"offset", blob.size()}, {"length", length}};
    blob.appendText(values, length);

    const IdWidth width = widthFor(length + 1);
    blob.align();
    const json ends{
        {"offset", blob.size()}, {"count", values.size()}, {"width", static_cast<int>(width)}};
    blob.appendEnds(values, width);

    return json{{"text", text}, {"ends", ends}};
}

json placeColumn(Blob& blob, const std::vector<uint32_t>& ids, size_t distinct,
                 const std::vector<std::string>& values, const ColumnFacts& facts) {
    return json{{"ids", placeIds(blob, ids, widthFor(distinct))},
                {"dict", placeDictionary(blob, values)},
                {"distinct", facts.distinct},
                {"hasUnresolved", facts.hasUnresolved},
                {"allUnresolved", facts.allUnresolved}};
}

Framing frameOf(const json& header, size_t blobBytes) {
    // nlohmann's dump() throws on text that is not valid UTF-8, and a column expression comes
    // from a client, so the replacement handler keeps a malformed one from becoming a 500.
    std::string text = header.dump(-1, ' ', false, json::error_handler_t::replace);
    text.append(paddingTo(kAlignment, kMagicBytes + kHeaderLengthBytes + text.size()), ' ');

    Framing framing;
    framing.blobBytes = blobBytes;
    framing.prefix.reserve(kMagicBytes + kHeaderLengthBytes + text.size());
    framing.prefix.append(kMagic, kMagicBytes);
    appendLittleEndian(framing.prefix, text.size(), kHeaderLengthBytes);
    framing.prefix.append(text);
    return framing;
}

}  // namespace jean
