#include "third_party/doctest.h"

#include "core/failures.h"
#include "core/library.h"
#include "core/library_rows.h"
#include "support/fixtures.h"
#include "support/library_window.h"
#include "support/test_server.h"
#include "support/wire.h"
#include "third_party/json.hpp"

#include <atomic>
#include <cstdint>
#include <latch>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kRows[] = "/api/library/rows";

constexpr char kAlbum[] = "%album%";
constexpr char kTitle[] = "%title%";
constexpr char kGenre[] = "%genre%";

constexpr char kTooManyRows[] = "too many rows asked for";
constexpr char kStructureMoved[] = "tracks were added or removed; read the state and ask again";

std::vector<std::vector<std::string>> eightRows() {
    return {
        {"a/", "01.flac", "0", "Zebra", "One"},   {"a/", "02.flac", "0", "Zebra", "Two"},
        {"b/", "01.flac", "0", "apple", "Three"}, {"b/", "02.flac", "0", "apple", "Four"},
        {"c/", "01.flac", "0", "Éclair", "Five"}, {"c/", "02.flac", "0", "zoo", "Six"},
        {"d/", "01.flac", "0", "", "Seven"},      {"d/", "02.flac", "0", "?", "Eight"},
    };
}

Snapshot albumsAndTitles() {
    return snapshotOf({kAlbum, kTitle}, eightRows());
}

struct BuildLog {
    std::atomic<int> calls{0};
    std::vector<std::string> columns;
    std::vector<RebuildReason> reasons;
};

Player recordingBuilds(BuildLog* log) {
    Player player;
    player.library.refresh = [log](std::vector<std::string> columns, RebuildReason why) {
        log->columns = std::move(columns);
        log->reasons.push_back(why);
        ++log->calls;
    };
    return player;
}

std::string structureOf(const Library& library) {
    return std::to_string(library.state().structure);
}

json asking(const std::vector<std::string>& columns, const std::string& structure,
            const std::vector<uint32_t>& ordinals) {
    return json{{"columns", columns}, {"structure", structure}, {"ordinals", ordinals}};
}

json askingRuns(const std::vector<std::string>& columns, const std::string& structure,
                const json& runs) {
    return json{{"columns", columns}, {"structure", structure}, {"runs", runs}};
}

httplib::Result askFor(const TestServer& server, const json& body) {
    return post(server, kRows, body.dump());
}

std::vector<uint32_t> ordinalsFromTo(uint32_t first, uint32_t last) {
    std::vector<uint32_t> ordinals;
    for (uint32_t ordinal = first; ordinal <= last; ++ordinal)
        ordinals.push_back(ordinal);
    return ordinals;
}

struct Served {
    BuildLog log;
    Library library;
    TestServer server;

    explicit Served(Snapshot snapshot)
        : server(servingSettings(), recordingBuilds(&log), &library) {
        library.replace(std::move(snapshot));
    }

    std::string structure() const { return structureOf(library); }

    Cells heldAt(const std::vector<uint32_t>& ordinals) const {
        return library.read(
            [&ordinals](const Snapshot& snapshot) { return cellsAt(snapshot, ordinals); });
    }
};

struct Refused {
    const char* why;
    std::string body;
    std::string error;
};

}  // namespace

TEST_CASE("rows named by ordinal are answered as a JLIB body holding them in the order named") {
    Served served(albumsAndTitles());
    const std::vector<uint32_t> ordinals{4, 0, 7, 3, 0};

    const auto response =
        askFor(served.server, asking({kAlbum, kTitle}, served.structure(), ordinals));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Type") == "application/octet-stream");

    const Wire wire = decode(response->body);
    const auto state = served.library.state();
    CHECK(wire.header.at("structure") == state.structure);
    CHECK(wire.header.at("revision") == state.revision);
    CHECK(wire.header.at("trackCount") == 8);
    CHECK(wire.header.at("rows") == ordinals.size());
    CHECK(cellsOf(wire) == served.heldAt(ordinals));

    const json& album = namedColumn(wire, kAlbum);
    CHECK(dictionary(wire, album.at("dict")) ==
          std::vector<std::string>{"?", "Zebra", "apple", "Éclair"});
    CHECK(album.at("distinct") == 6);
    CHECK(album.at("hasUnresolved") == true);
    CHECK(album.at("allUnresolved") == false);
    CHECK(served.log.calls == 0);
}

