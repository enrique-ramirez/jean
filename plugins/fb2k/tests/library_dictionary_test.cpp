#include "third_party/doctest.h"

#include "core/library.h"
#include "support/fixtures.h"
#include "support/wire.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cstdint>
#include <set>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

using Row = std::vector<std::string>;

const std::vector<std::string>& declaredColumns() {
    static const std::vector<std::string> value{"%title%", "%genre%"};
    return value;
}

// Chosen so the naive orders differ from bytewise: a comparison on signed `char` puts the accented
// letter first, and UTF-16 code units order U+FF5A and U+1F600 the other way round.
const std::vector<Row>& mixedRows() {
    static const std::vector<Row> value{
        {"b/", "9.mp3", "2", "a", "Rock"},
        {"a/", "10.mp3", "10", "Z", ""},
        {"B/", "\xC3\xA9.mp3", "0", "\xC3\xA9", "?"},
        {"b/", "z.mp3", "2", "z", "Rock"},
        {"a/", "\xEF\xBD\x9A.mp3", "0", "\xF0\x9F\x98\x80", "Jazz"},
        {"\xC3\xA9/", "\xF0\x9F\x98\x80.mp3", "1", "\xEF\xBD\x9A", ""},
    };
    return value;
}

bool bytewiseBefore(const std::string& left, const std::string& right) {
    return std::lexicographical_compare(
        left.begin(), left.end(), right.begin(), right.end(), [](char a, char b) {
            return static_cast<unsigned char>(a) < static_cast<unsigned char>(b);
        });
}

struct Entry {
    std::string name;
    json placed;
};

std::vector<Entry> everyColumn(const Wire& wire) {
    std::vector<Entry> entries;
    for (const char* name : kSpineFields)
        entries.push_back({name, wire.header.at("spine").at(name)});
    for (const json& column : wire.header.at("columns"))
        entries.push_back({column.at("name").get<std::string>(), column});
    return entries;
}

void checkCompactAndInOrder(const Wire& wire) {
    for (const Entry& entry : everyColumn(wire)) {
        INFO("column ", entry.name);
        const auto values = dictionary(wire, entry.placed.at("dict"));
        const auto rows = ids(wire, entry.placed.at("ids"));

        CHECK(entry.placed.at("distinct") == values.size());
        for (size_t at = 1; at < values.size(); ++at) {
            INFO("entries ", at - 1, " and ", at);
            CHECK(bytewiseBefore(values[at - 1], values[at]));
        }

        const std::set<uint32_t> used(rows.begin(), rows.end());
        for (uint32_t id = 0; id < values.size(); ++id) {
            INFO("entry ", id, ", ", values[id]);
            CHECK(used.count(id) == 1);
        }
    }
}

std::vector<std::string> columnOf(const std::vector<Row>& rows, size_t field) {
    std::vector<std::string> values(rows.size());
    std::transform(rows.begin(), rows.end(), values.begin(),
                   [field](const Row& row) { return row[field]; });
    return values;
}

void checkRows(const Wire& wire, const std::vector<Row>& rows) {
    const auto entries = everyColumn(wire);
    REQUIRE(entries.size() == rows.front().size());
    for (size_t field = 0; field < entries.size(); ++field) {
        INFO("column ", entries[field].name);
        CHECK(column(wire, entries[field].placed) == columnOf(rows, field));
    }
}

Wire exportOf(const Library& library) {
    const auto exported = library.exported();
    REQUIRE(exported.bytes);
    return decode(*exported.bytes);
}

// metadb_v2::queryMultiParallel gives each worker thread a sink of its own, and the threads report
// rows in whatever order they reach them.
Snapshot builtThrough(size_t sinks, const std::vector<Row>& rows) {
    LibraryBuilder builder(declaredColumns(), rows.size());
    std::vector<LibraryBuilder::Sink*> taking;
    taking.reserve(sinks);
    for (size_t sink = 0; sink < sinks; ++sink)
        taking.push_back(&builder.sink());

    for (size_t index = rows.size(); index > 0; --index)
        taking[(index - 1) % sinks]->row(index - 1, rows[index - 1]);

    return builder.finish();
}

json withoutStructure(json header) {
    header.erase("structure");
    return header;
}

}  // namespace

TEST_CASE(
    "a fresh build holds each column's used values once each, in bytewise UTF-8 order, "
    "spine included") {
    Library library;
    library.replace(snapshotOf(declaredColumns(), mixedRows()));

    const Wire wire = exportOf(library);

    checkCompactAndInOrder(wire);
    checkRows(wire, mixedRows());
}

TEST_CASE("a fresh build exports the same bytes however its rows arrived") {
    Library inOrder;
    inOrder.replace(snapshotOf(declaredColumns(), mixedRows()));
    const Wire expected = exportOf(inOrder);

    for (const size_t sinks : {size_t{1}, size_t{2}, size_t{3}}) {
        INFO(sinks, " sink(s), latest row first");
        Library arrivedOtherwise;
        arrivedOtherwise.replace(builtThrough(sinks, mixedRows()));
        const Wire wire = exportOf(arrivedOtherwise);

        CHECK(withoutStructure(wire.header) == withoutStructure(expected.header));
        CHECK(wire.blob == expected.blob);
    }
}

TEST_CASE(
    "a rebuild that leaves no way across is fresh: another column set, or compacted "
    "dictionaries") {
    constexpr size_t kPlays = 40;

    Library library;
    library.replace(snapshotOf(declaredColumns(), mixedRows()));

    std::vector<Row> played = mixedRows();
    for (size_t play = kPlays; play > 0; --play) {
        played[0][3] = "t" + std::to_string(play);
        library.apply({{0, played[0]}});
    }
    played[0][3] = mixedRows()[0][3];
    library.apply({{0, played[0]}});

    std::vector<Row> rows;
    std::vector<std::string> declared;
    DeltaOutcome across = DeltaOutcome::ok;

    SUBCASE("another column set") {
        declared = {"%title%"};
        for (const Row& row : played)
            rows.push_back({row[0], row[1], row[2], row[3]});
        across = DeltaOutcome::rearranged;
    }

    SUBCASE("a track added once the dead entries outnumber the live ones") {
        declared = declaredColumns();
        rows = played;
        rows.push_back({"c/", "1.mp3", "0", "M", "Pop"});
        across = DeltaOutcome::dictionariesCompacted;
    }

    const auto before = library.state();
    library.replace(snapshotOf(declared, rows));
    REQUIRE(library.changes(before.structure, before.revision).outcome == across);

    const Wire wire = exportOf(library);
    checkCompactAndInOrder(wire);
    checkRows(wire, rows);
}
