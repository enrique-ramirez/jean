#include "support/wire.h"

#include "core/library.h"
#include "third_party/doctest.h"

#include <algorithm>
#include <functional>
#include <limits>

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

namespace {

constexpr uint32_t kNoIdYet = std::numeric_limits<uint32_t>::max();

void takeFacts(HeldColumn& column, const nlohmann::json& placed) {
    column.distinct = placed.at("distinct").get<size_t>();
    column.hasUnresolved = placed.at("hasUnresolved").get<bool>();
    column.allUnresolved = placed.at("allUnresolved").get<bool>();
}

HeldColumn heldColumn(const Wire& wire, const nlohmann::json& placed) {
    HeldColumn column;
    column.dictionary = dictionary(wire, placed.at("dict"));
    column.ids = ids(wire, placed.at("ids"));
    takeFacts(column, placed);
    return column;
}

void checkAscendingBelow(const std::vector<uint32_t>& ordinals, size_t count) {
    REQUIRE(std::adjacent_find(ordinals.begin(), ordinals.end(), std::greater_equal<>()) ==
            ordinals.end());
    REQUIRE((ordinals.empty() || ordinals.back() < count));
}

size_t widthBelow(size_t count) {
    return static_cast<size_t>(widthFor(count));
}

struct Patch {
    HeldColumn* column = nullptr;
    const nlohmann::json* placed = nullptr;
    bool isSpine = false;
};

std::vector<HeldColumn*> everyColumn(HeldLibrary& library) {
    std::vector<HeldColumn*> all;
    for (auto& [name, column] : library.spine)
        all.push_back(&column);
    for (auto& [name, column] : library.columns)
        all.push_back(&column);
    return all;
}

}  // namespace

HeldLibrary held(const Wire& snapshot) {
    const auto& header = snapshot.header;
    REQUIRE(header.at("kind") == "snapshot");

    HeldLibrary library;
    library.structure = header.at("structure").get<uint64_t>();
    library.revision = header.at("revision").get<uint64_t>();
    library.trackCount = header.at("trackCount").get<size_t>();

    for (const auto& [name, placed] : header.at("spine").items())
        library.spine[name] = heldColumn(snapshot, placed);
    for (const auto& placed : header.at("columns"))
        library.columns[placed.at("name").get<std::string>()] = heldColumn(snapshot, placed);

    return library;
}