TEST_CASE("rows named by runs are answered in ascending order, as a fill reads runs") {
    Served served(albumsAndTitles());

    const auto response = askFor(served.server, askingRuns({kAlbum, kTitle}, served.structure(),
                                                           json::array({{5, 2}, {0, 2}})));

    REQUIRE(response);
    REQUIRE(response->status == 200);
    const Wire wire = decode(response->body);
    CHECK(wire.header.at("rows") == 4);
    CHECK(cellsOf(wire) == served.heldAt({0, 1, 5, 6}));
}

TEST_CASE("as many rows as one answer carries are answered, by ordinal and by run") {
    constexpr uint32_t kTracks = 5000;
    BuildLog log;
    Library library;
    buildLibrary(library, kTracks);
    const TestServer server(servingSettings(), recordingBuilds(&log), &library);
    const std::string structure = structureOf(library);

    const auto byRun =
        askFor(server, askingRuns({kTitle}, structure, json::array({{1, kMaxRowsPerAnswer}})));
    REQUIRE(byRun);
    CHECK(byRun->status == 200);
    CHECK(decode(byRun->body).header.at("rows") == kMaxRowsPerAnswer);

    const auto byOrdinal =
        askFor(server, asking({kTitle}, structure, std::vector<uint32_t>(kMaxRowsPerAnswer, 3)));
    REQUIRE(byOrdinal);
    CHECK(byOrdinal->status == 200);
    CHECK(decode(byOrdinal->body).header.at("rows") == kMaxRowsPerAnswer);
}

TEST_CASE("rows are gzipped for a client that offers it and sent as they stand otherwise") {
    Served served(albumsAndTitles());
    const std::string body =
        asking({kAlbum, kTitle}, served.structure(), {0, 1, 2, 3, 4, 5}).dump();
    auto wire = undecoding(served.server);

    const auto plain = wire.Post(kRows, accepting("identity"), body, "application/json");
    REQUIRE(plain);
    REQUIRE(plain->status == 200);
    CHECK(plain->get_header_value("Content-Encoding").empty());
    CHECK_FALSE(isGzip(plain->body));
    CHECK(decode(plain->body).header.at("rows") == 6);

    const auto packed = wire.Post(kRows, accepting("gzip"), body, "application/json");
    REQUIRE(packed);
    REQUIRE(packed->status == 200);
    CHECK(packed->get_header_value("Content-Encoding") == "gzip");
    CHECK(isGzip(packed->body));

    const auto unpacked =
        served.server.client().Post(kRows, accepting("gzip"), body, "application/json");
    REQUIRE(unpacked);
    CHECK(unpacked->body == plain->body);

    for (const char* offer : {"", "deflate, br", "gzip;q=0, identity"}) {
        INFO("Accept-Encoding: ", offer);
        const auto declined = wire.Post(kRows, accepting(offer), body, "application/json");
        REQUIRE(declined);
        CHECK(declined->status == 200);
        CHECK(declined->get_header_value("Content-Encoding").empty());
        CHECK(declined->body == plain->body);
    }
}

TEST_CASE(
    "a set naming both forms, neither, or an ordinal past the library is refused with a 400") {
    Served served(albumsAndTitles());
    const std::string structure = served.structure();
    const json columns = json::array({kAlbum, kTitle});
    const std::string badSet = describe(PlaylistRefusal::badOrdinals);

    const std::vector<Refused> refused{
        {"both forms",
         json{{"columns", columns}, {"structure", structure}, {"ordinals", {0}}, {"runs", {{0, 1}}}}
             .dump(),
         badSet},
        {"neither form", json{{"columns", columns}, {"structure", structure}}.dump(), badSet},
        {"a bitset, which this route does not take",
         json{{"columns", columns}, {"structure", structure}, {"bitset", "AwI="}}.dump(), badSet},
        {"an ordinal one past the last track", asking({kAlbum, kTitle}, structure, {0, 8}).dump(),
         badSet},
        {"a run ending one past the last track",
         askingRuns({kAlbum, kTitle}, structure, json::array({{6, 3}})).dump(), badSet},
        {"an ordinal that is not a whole number",
         json{{"columns", columns}, {"structure", structure}, {"ordinals", {"1"}}}.dump(), badSet},
    };

    for (const auto& [why, body, error] : refused) {
        INFO("refused: ", why);
        const auto response = post(served.server, kRows, body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == error);
    }
    CHECK(served.log.calls == 0);
}

