#include "third_party/doctest.h"

#include "core/library.h"
#include "support/fixtures.h"
#include "support/test_server.h"
#include "support/wire.h"
#include "third_party/json.hpp"

#include <chrono>
#include <cstdint>
#include <random>
#include <regex>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

using Row = std::vector<std::string>;

const std::vector<std::string> kDeclaration{"%title%", "%play_count%"};

const std::vector<Row> kKnownRows{
    {"Fjörður/Ljós/", "01 Dögun.flac", "0", "Dögun", "4"},
    {"Fjörður/Ljós/", "02 Hádegi.flac", "0", "Hádegi", "?"},
};

constexpr char kKnownSnapshotId[] = "442acff8cb76faf6";

constexpr char kEmptyLibrarySnapshotId[] = "7a0ef1afcc68194a";

constexpr char kNoSnapshot[] = "0000000000000000";

constexpr char kExport[] = "/api/library/export?columns=%25title%25&columns=%25play_count%25";
constexpr char kTitlesAlone[] =
    "/api/library/export?columns=%25title%25&columns=%25play_count%25&only=%25title%25"
    "&spine=false";

const std::vector<Row> kThreeTracks{
    {"Artist/Album/", "01.flac", "0", "One", "4"},
    {"Artist/Album/", "02.flac", "0", "Two", "0"},
    {"Artist/Other/", "03.flac", "0", "Three", "?"},
};

std::string validatorIn(const json& header) {
    REQUIRE(header.contains("snapshotId"));
    const auto validator = header.at("snapshotId").get<std::string>();
    CHECK(std::regex_match(validator, std::regex("^[0-9a-f]{16}$")));
    return validator;
}

std::string exportedValidator(const Library& library) {
    const auto exported = library.exported();
    REQUIRE(exported.bytes);
    return validatorIn(decode(*exported.bytes).header);
}

std::string validatorBuiltFrom(const std::vector<std::string>& declared,
                               const std::vector<Row>& rows) {
    Library library;
    library.replace(snapshotOf(declared, rows));
    return exportedValidator(library);
}

json changesHeader(const Library& library, uint64_t structure, uint64_t since) {
    const auto changes = library.changes(structure, since);
    REQUIRE(changes.outcome == DeltaOutcome::ok);
    return decode(serialiseDelta(changes.delta)).header;
}

json polledLibrary(const TestServer& server) {
    const auto response = get(server, "/api/state");
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body).at("library");
}

std::string polledValidator(const TestServer& server) {
    return validatorIn(polledLibrary(server));
}

json headerOf(const TestServer& server, const std::string& path) {
    const auto response = get(server, path);
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return decode(response->body).header;
}

std::string changesFrom(uint64_t structure, uint64_t since) {
    return "/api/library/changes?since=" + std::to_string(since) +
           "&structure=" + std::to_string(structure);
}

std::vector<Row> numberedTracks(size_t count) {
    std::vector<Row> rows;
    rows.reserve(count);
    for (size_t index = 0; index < count; ++index)
        rows.push_back({"Artist/Album/", std::to_string(index) + ".flac", "0",
                        "Track " + std::to_string(index), std::to_string(index % 7)});
    return rows;
}

Row played(Row row, const std::string& count) {
    row[4] = count;
    return row;
}

}  // namespace

TEST_CASE("a known library folds to the validator contract/openapi.yaml's algorithm gives") {
    Library library;
    library.replace(snapshotOf(kDeclaration, kKnownRows));
    const TestServer server(servingSettings(), Player{}, &library);

    CHECK(exportedValidator(library) == kKnownSnapshotId);
    CHECK(polledValidator(server) == kKnownSnapshotId);
}

TEST_CASE("a built library with no tracks is named by its count alone, never by sixteen zeros") {
    Library library;
    library.replace(snapshotOf(kDeclaration, {}));
    const TestServer server(servingSettings(), Player{}, &library);

    CHECK(exportedValidator(library) == kEmptyLibrarySnapshotId);
    CHECK(polledValidator(server) == kEmptyLibrarySnapshotId);
}

TEST_CASE("a library not yet built polls as sixteen zeros") {
    Library library;
    const TestServer server(servingSettings(), Player{}, &library);

    const json polled = polledLibrary(server);
    REQUIRE(polled.at("ready") == false);
    CHECK(polled.value("snapshotId", "") == kNoSnapshot);
}