void applyChanges(HeldLibrary& library, const Wire& changes) {
    const auto& header = changes.header;
    const bool splice = header.at("kind") == "splice";
    REQUIRE((splice || header.at("kind") == "delta"));
    REQUIRE(header.at("since") == library.revision);

    const auto trackCount = header.at("trackCount").get<size_t>();
    std::vector<uint32_t> removed;
    std::vector<uint32_t> inserted;

    if (splice) {
        REQUIRE(header.at("sinceStructure") == library.structure);
        removed = ids(changes, header.at("removed"));
        inserted = ids(changes, header.at("inserted"));

        REQUIRE(trackCount + removed.size() >= inserted.size());
        const size_t oldCount = trackCount - inserted.size() + removed.size();
        REQUIRE(oldCount == library.trackCount);
        const auto appends = [](const nlohmann::json& placed) {
            return placed.at("dict").at("ends").at("count").get<size_t>() > 0;
        };
        const auto& spineEntries = header.at("spine");
        const auto& columnEntries = header.at("columns");
        CHECK((!removed.empty() || !inserted.empty() ||
               std::any_of(spineEntries.begin(), spineEntries.end(), appends) ||
               std::any_of(columnEntries.begin(), columnEntries.end(), appends)));

        checkAscendingBelow(removed, oldCount);
        checkAscendingBelow(inserted, trackCount);
        CHECK(header.at("removed").at("width") == widthBelow(oldCount));
        CHECK(header.at("inserted").at("width") == widthBelow(trackCount));
    } else {
        REQUIRE(header.at("structure") == library.structure);
        REQUIRE(trackCount == library.trackCount);
    }

    std::vector<Patch> patches;
    for (const auto& [name, placed] : header.at("spine").items()) {
        REQUIRE(library.spine.count(name) == 1);
        patches.push_back({&library.spine.at(name), &placed, true});
    }
    for (const auto& placed : header.at("columns")) {
        const auto name = placed.at("name").get<std::string>();
        REQUIRE(library.columns.count(name) == 1);
        patches.push_back({&library.columns.at(name), &placed, false});
    }

    if (splice && !inserted.empty()) {
        CHECK(header.at("spine").size() == library.spine.size());
        CHECK(header.at("columns").size() == library.columns.size());
    } else if (splice) {
        for (const auto& [name, placed] : header.at("spine").items())
            CHECK(placed.at("ordinals").at("count") == 0);
    }

    for (const Patch& patch : patches) {
        const auto& dict = patch.placed->at("dict");
        REQUIRE(dict.at("base") == patch.column->dictionary.size());

        const auto appended = dictionary(changes, dict);
        patch.column->dictionary.insert(patch.column->dictionary.end(), appended.begin(),
                                        appended.end());
        takeFacts(*patch.column, *patch.placed);
        CHECK(patch.column->distinct == patch.column->dictionary.size());
    }

    for (HeldColumn* column : everyColumn(library)) {
        for (auto at = removed.rbegin(); at != removed.rend(); ++at)
            column->ids.erase(column->ids.begin() + *at);
        for (const uint32_t ordinal : inserted)
            column->ids.insert(column->ids.begin() + ordinal, kNoIdYet);
    }

    for (const Patch& patch : patches) {
        const auto ordinals = ids(changes, patch.placed->at("ordinals"));
        const auto written = ids(changes, patch.placed->at("ids"));
        REQUIRE(written.size() == ordinals.size());
        checkAscendingBelow(ordinals, trackCount);
        CHECK(patch.placed->at("ordinals").at("width") == widthBelow(trackCount));
        CHECK(patch.placed->at("ids").at("width") == widthBelow(patch.column->distinct));

        if (splice && patch.isSpine)
            CHECK(ordinals == inserted);

        REQUIRE(std::all_of(written.begin(), written.end(), [&patch](uint32_t id) {
            return id < patch.column->dictionary.size();
        }));
        for (size_t at = 0; at < ordinals.size(); ++at)
            patch.column->ids[ordinals[at]] = written[at];
    }

    for (HeldColumn* column : everyColumn(library))
        REQUIRE(std::count(column->ids.begin(), column->ids.end(), kNoIdYet) == 0);

    library.structure = header.at("structure").get<uint64_t>();
    library.revision = header.at("revision").get<uint64_t>();
    library.trackCount = trackCount;
}

std::vector<std::vector<std::string>> rowsOf(const HeldLibrary& library,
                                             const std::vector<std::string>& declared) {
    std::vector<const HeldColumn*> order;
    for (const char* name : kSpineFields)
        order.push_back(&library.spine.at(name));
    for (const std::string& name : declared)
        order.push_back(&library.columns.at(name));

    for (const HeldColumn* column : order) {
        REQUIRE(column->ids.size() == library.trackCount);
        REQUIRE(std::all_of(column->ids.begin(), column->ids.end(),
                            [column](uint32_t id) { return id < column->dictionary.size(); }));
    }

    std::vector<std::vector<std::string>> rows(library.trackCount);
    for (size_t row = 0; row < library.trackCount; ++row)
        for (const HeldColumn* column : order)
            rows[row].push_back(column->dictionary[column->ids[row]]);
    return rows;
}

void checkSameLibrary(const HeldLibrary& patched, const HeldLibrary& exported) {
    CHECK(patched.structure == exported.structure);
    CHECK(patched.revision == exported.revision);
    CHECK(patched.trackCount == exported.trackCount);

    const auto sameColumns = [](const std::map<std::string, HeldColumn>& patchedColumns,
                                const std::map<std::string, HeldColumn>& exportedColumns) {
        REQUIRE(patchedColumns.size() == exportedColumns.size());
        for (const auto& [name, column] : exportedColumns) {
            CAPTURE(name);
            REQUIRE(patchedColumns.count(name) == 1);
            const HeldColumn& mine = patchedColumns.at(name);
            CHECK(mine.dictionary == column.dictionary);
            CHECK(mine.ids == column.ids);
            CHECK(mine.distinct == column.distinct);
            CHECK(mine.hasUnresolved == column.hasUnresolved);
            CHECK(mine.allUnresolved == column.allUnresolved);
        }
    };

    sameColumns(patched.spine, exported.spine);
    sameColumns(patched.columns, exported.columns);
}

}  // namespace jean::testing