TEST_CASE("more rows than one answer carries are refused with a 400 saying so") {
    constexpr uint32_t kTracks = 5000;
    BuildLog log;
    Library library;
    buildLibrary(library, kTracks);
    const TestServer server(servingSettings(), recordingBuilds(&log), &library);
    const std::string structure = structureOf(library);

    const std::vector<std::pair<const char*, json>> refused{
        {"one run", askingRuns({kTitle}, structure, json::array({{0, kMaxRowsPerAnswer + 1}}))},
        {"two runs summing past it",
         askingRuns({kTitle}, structure,
                    json::array({{0, 4000}, {4000, kMaxRowsPerAnswer - 3999}}))},
        {"ordinals", asking({kTitle}, structure, std::vector<uint32_t>(kMaxRowsPerAnswer + 1, 3))},
    };

    for (const auto& [why, body] : refused) {
        INFO("named by: ", why);
        const auto response = askFor(server, body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == kTooManyRows);
    }
    CHECK(log.calls == 0);
}

TEST_CASE("a structure that is not a string of decimal digits is refused with a 400") {
    Served served(albumsAndTitles());
    const std::string malformed = describe(PlaylistRefusal::malformedBody);
    const json columns = json::array({kTitle, kAlbum});

    std::vector<std::pair<const char*, json>> refused{
        {"no structure", json{{"columns", columns}, {"ordinals", {0}}}},
        {"an empty one", json{{"columns", columns}, {"structure", ""}, {"ordinals", {0}}}},
        {"one with a letter in it",
         json{{"columns", columns}, {"structure", "12a"}, {"ordinals", {0}}}},
        {"a negative one", json{{"columns", columns}, {"structure", "-1"}, {"ordinals", {0}}}},
        {"a JSON number", json{{"columns", columns},
                               {"structure", served.library.state().structure},
                               {"ordinals", {0}}}},
    };

    for (const auto& [why, body] : refused) {
        INFO("structure: ", why);
        const auto response = askFor(served.server, body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == malformed);
    }

    const auto unreadable = post(served.server, kRows, "{\"columns\": [");
    REQUIRE(unreadable);
    CHECK(unreadable->status == 400);
    CHECK(errorOf(*unreadable) == malformed);
    CHECK(served.log.calls == 0);
}

TEST_CASE("a declaration naming no column, an empty one or one twice is refused with a 400") {
    Served served(albumsAndTitles());
    const std::string structure = served.structure();

    const auto refusalOf = [&served](const json& body) {
        const auto response = askFor(served.server, body);
        REQUIRE(response);
        CHECK(response->status == 400);
        return json::parse(response->body, nullptr, false);
    };

    CHECK(refusalOf(json{{"structure", structure}, {"ordinals", {0}}}) ==
          json{{"error", "unacceptable column"}, {"detail", kColumnsRequired}});
    CHECK(refusalOf(asking({}, structure, {0})) ==
          json{{"error", "unacceptable column"}, {"detail", kColumnsRequired}});
    CHECK(refusalOf(asking({kTitle, kAlbum, kTitle}, structure, {0})) ==
          json{{"error", "duplicate column"}, {"detail", "column 2 repeats an earlier one"}});
    CHECK(refusalOf(asking({kTitle, ""}, structure, {0})) ==
          json{{"error", "unacceptable column"},
               {"detail", "column 1 must be printable text of 1 to 1024 characters"}});
    CHECK(served.log.calls == 0);
}

TEST_CASE("without the media library rows are a 503, after what the request says is judged") {
    BuildLog log;
    const TestServer server(servingSettings(), recordingBuilds(&log), nullptr);

    const auto unavailable = askFor(server, asking({kTitle}, "41", {0, 1}));
    REQUIRE(unavailable);
    CHECK(unavailable->status == 503);
    CHECK(errorOf(*unavailable) == kNoLibrary);

    const auto malformed = askFor(server, json{{"columns", {kTitle}}, {"structure", "41"}});
    REQUIRE(malformed);
    CHECK(malformed->status == 400);
    CHECK(log.calls == 0);
}

TEST_CASE("a declaration other than the one held answers 202 and starts building it") {
    Served served(albumsAndTitles());
    const std::vector<std::string> declared{kAlbum, kGenre};

    const auto building = askFor(served.server, asking(declared, served.structure(), {0, 1}));

    REQUIRE(building);
    CHECK(building->status == 202);
    const auto document = json::parse(building->body, nullptr, false);
    CHECK(document.at("ready") == true);
    CHECK(document.at("structure") == served.library.state().structure);
    CHECK(document.at("columns") == json::array({kAlbum, kTitle}));
    CHECK(served.log.calls == 1);
    CHECK(served.log.columns == declared);
    CHECK(served.log.reasons == std::vector<RebuildReason>{RebuildReason::columnsDeclared});

    std::vector<std::vector<std::string>> rows = eightRows();
    for (auto& row : rows)
        row.back() = "Rock";
    served.library.replace(snapshotOf(declared, rows));

    const auto built = askFor(served.server, asking(declared, served.structure(), {0, 1}));
    REQUIRE(built);
    CHECK(built->status == 200);
    CHECK(column(decode(built->body), namedColumn(decode(built->body), kGenre)) ==
          std::vector<std::string>{"Rock", "Rock"});
}

