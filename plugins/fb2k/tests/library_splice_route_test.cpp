#include "third_party/doctest.h"

#include "core/failures.h"
#include "core/library.h"
#include "support/fake_player.h"
#include "support/fixtures.h"
#include "support/spec.h"
#include "support/test_server.h"
#include "support/wire.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cstdint>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

using Row = std::vector<std::string>;

constexpr char kTitle[] = "title";
constexpr char kArtist[] = "artist";

constexpr char kTitleExport[] = "/api/library/export?columns=title";

constexpr size_t kTracks = 120;

Row numberedTrack(size_t number) {
    return {"Artist/Album/", std::to_string(number) + ".flac", "0",
            "Track " + std::to_string(number)};
}

std::vector<Row> numbered(size_t count) {
    std::vector<Row> rows;
    rows.reserve(count);
    for (size_t number = 0; number < count; ++number)
        rows.push_back(numberedTrack(number));
    return rows;
}

Row newTrack(const std::string& name) {
    return {"Artist/Album/", name + ".flac", "0", name};
}

void install(Library& library, const std::vector<Row>& rows) {
    library.replace(snapshotOf({kTitle}, rows));
}

uint64_t retitle(Library& library, std::vector<Row>& rows, uint32_t ordinal) {
    rows[ordinal][3] += " (remastered)";
    return library.apply({{ordinal, rows[ordinal]}});
}

std::string changesFrom(uint64_t structure, uint64_t since) {
    return "/api/library/changes?since=" + std::to_string(since) +
           "&structure=" + std::to_string(structure);
}

json headerOf(const httplib::Result& response) {
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return decode(response->body).header;
}

void checkExportAgain(const httplib::Result& response, int status) {
    REQUIRE(response);
    CHECK(response->status == status);
    if (response->status != status)
        return;

    const auto error = json::parse(response->body).at("error").get<std::string>();
    const auto published = publishedEnum("LibraryFailed", "error");
    CHECK(std::any_of(published.begin(), published.end(), [&error](const std::string& value) {
        return value == error || value == '"' + error + '"';
    }));
    CHECK(json::parse(response->body).at("detail") == "");
}

std::vector<uint32_t> section(const httplib::Result& response, const char* name) {
    const Wire wire = decode(response->body);
    return ids(wire, wire.header.at(name));
}

}  // namespace

TEST_CASE("tracks added, removed, or both are a splice naming where each row went") {
    Library library;
    std::vector<Row> rows = numbered(kTracks);
    install(library, rows);
    const uint64_t since = retitle(library, rows, 5);
    const uint64_t sinceStructure = library.state().structure;

    std::vector<Row> next = rows;
    std::vector<uint32_t> removed;
    std::vector<uint32_t> inserted;

    SUBCASE("a track added") {
        next.insert(next.begin() + 1, newTrack("added"));
        inserted = {1};
    }

    SUBCASE("a track removed") {
        next.erase(next.begin() + 1);
        removed = {1};
    }

    SUBCASE("a track removed and another added") {
        next.erase(next.begin() + 1);
        next.insert(next.begin() + 2, newTrack("added"));
        removed = {1};
        inserted = {2};
    }

    install(library, next);
    const auto state = library.state();
    REQUIRE(state.structure != sinceStructure);

    const TestServer server(servingSettings(), Player{}, &library);
    const auto response = get(server, changesFrom(sinceStructure, since));
    const auto header = headerOf(response);

    CHECK(response->get_header_value("Content-Type") == "application/octet-stream");
    CHECK(response->get_header_value("Cache-Control") == "private, no-cache");

    for (const char* key : {"kind", "structure", "revision", "since", "sinceStructure",
                            "trackCount", "removed", "inserted", "columns", "spine"}) {
        CAPTURE(key);
        CHECK(header.contains(key));
    }

    CHECK(header.at("kind") == "splice");
    CHECK(header.at("structure") == state.structure);
    CHECK(header.at("revision") == state.revision);
    CHECK(header.at("since") == since);
    CHECK(header.at("sinceStructure") == sinceStructure);
    CHECK(header.at("trackCount") == next.size());
    CHECK(section(response, "removed") == removed);
    CHECK(section(response, "inserted") == inserted);

    if (inserted.empty()) {
        CHECK(header.at("columns").empty());
        CHECK(header.at("spine").empty());
    } else {
        CHECK(columnNames(header) == std::vector<std::string>{kTitle});
        CHECK(header.at("spine").size() == kSpineFieldCount);
    }

    const auto again = server.client().Get(
        changesFrom(sinceStructure, since),
        httplib::Headers{{"If-None-Match", response->get_header_value("ETag")}});
    REQUIRE(again);
    CHECK(again->status == 304);
}