TEST_CASE("two libraries holding the same tracks name the same snapshot, however each got there") {
    Library first;
    first.replace(snapshotOf(kDeclaration, kThreeTracks));

    Library second;
    second.replace(snapshotOf({"%artist%"}, {{"Artist/Album/", "01.flac", "0", "Someone"}}));
    LibraryBuilder builder(kDeclaration, kThreeTracks.size());
    auto& sink = builder.sink();
    for (size_t index = kThreeTracks.size(); index > 0; --index)
        sink.row(index - 1, kThreeTracks[index - 1]);
    second.replace(builder.finish());
    second.apply({{0, played(kThreeTracks[0], "5")}});
    second.apply({{0, kThreeTracks[0]}});

    REQUIRE(second.state().structure != first.state().structure);
    REQUIRE(second.state().revision != first.state().revision);
    CHECK(exportedValidator(second) == exportedValidator(first));
}

TEST_CASE("a changed cell, column, row order or count names another snapshot") {
    const std::string unchanged = validatorBuiltFrom(kDeclaration, kThreeTracks);
    REQUIRE(unchanged == validatorBuiltFrom(kDeclaration, kThreeTracks));

    std::vector<Row> retitled = kThreeTracks;
    retitled[1][3] = "Two (live)";

    std::vector<Row> renamed = kThreeTracks;
    renamed[2][1] = "03 Three.flac";

    std::vector<Row> reordered = kThreeTracks;
    std::swap(reordered[0], reordered[1]);

    std::vector<Row> traded = kThreeTracks;
    traded[0] = {"Artist/Album/", "01.flac", "0", "4", "One"};

    std::vector<Row> grown = kThreeTracks;
    grown.push_back({"Artist/Other/", "04.flac", "0", "Four", "1"});

    for (const auto& [change, declared, rows] :
         std::vector<std::tuple<std::string, std::vector<std::string>, std::vector<Row>>>{
             {"a declared value", kDeclaration, retitled},
             {"a spine value", kDeclaration, renamed},
             {"a declared column", {"%album%", "%play_count%"}, kThreeTracks},
             {"the order of the rows", kDeclaration, reordered},
             {"two columns trading values", kDeclaration, traded},
             {"the count", kDeclaration, grown},
         }) {
        CAPTURE(change);
        CHECK(validatorBuiltFrom(declared, rows) != unchanged);
    }
}

TEST_CASE("a play moves the validator to the played library's, and undoing it moves it back") {
    Library library;
    library.replace(snapshotOf(kDeclaration, kThreeTracks));
    const auto before = library.state();
    const std::string unplayed = exportedValidator(library);

    std::vector<Row> rows = kThreeTracks;
    rows[1] = played(rows[1], "1");
    REQUIRE(library.apply({{1, rows[1]}}) == before.revision + 1);

    const std::string afterThePlay = validatorBuiltFrom(kDeclaration, rows);
    CHECK(afterThePlay != unplayed);
    CHECK(exportedValidator(library) == afterThePlay);
    CHECK(validatorIn(changesHeader(library, before.structure, before.revision)) == afterThePlay);

    REQUIRE(library.apply({{1, kThreeTracks[1]}}) == before.revision + 2);
    CHECK(exportedValidator(library) == unplayed);
    CHECK(validatorIn(changesHeader(library, before.structure, before.revision + 1)) == unplayed);
}

// FNV-1a ends on an XOR and a multiply, so two cells whose last byte changes in the same bit move
// their unmixed terms by the prime and minus the prime, and summed unmixed they cancel.
TEST_CASE("two plays whose last digits move in the same bit name another snapshot than neither") {
    Library library;
    library.replace(snapshotOf(kDeclaration, kThreeTracks));
    const std::string unplayed = exportedValidator(library);

    std::vector<Row> rows = kThreeTracks;
    rows[0] = played(rows[0], "5");
    library.apply({{0, rows[0]}});
    const std::string onePlay = exportedValidator(library);

    rows[1] = played(rows[1], "1");
    library.apply({{1, rows[1]}});
    const std::string twoPlays = exportedValidator(library);

    CHECK(twoPlays != unplayed);
    CHECK(twoPlays != onePlay);
    CHECK(twoPlays == validatorBuiltFrom(kDeclaration, rows));
}

TEST_CASE("no pair of single-digit plays among a few hundred leaves the validator where it was") {
    constexpr size_t kTracks = 1000;
    constexpr size_t kPairs = 300;
    constexpr uint32_t kSeed = 35;

    const std::vector<Row> rows = numberedTracks(kTracks);
    Library library;
    library.replace(snapshotOf(kDeclaration, rows));
    const uint64_t structure = library.state().structure;
    const std::string unplayed = exportedValidator(library);

    // std::mt19937's output is specified, and the distributions over it are not.
    const auto playOnce = [&rows](uint32_t ordinal) {
        return RowChange{ordinal,
                         played(rows[ordinal], std::to_string(std::stoi(rows[ordinal][4]) + 1))};
    };

    std::mt19937 engine(kSeed);
    for (size_t pair = 0; pair < kPairs; ++pair) {
        const auto first = static_cast<uint32_t>(engine() % kTracks);
        auto second = static_cast<uint32_t>(engine() % (kTracks - 1));
        second += second >= first ? 1 : 0;

        const uint64_t before = library.state().revision;
        library.apply({playOnce(first), playOnce(second)});
        REQUIRE(library.state().revision == before + 1);
        CAPTURE(first);
        CAPTURE(second);
        CHECK(validatorIn(changesHeader(library, structure, before)) != unplayed);

        library.apply({{first, rows[first]}, {second, rows[second]}});
    }
}