TEST_CASE("rows asked for before anything is built answer 202 and start a build of them") {
    BuildLog log;
    Library library;
    const TestServer server(servingSettings(), recordingBuilds(&log), &library);

    const auto building = askFor(server, asking({kAlbum, kTitle}, "0", {0}));

    REQUIRE(building);
    CHECK(building->status == 202);
    CHECK(json::parse(building->body, nullptr, false).at("ready") == false);
    CHECK(log.calls == 1);
    CHECK(log.columns == std::vector<std::string>{kAlbum, kTitle});

    library.replace(albumsAndTitles());
    const auto built = askFor(server, asking({kAlbum, kTitle}, structureOf(library), {0}));
    REQUIRE(built);
    CHECK(built->status == 200);
}

TEST_CASE("a new declaration is answered 202 whatever structure the request names") {
    Served served(albumsAndTitles());
    const std::string stale = std::to_string(served.library.state().structure + 1);

    const auto response = askFor(served.server, asking({kGenre}, stale, {0}));

    REQUIRE(response);
    CHECK(response->status == 202);
    CHECK(served.log.calls == 1);
}

TEST_CASE("the held declaration listed in another order is answered from the snapshot") {
    Served served(albumsAndTitles());

    const auto response = askFor(served.server, asking({kTitle, kAlbum}, served.structure(), {2}));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(cellsOf(decode(response->body)) == served.heldAt({2}));
    CHECK(served.log.calls == 0);
}

TEST_CASE("the set the rows route declared is the one a refresh rebuilds") {
    Served served(albumsAndTitles());
    REQUIRE(askFor(served.server, asking({kGenre}, served.structure(), {0})));
    REQUIRE(served.log.calls == 1);

    const auto refreshed = post(served.server, "/api/library/refresh", "{}");

    REQUIRE(refreshed);
    CHECK(refreshed->status == 202);
    CHECK(served.log.calls == 2);
    CHECK(served.log.columns == std::vector<std::string>{kGenre});
    CHECK(served.log.reasons.back() == RebuildReason::dataChanged);
}

TEST_CASE("rows at a structure that is not the current one are refused with a 409") {
    Served served(albumsAndTitles());
    const std::string before = served.structure();
    served.library.replace(snapshotOf({kAlbum, kTitle}, [] {
        auto rows = eightRows();
        rows.push_back({"e/", "01.flac", "0", "Mango", "Nine"});
        return rows;
    }()));
    REQUIRE(served.structure() != before);

    for (const std::string& structure : {before, std::string("1")}) {
        INFO("structure: ", structure);
        const auto response = askFor(served.server, asking({kAlbum, kTitle}, structure, {0}));
        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(errorOf(*response) == kStructureMoved);
    }

    const auto current = askFor(served.server, asking({kAlbum, kTitle}, served.structure(), {8}));
    REQUIRE(current);
    CHECK(current->status == 200);
    CHECK(served.log.calls == 0);
}

// The header's revision and the rows under it have to come from one snapshot: a client patches
// what it holds from the revision it was told, so rows a revision ahead of their header are
// patched twice and rows behind it never.
TEST_CASE("rows read while row changes land carry exactly the revision their header names") {
    constexpr uint32_t kTracks = 4;
    constexpr char kPlays[] = "%play_count%";
    constexpr size_t kReaders = 3;
    // Under the rows budget, which the test clock never refills.
    constexpr size_t kAsksPerReader = 9;

    const auto rowAt = [](uint32_t ordinal, uint64_t plays) {
        return std::vector<std::string>{"a/", std::to_string(ordinal) + ".flac", "0",
                                        std::to_string(plays)};
    };
    std::vector<std::vector<std::string>> rows;
    for (uint32_t ordinal = 0; ordinal < kTracks; ++ordinal)
        rows.push_back(rowAt(ordinal, 1));

    Served served(snapshotOf({kPlays}, rows));
    const uint64_t first = served.library.state().revision;
    const std::string body = asking({kPlays}, served.structure(), {3, 0, 2, 1}).dump();

    std::atomic<size_t> reading{kReaders};
    std::atomic<size_t> torn{0};
    std::atomic<size_t> unanswered{0};
    std::latch start(kReaders + 1);

    std::thread writer([&] {
        start.arrive_and_wait();
        for (uint64_t plays = 2; reading > 0; ++plays) {
            std::vector<RowChange> changes;
            for (uint32_t ordinal = 0; ordinal < kTracks; ++ordinal)
                changes.push_back({ordinal, rowAt(ordinal, plays)});
            served.library.apply(changes);
        }
    });
    std::vector<std::thread> readers;
    readers.reserve(kReaders);
    for (size_t reader = 0; reader < kReaders; ++reader) {
        readers.emplace_back([&] {
            start.arrive_and_wait();
            for (size_t asked = 0; asked < kAsksPerReader; ++asked) {
                const auto response = post(served.server, kRows, body);
                if (!response || response->status != 200) {
                    ++unanswered;
                    continue;
                }
                const Wire wire = decode(response->body);
                const auto plays =
                    std::to_string(wire.header.at("revision").get<uint64_t>() - first + 1);
                if (column(wire, namedColumn(wire, kPlays)) !=
                    std::vector<std::string>(kTracks, plays))
                    ++torn;
            }
            --reading;
        });
    }
    for (auto& reader : readers)
        reader.join();
    writer.join();

    INFO("revisions reached: ", served.library.state().revision - first);
    CHECK(unanswered == 0);
    CHECK(torn == 0);
}

