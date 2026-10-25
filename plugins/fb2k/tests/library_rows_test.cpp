#include "third_party/doctest.h"

#include "core/library.h"
#include "core/library_rows.h"
#include "support/fixtures.h"
#include "support/library_window.h"
#include "support/wire.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kAlbum[] = "%album%";
constexpr char kTitle[] = "%title%";
constexpr char kPlays[] = "%play_count%";
constexpr char kComment[] = "%comment%";

constexpr uint64_t kStructure = 41;
constexpr uint64_t kRevision = 7;

// The albums' bytewise order is not their alphabetical one, nor the order a window meets them
// in: "Zebra" sorts before "apple", and "É" is a two-byte character sorting after every ASCII
// letter. The play counts' bytewise order is not their numeric one.
Snapshot eightTracks() {
    Snapshot snapshot = snapshotOf({kAlbum, kTitle, kPlays, kComment},
                                   {
                                       {"a/", "01.flac", "0", "Zebra", "One", "?", "?"},
                                       {"a/", "02.flac", "0", "Zebra", "Two", "3", "?"},
                                       {"b/", "01.flac", "0", "apple", "Three", "?", "?"},
                                       {"b/", "01.flac", "1", "apple", "Four", "12", "?"},
                                       {"c/", "01.flac", "0", "Éclair", "Five", "7", "?"},
                                       {"c/", "02.flac", "0", "zoo", "Six", "?", "?"},
                                       {"d/", "01.flac", "0", "", "Seven", "1", "?"},
                                       {"d/", "02.flac", "0", "Mango", "Eight", "5", "?"},
                                   });
    snapshot.structure = kStructure;
    snapshot.revision = kRevision;
    return snapshot;
}

Wire windowOf(const Snapshot& snapshot, const std::vector<uint32_t>& ordinals) {
    return decode(serialiseRows(snapshot, ordinals));
}

json placedSpine(const Wire& wire, const std::string& name) {
    return wire.header.at("spine").value(name, json::object());
}

std::vector<json> everyPlaced(const Wire& wire) {
    std::vector<json> placed;
    for (const auto& [name, column] : wire.header.at("spine").items())
        placed.push_back(column);
    for (const auto& column : wire.header.at("columns"))
        placed.push_back(column);
    return placed;
}

bool namesAnOffset(const std::string& pointer) {
    const std::string suffix = "/offset";
    return pointer.size() >= suffix.size() &&
           pointer.compare(pointer.size() - suffix.size(), suffix.size(), suffix) == 0;
}

}  // namespace

TEST_CASE(
    "a window of scattered ordinals reads back cell for cell in every column, in the order named") {
    const Snapshot snapshot = eightTracks();
    // Descending, and ordinal 0 named twice: a click-ordered set can be either.
    const std::vector<uint32_t> ordinals{4, 0, 7, 3, 0};

    const Wire wire = windowOf(snapshot, ordinals);

    CHECK(cellsOf(wire) == cellsAt(snapshot, ordinals));
}

TEST_CASE(
    "each column's dictionary holds only the values the window uses, once, in bytewise order") {
    const Snapshot snapshot = eightTracks();
    const std::vector<uint32_t> ordinals{4, 0, 3, 0, 1};
    const Wire wire = windowOf(snapshot, ordinals);
    const Cells expected = cellsAt(snapshot, ordinals);

    for (const auto& placed : everyPlaced(wire)) {
        const auto values = dictionary(wire, placed.at("dict"));
        const std::string name = placed.value("name", "a spine column");
        INFO("column: ", name);
        CHECK(std::is_sorted(values.begin(), values.end()));
        CHECK(std::adjacent_find(values.begin(), values.end()) == values.end());
    }

    CHECK(dictionary(wire, namedColumn(wire, kAlbum).at("dict")) ==
          std::vector<std::string>{"Zebra", "apple", "Éclair"});
    CHECK(dictionary(wire, namedColumn(wire, kPlays).at("dict")) ==
          std::vector<std::string>{"12", "3", "7", "?"});
    CHECK(dictionary(wire, placedSpine(wire, "directory").at("dict")) ==
          usedValues(expected.at("directory")));
    CHECK(dictionary(wire, placedSpine(wire, "subsong").at("dict")) ==
          std::vector<std::string>{"0", "1"});
}

TEST_CASE("a window's header carries the pair, the library's track count and its own row count") {
    const Wire wire = windowOf(eightTracks(), {5, 2, 2});

    CHECK(wire.header.at("structure") == kStructure);
    CHECK(wire.header.at("revision") == kRevision);
    CHECK(wire.header.at("trackCount") == 8);
    CHECK(wire.header.at("rows") == 3);
    for (const auto& placed : everyPlaced(wire))
        CHECK(placed.at("ids").at("count") == 3);
}