TEST_CASE("however a rebuild lands, the validator is the one a library built fresh from it names") {
    std::vector<Row> rows = numberedTracks(40);

    Library library;
    library.replace(snapshotOf(kDeclaration, rows));
    rows[5] = played(rows[5], "played");
    library.apply({{5, rows[5]}});

    std::vector<std::string> declared = kDeclaration;
    std::vector<Row> next = rows;

    SUBCASE("a value retagged") {
        next[3][3] = "Track 3 (remastered)";
    }
    SUBCASE("a track added") {
        next.insert(next.begin() + 10, Row{"Artist/Album/", "10a.flac", "0", "Added", "?"});
    }
    SUBCASE("a track removed") {
        next.erase(next.begin() + 20);
    }
    SUBCASE("a track added and another removed") {
        next.erase(next.begin() + 20);
        next.push_back({"Artist/Album/", "99.flac", "0", "Added", "0"});
    }
    SUBCASE("the same tracks in another order") {
        std::swap(next[0], next[39]);
    }
    SUBCASE("another column set") {
        declared = {"%album%", "%play_count%"};
    }

    library.replace(snapshotOf(declared, next));

    CHECK(exportedValidator(library) == validatorBuiltFrom(declared, next));
}

TEST_CASE("GET /state and every library body name the same snapshot at the same generation") {
    std::vector<Row> rows = numberedTracks(120);

    Library library;
    library.replace(snapshotOf(kDeclaration, rows));
    const TestServer server(servingSettings(), Player{}, &library);

    const auto built = library.state();
    const std::string unplayed = polledValidator(server);
    CHECK(validatorIn(headerOf(server, kExport)) == unplayed);
    CHECK(validatorIn(headerOf(server, kTitlesAlone)) == unplayed);

    rows[0] = played(rows[0], "5");
    rows[1] = played(rows[1], "12");
    library.apply({{0, rows[0]}});
    library.apply({{1, rows[1]}});
    const std::string afterPlays = polledValidator(server);
    CHECK(afterPlays != unplayed);
    CHECK(validatorIn(headerOf(server, changesFrom(built.structure, built.revision))) ==
          afterPlays);
    CHECK(validatorIn(headerOf(server, changesFrom(built.structure, built.revision + 1))) ==
          afterPlays);
    CHECK(validatorIn(headerOf(server, kExport)) == afterPlays);
    CHECK(validatorIn(headerOf(server, kTitlesAlone)) == afterPlays);

    const auto beforeTheSplice = library.state();
    rows.push_back({"Artist/Album/", "added.flac", "0", "Added", "0"});
    library.replace(snapshotOf(kDeclaration, rows));
    REQUIRE(library.state().structure != beforeTheSplice.structure);

    const json splice =
        headerOf(server, changesFrom(beforeTheSplice.structure, beforeTheSplice.revision));
    REQUIRE(splice.at("kind") == "splice");
    const std::string spliced = polledValidator(server);
    CHECK(spliced != afterPlays);
    CHECK(validatorIn(splice) == spliced);
    CHECK(validatorIn(headerOf(server, kExport)) == spliced);
    CHECK(spliced == validatorBuiltFrom(kDeclaration, rows));
}

TEST_CASE("a play at a large library moves the validator without folding the library again") {
    constexpr size_t kTracks = 50000;
    constexpr size_t kPlays = 200;
    constexpr auto kBound = std::chrono::milliseconds(1000);

    std::vector<Row> rows = numberedTracks(kTracks);

    Library library;
    library.replace(snapshotOf(kDeclaration, rows));
    const auto built = library.state();
    const std::string unplayed = exportedValidator(library);

    std::vector<std::string> validators;
    validators.reserve(kPlays);
    const auto started = std::chrono::steady_clock::now();
    for (size_t play = 1; play <= kPlays; ++play) {
        const auto ordinal = static_cast<uint32_t>((play * 7919) % kTracks);
        rows[ordinal] = played(rows[ordinal], std::to_string(kPlays + play));
        library.apply({{ordinal, rows[ordinal]}});
        validators.push_back(
            validatorIn(changesHeader(library, built.structure, built.revision + play - 1)));
    }
    const auto elapsed = std::chrono::steady_clock::now() - started;

    CHECK(elapsed < kBound);
    CHECK(validators.front() != unplayed);
    CHECK(validators.back() == validatorBuiltFrom(kDeclaration, rows));
}