// A client polling by asking again would start a rebuild per attempt, and a library walk is the
// most expensive thing this component can be asked for.
TEST_CASE("asking again for a set already building does not start a second build") {
    BuildLog log;
    Library library;
    const TestServer server(servingSettings(), recordingBuilds(&log), &library);

    REQUIRE(askFor(server, asking({kGenre}, "0", {0})));
    library.reportBuild(BuildProgress{BuildPhase::listing, 0, 0});

    for (int attempt = 0; attempt < 4; ++attempt) {
        const auto response = askFor(server, asking({kGenre}, "0", {0}));
        REQUIRE(response);
        CHECK(response->status == 202);
    }

    CHECK(log.calls == 1);
}

// A walk that times out on foobar2000's main thread ends the build without a snapshot, and the
// set stays declared. Were the declaration all that was checked, every retry after that would be
// answered 202 and nothing would ever build it.
TEST_CASE("asking again for a declared set nobody is building starts it again") {
    BuildLog log;
    Library library;
    const TestServer server(servingSettings(), recordingBuilds(&log), &library);

    const auto first = askFor(server, asking({kGenre}, "0", {0}));
    REQUIRE(first);
    REQUIRE(first->status == 202);
    REQUIRE(log.calls == 1);

    SUBCASE("the build ended without a snapshot") {
        library.reportBuild(BuildProgress{BuildPhase::listing, 0, 0});
        library.endBuild();
    }
    SUBCASE("the build never reported") {}

    const auto again = askFor(server, asking({kGenre}, "0", {0}));
    REQUIRE(again);
    CHECK(again->status == 202);
    CHECK(log.calls == 2);
    CHECK(log.columns == std::vector<std::string>{kGenre});
}

TEST_CASE("a declaration the player cannot build is a 503 rather than a 202 nobody honours") {
    Library library;
    const TestServer server(servingSettings(), Player{}, &library);

    const auto response = askFor(server, asking({kTitle}, "0", {0}));

    REQUIRE(response);
    CHECK(response->status == 503);
    CHECK(errorOf(*response) == "the media library is not available");
}

// Varying the set declared is the other way to ask for repeated library walks, and it spends the
// bucket POST /api/library/refresh does rather than a second one.
TEST_CASE("a client varying the set it declares stops reaching the player") {
    BuildLog log;
    Library library;
    const TestServer server(servingSettings(), recordingBuilds(&log), &library);

    constexpr int kAttempts = 8;
    int refused = 0;
    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        const std::string varied = "%genre" + std::to_string(attempt) + "%";
        const auto response = askFor(server, asking({varied}, "0", {0}));
        REQUIRE(response);
        if (response->status == 429)
            refused++;
    }

    CHECK(refused > 0);
    CHECK(log.calls == kAttempts - refused);
}

// A client retrying a declaration whose build keeps dying asks for a library walk each time,
// which is the loop the rebuild budget is there for.
TEST_CASE("asking again for a set nobody is building spends the rebuild budget") {
    BuildLog log;
    Library library;
    const TestServer server(servingSettings(), recordingBuilds(&log), &library);

    constexpr int kAttempts = 8;
    int refused = 0;
    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        const auto response = askFor(server, asking({kGenre}, "0", {0}));
        REQUIRE(response);
        if (response->status == 429) {
            refused++;
            CHECK(response->get_header_value("Retry-After") == "30");
            CHECK(errorOf(*response) == "too many library refreshes");
        }
    }

    CHECK(refused > 0);
    CHECK(log.calls == kAttempts - refused);
}