TEST_CASE("a window's header states each column's facts for the whole library, not the window") {
    const Snapshot snapshot = eightTracks();

    SUBCASE("a window holding no unresolved play count still says the library has one") {
        const Wire wire = windowOf(snapshot, {1, 3});
        REQUIRE(dictionary(wire, namedColumn(wire, kPlays).at("dict")) ==
                std::vector<std::string>{"12", "3"});

        const json& plays = namedColumn(wire, kPlays);
        CHECK(plays.at("distinct") == 6);
        CHECK(plays.at("hasUnresolved") == true);
        CHECK(plays.at("allUnresolved") == false);
    }

    SUBCASE("a window holding only unresolved play counts does not say they all are") {
        const Wire wire = windowOf(snapshot, {0, 2});
        REQUIRE(dictionary(wire, namedColumn(wire, kPlays).at("dict")) ==
                std::vector<std::string>{"?"});

        const json& plays = namedColumn(wire, kPlays);
        CHECK(plays.at("distinct") == 6);
        CHECK(plays.at("hasUnresolved") == true);
        CHECK(plays.at("allUnresolved") == false);
    }

    SUBCASE("a column the player resolves nowhere says so, and one it resolves everywhere too") {
        const Wire wire = windowOf(snapshot, {4});

        const json& comment = namedColumn(wire, kComment);
        CHECK(comment.at("distinct") == 1);
        CHECK(comment.at("hasUnresolved") == true);
        CHECK(comment.at("allUnresolved") == true);

        const json& title = namedColumn(wire, kTitle);
        CHECK(title.at("distinct") == 8);
        CHECK(title.at("hasUnresolved") == false);
        CHECK(title.at("allUnresolved") == false);
    }
}

TEST_CASE("a window of no rows is well formed and still states the library's facts") {
    const Wire wire = windowOf(eightTracks(), {});

    CHECK(wire.header.at("rows") == 0);
    CHECK(wire.header.at("trackCount") == 8);
    for (const auto& placed : everyPlaced(wire)) {
        CHECK(ids(wire, placed.at("ids")).empty());
        CHECK(dictionary(wire, placed.at("dict")).empty());
    }
    CHECK(namedColumn(wire, kTitle).at("distinct") == 8);
    CHECK(namedColumn(wire, kComment).at("allUnresolved") == true);
}

// A client sizes its typed array from the width, so an id carried at the library's width would
// cost four bytes a cell on a large library for a window that uses three values.
TEST_CASE("a value deep in a wide dictionary is sent under a narrow id of the window's own") {
    constexpr uint32_t kTracks = 70'001;
    std::vector<std::vector<std::string>> rows;
    rows.reserve(kTracks);
    for (uint32_t ordinal = 0; ordinal < kTracks; ++ordinal) {
        const std::string number = std::to_string(ordinal);
        rows.push_back({"a/", number + ".flac", "0", "Title " + number});
    }
    const Snapshot snapshot = snapshotOf({kTitle}, rows);
    const std::vector<uint32_t> ordinals{70'000, 5, 69'999};

    const Wire wire = windowOf(snapshot, ordinals);

    CHECK(cellsOf(wire) == cellsAt(snapshot, ordinals));
    const json& title = namedColumn(wire, kTitle);
    CHECK(title.at("distinct") == kTracks);
    for (const auto& placed : {title, placedSpine(wire, "filename")}) {
        CHECK(placed.at("ids").at("width") == 1);
        const auto written = ids(wire, placed.at("ids"));
        CHECK(std::all_of(written.begin(), written.end(), [](uint32_t id) { return id < 3; }));
    }
}

// `new Int32Array(buffer, offset, n)` in a browser throws unless the byte offset is a multiple of
// four, and a client hands it the absolute position rather than the one in the header.
TEST_CASE("every offset a client indexes a window on is four-byte aligned") {
    for (const std::vector<uint32_t>& ordinals :
         {std::vector<uint32_t>{0}, std::vector<uint32_t>{4, 0, 3}, std::vector<uint32_t>{}}) {
        INFO("rows: ", ordinals.size());
        const Wire wire = windowOf(eightTracks(), ordinals);
        CHECK(wire.blobStart % 4 == 0);
        const json flat = wire.header.flatten();
        for (const auto& leaf : flat.items()) {
            if (namesAnOffset(leaf.key()))
                CHECK((wire.blobStart + leaf.value().get<size_t>()) % 4 == 0);
        }
    }
}