TEST_CASE("a splice's validator names the structure it patches from") {
    Library library;
    std::vector<Row> rows = numbered(kTracks);
    install(library, rows);
    const uint64_t since = retitle(library, rows, 5);
    const uint64_t sinceStructure = library.state().structure;

    rows.push_back(newTrack("added"));
    install(library, rows);
    const uint64_t current = library.state().structure;

    const TestServer server(servingSettings(), Player{}, &library);
    const auto splice = get(server, changesFrom(sinceStructure, since));
    REQUIRE(splice);
    REQUIRE(splice->status == 200);
    const auto tag = splice->get_header_value("ETag");

    const auto neverHeld =
        server.client().Get(changesFrom(current, since), httplib::Headers{{"If-None-Match", tag}});
    checkExportAgain(neverHeld, 409);
}

TEST_CASE("a splice of half the export's bytes or more is a 410, and one under half is sent") {
    SUBCASE("a few tracks become many") {
        Library library;
        std::vector<Row> rows = numbered(4);
        install(library, rows);
        const uint64_t since = retitle(library, rows, 0);
        const uint64_t sinceStructure = library.state().structure;

        for (size_t added = 0; added < 40; ++added)
            rows.push_back(newTrack("added " + std::to_string(added)));
        install(library, rows);

        const TestServer server(servingSettings(), Player{}, &library);
        checkExportAgain(get(server, changesFrom(sinceStructure, since)), 410);
    }

    SUBCASE("one track joins many") {
        Library library;
        std::vector<Row> rows = numbered(200);
        install(library, rows);
        const uint64_t since = retitle(library, rows, 0);
        const uint64_t sinceStructure = library.state().structure;

        rows.push_back(newTrack("added"));
        install(library, rows);

        const TestServer server(servingSettings(), Player{}, &library);
        const auto exported = get(server, kTitleExport);
        const auto splice = get(server, changesFrom(sinceStructure, since));
        REQUIRE(exported);
        REQUIRE(exported->status == 200);
        CHECK(headerOf(splice).at("kind") == "splice");
        CHECK(2 * splice->body.size() < exported->body.size());
    }
}

TEST_CASE("a rebuild that moved the structure for anything but an addition or a removal is a 410") {
    Library library;
    std::vector<Row> rows = numbered(kTracks);
    install(library, rows);
    const uint64_t since = retitle(library, rows, 5);
    const uint64_t sinceStructure = library.state().structure;

    std::vector<Row> next = rows;
    std::vector<std::string> columns{kTitle};

    SUBCASE("the same tracks in another order") {
        std::swap(next[3], next[4]);
    }

    SUBCASE("a track added, and the ones already there in another order") {
        std::swap(next[3], next[4]);
        next.insert(next.begin() + 10, newTrack("added"));
    }

    SUBCASE("the same tracks under another column set") {
        columns = {kTitle, kArtist};
        for (Row& row : next)
            row.emplace_back("Someone");
    }

    SUBCASE("a track added under another column set") {
        columns = {kTitle, kArtist};
        next.emplace_back(newTrack("added"));
        for (Row& row : next)
            row.emplace_back("Someone");
    }

    library.replace(snapshotOf(columns, next));
    REQUIRE(library.state().structure != sinceStructure);

    const TestServer server(servingSettings(), Player{}, &library);
    checkExportAgain(get(server, changesFrom(sinceStructure, since)), 410);
}

TEST_CASE(
    "a pair before a reorder stays a 410 after a splice lands on top, and one after it is not") {
    Library library;
    std::vector<Row> rows = numbered(kTracks);
    install(library, rows);
    const uint64_t beforeReorder = retitle(library, rows, 5);
    const uint64_t firstStructure = library.state().structure;

    std::swap(rows[3], rows[4]);
    install(library, rows);
    const uint64_t afterReorder = retitle(library, rows, 6);
    const uint64_t reordered = library.state().structure;

    rows.push_back(newTrack("added"));
    install(library, rows);

    const TestServer server(servingSettings(), Player{}, &library);
    checkExportAgain(get(server, changesFrom(firstStructure, beforeReorder)), 410);
    CHECK(headerOf(get(server, changesFrom(reordered, afterReorder))).at("kind") == "splice");
}

TEST_CASE("a track added and removed again between two pairs is a splice of appended entries") {
    Library library;
    std::vector<Row> rows = numbered(kTracks);
    install(library, rows);
    retitle(library, rows, 5);

    const TestServer server(servingSettings(), Player{}, &library);
    const auto exported = get(server, kTitleExport);
    REQUIRE(exported);
    REQUIRE(exported->status == 200);
    HeldLibrary client = held(decode(exported->body));

    std::vector<Row> withIt = rows;
    withIt.insert(withIt.begin() + 7, newTrack("passing through"));
    install(library, withIt);
    install(library, rows);
    REQUIRE(library.state().structure != client.structure);

    const auto response = get(server, changesFrom(client.structure, client.revision));
    const auto header = headerOf(response);
    CHECK(header.at("kind") == "splice");
    CHECK(section(response, "removed").empty());
    CHECK(section(response, "inserted").empty());

    applyChanges(client, decode(response->body));

    const auto fresh = get(server, kTitleExport);
    REQUIRE(fresh);
    REQUIRE(fresh->status == 200);
    checkSameLibrary(client, held(decode(fresh->body)));
}

TEST_CASE("a rebuild that compacted the dictionaries is a 410 saying so") {
    constexpr size_t kBefore = 20;
    constexpr size_t kKept = 5;

    Library library;
    std::vector<Row> rows = numbered(kBefore);
    install(library, rows);
    const uint64_t since = retitle(library, rows, 0);
    const uint64_t sinceStructure = library.state().structure;

    rows.resize(kKept);
    install(library, rows);

    const TestServer server(servingSettings(), Player{}, &library);
    const auto response = get(server, changesFrom(sinceStructure, since));
    checkExportAgain(response, 410);
    CHECK(errorOf(*response) == describe(DeltaOutcome::dictionariesCompacted));
}

TEST_CASE(
    "a pair the retained window has left behind is a 410, and the oldest inside it a splice") {
    constexpr size_t kRetained = 3;

    Library library(kRetained);
    std::vector<Row> rows = numbered(kTracks);
    install(library, rows);
    const auto held = library.state();

    rows.push_back(newTrack("added"));
    install(library, rows);
    retitle(library, rows, 5);
    retitle(library, rows, 6);
    REQUIRE(library.state().revision == held.revision + kRetained);

    const TestServer server(servingSettings(), Player{}, &library);
    CHECK(headerOf(get(server, changesFrom(held.structure, held.revision))).at("kind") == "splice");

    retitle(library, rows, 7);
    checkExportAgain(get(server, changesFrom(held.structure, held.revision)), 410);
}

TEST_CASE("a pair this run never held is a 409, and each half of it is answered with its partner") {
    Library library;
    std::vector<Row> rows = numbered(kTracks);
    install(library, rows);
    const auto first = library.state();
    const uint64_t firstPlayed = retitle(library, rows, 5);

    rows.push_back(newTrack("added"));
    install(library, rows);
    const auto second = library.state();
    const uint64_t secondPlayed = retitle(library, rows, 6);

    const TestServer server(servingSettings(), Player{}, &library);

    CHECK(headerOf(get(server, changesFrom(first.structure, firstPlayed))).at("kind") == "splice");
    CHECK(headerOf(get(server, changesFrom(second.structure, second.revision))).at("kind") ==
          "delta");

    for (const auto& [name, structure, since] :
         std::vector<std::tuple<const char*, uint64_t, uint64_t>>{
             {"a structure ahead of the current one", second.structure + 1, secondPlayed},
             {"a revision of the first structure under the second", second.structure, firstPlayed},
             {"a revision of the second structure under the first", first.structure, secondPlayed},
             {"the second structure's first revision under the first", first.structure,
              second.revision}}) {
        CAPTURE(name);
        checkExportAgain(get(server, changesFrom(structure, since)), 409);
    }
}

TEST_CASE("a delta or a splice must name the structure as well as the revision it patches from") {
    Library library;
    install(library, numbered(kTracks));
    const TestServer server(servingSettings(), Player{}, &library);
    const TestServer off(servingSettings(), Player{}, nullptr);

    for (const char* query : {"since=1", "since=1&structure=", "since=1&structure=soon",
                              "since=1&structure=-1", "since=1&structure=99999999999999999999"}) {
        CAPTURE(query);

        for (const TestServer* asked : {&server, &off}) {
            const auto response = get(*asked, std::string("/api/library/changes?") + query);
            REQUIRE(response);
            CHECK(response->status == 400);
            if (response->status != 400)
                continue;

            const auto body = json::parse(response->body);
            CHECK(body.at("error") == "unacceptable revision");
            CHECK(body.at("detail").get<std::string>().find("structure") != std::string::npos);
        }
    }
}

namespace {

constexpr uint32_t kRemovedOrdinal = 3;

constexpr uint32_t kOrdinalReadBefore = 5;

struct Spliced {
    Library library;
    uint64_t before = 0;
    uint64_t revisionBefore = 0;
    uint64_t after = 0;

    Spliced() {
        buildLibrary(library, kTracks);
        before = library.state().structure;
        revisionBefore = library.state().revision;

        std::vector<Row> rows;
        for (size_t number = 0; number < kTracks; ++number) {
            if (number == kRemovedOrdinal)
                continue;
            const auto path = splitRelativePath(builtTrackPath(number));
            rows.push_back({path.directory, path.filename, "0", builtTrackTitle(number)});
        }
        library.replace(snapshotOf({"%title%"}, rows));
        after = library.state().structure;
    }

    void checkASpliceWasSent(const TestServer& server) const {
        CHECK(headerOf(get(server, changesFrom(before, revisionBefore))).at("kind") == "splice");
    }
};

std::string ratingAtOrdinal(uint32_t ordinal, uint64_t structure) {
    return json{{"ordinal", ordinal}, {"structure", structure}, {"fields", {{"rating", kRating}}}}
        .dump();
}

std::string ordinalsAt(uint64_t structure) {
    return json{{"structure", structure}, {"ordinals", {kOrdinalReadBefore}}}.dump();
}

}  // namespace

TEST_CASE(
    "an ordinal read before a splice is a 409 on every route that takes one, and lands nothing") {
    Spliced spliced;
    REQUIRE(spliced.after != spliced.before);

    SUBCASE("a tag write") {
        TestServer::WriterLog log;
        const TestServer server(servingSettings(), TestServer::recordingWriter(&log),
                                &spliced.library);
        spliced.checkASpliceWasSent(server);

        const auto stale =
            post(server, "/api/tags", ratingAtOrdinal(kOrdinalReadBefore, spliced.before));
        REQUIRE(stale);
        CHECK(stale->status == 409);
        CHECK(log.calls.empty());

        const auto current =
            post(server, "/api/tags", ratingAtOrdinal(kOrdinalReadBefore, spliced.after));
        REQUIRE(current);
        CHECK(current->status == 200);
        REQUIRE(log.calls.size() == 1);
        REQUIRE(log.calls[0].track.ordinal.has_value());
        CHECK(log.calls[0].track.ordinal->structure == spliced.after);
    }

    SUBCASE("a playlist fill") {
        FakePlayer foobar(&spliced.library);
        PlaylistAnnotation playlist;
        playlist.id = kPlaylistId;
        playlist.title = "Road trip";
        foobar.add(playlist);
        const TestServer server(servingSettings(), foobar.player(), &spliced.library);
        spliced.checkASpliceWasSent(server);

        const std::string fill = std::string("/api/playlists/") + kPlaylistId + "/items";

        const auto stale = post(server, fill, ordinalsAt(spliced.before));
        REQUIRE(stale);
        CHECK(stale->status == 409);
        CHECK(foobar.titlesOf(kPlaylistId).empty());

        const auto current = post(server, fill, ordinalsAt(spliced.after));
        REQUIRE(current);
        CHECK(current->status == 200);
        CHECK(foobar.titlesOf(kPlaylistId).size() == 1);
    }

    SUBCASE("the queue") {
        FakePlayer foobar(&spliced.library);
        const TestServer server(servingSettings(), foobar.player(), &spliced.library);
        spliced.checkASpliceWasSent(server);

        const auto stale = post(server, "/api/queue", ordinalsAt(spliced.before));
        REQUIRE(stale);
        CHECK(stale->status == 409);
        CHECK(foobar.queued().empty());

        const auto current = post(server, "/api/queue", ordinalsAt(spliced.after));
        REQUIRE(current);
        CHECK(current->status == 204);
        CHECK(foobar.queued().size() == 1);
    }
}
