#include "third_party/doctest.h"

#include "core/documents.h"
#include "core/failures.h"
#include "core/library.h"
#include "core/ordinal_sets.h"
#include "core/player_outcome.h"
#include "core/selection.h"
#include "support/fake_player.h"
#include "support/fixtures.h"
#include "support/keys.h"
#include "support/question_library.h"
#include "support/summary_cases.h"
#include "support/summary_library.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kFindCases[] = "playlist_find_cases.json";
constexpr char kBasic[] = "basic: search a query that folds to nothing, empty";

// Nineteen digits, as a live playlist's counters are, and each within five hundred of
// kThroughADouble: a counter read or written as a JSON number lands on that instead.
constexpr uint64_t kFindStructure = 9204739866101318923ULL;
constexpr uint64_t kFindRevision = 9204739866101318977ULL;
constexpr uint64_t kThroughADouble = 9204739866101318656ULL;

constexpr char kUnknownPlaylistId[] = "0f0f0f0f-0000-4000-8000-000000000001";

constexpr std::array<const char*, 5> kSearchedRoles{"title", "artist", "albumArtist", "album",
                                                    "artistSort"};

const json& findCase(std::string_view name) {
    for (const json& found : casesIn(kFindCases).at("cases")) {
        if (found.at("name").get_ref<const std::string&>() == name)
            return found;
    }
    FAIL("the find cases hold no case named ", std::string(name));
    return casesIn(kFindCases);
}

std::string expressionOf(const char* role) {
    return std::string("%") + role + "%";
}

// The generator reads a searched role the questions case leaves out as unresolved on every track,
// and still searches an outside row's own value for it, so the library declares it unresolved and
// the request names it.
QuestionLibrary searchingEveryRole(QuestionLibrary library) {
    for (const char* role : kSearchedRoles) {
        const bool named =
            std::any_of(library.roles.begin(), library.roles.end(),
                        [role](const RoleAsked& asked) { return asked.name == role; });
        if (named)
            continue;
        library.declared.push_back(expressionOf(role));
        library.roles.push_back({role, expressionOf(role)});
        for (auto& row : library.rows)
            row.emplace_back(kUnresolved);
    }
    return library;
}

// A library row carries no fields of its own, so a find that formatted it rather than reading the
// snapshot would see every field unresolved and miss it.
std::vector<FakeRow> playlistRowsOf(const json& findCase, const QuestionLibrary& library) {
    std::vector<FakeRow> rows;
    for (const json& row : findCase.at("rows")) {
        FakeRow fake;
        if (row.contains("ordinal")) {
            const auto& spine = library.rows.at(row.at("ordinal").get<size_t>());
            fake.libraryPath = spine.at(0) + spine.at(1);
            fake.subsong = static_cast<uint32_t>(std::stoul(spine.at(2)));
        } else {
            for (const char* role : kSearchedRoles)
                fake.fields[expressionOf(role)] = row.at(role).get<std::string>();
        }
        rows.push_back(std::move(fake));
    }
    return rows;
}

PlaylistAnnotation searchedPlaylist() {
    PlaylistAnnotation playlist;
    playlist.id = kPlaylistId;
    playlist.title = "Road trip";
    playlist.structure = kFindStructure;
    playlist.revision = kFindRevision;
    return playlist;
}

std::string encoded(const std::string& value) {
    return httplib::encode_query_component(value, false);
}

std::string findPath(const std::string& id, const std::string& query, const std::string& structure,
                     const std::vector<RoleAsked>& roles) {
    std::string path = "/api/playlists/" + id + "/find?query=" + encoded(query) +
                       "&structure=" + encoded(structure);
    for (const RoleAsked& role : roles)
        path += "&" + role.name + "=" + encoded(role.expression);
    return path;
}

std::vector<RoleAsked> withRole(std::vector<RoleAsked> roles, const char* name,
                                const std::string& expression) {
    for (RoleAsked& role : roles) {
        if (role.name == name)
            role.expression = expression;
    }
    return roles;
}

struct Served {
    const json& asked;
    QuestionLibrary questions;
    Library library;
    FakePlayer foobar{&library};
    TestServer server;

    explicit Served(std::string_view name = kBasic)
        : asked(findCase(name)),
          questions(searchingEveryRole(questionLibraryOf(questionCase(name)))),
          server(servingSettings(), foobar.player(), &library) {
        library.replace(questions.snapshot());
        REQUIRE(library.state().ready);
        foobar.add(searchedPlaylist(), playlistRowsOf(asked, questions));
    }

    size_t rowCount() const { return asked.at("rows").size(); }

    std::string path(const std::string& query) const {
        return findPath(kPlaylistId, query, std::to_string(kFindStructure), questions.roles);
    }

    httplib::Result find(const std::string& query) const { return get(server, path(query)); }
};

std::vector<uint32_t> positionsIn(const json& matched, size_t rowCount) {
    REQUIRE(matched.is_object());
    REQUIRE(matched.size() == 1);
    const SelectionResult read = decodeSelection(matched, rowCount);
    REQUIRE(read.ok());
    return read.ordinals;
}

json documentOf(const httplib::Response& response) {
    return json::parse(response.body, nullptr, false);
}

bool variesOnEncoding(const httplib::Response& response) {
    for (size_t at = 0; at < response.get_header_value_count("Vary"); ++at) {
        if (response.get_header_value("Vary", "", at).find("Accept-Encoding") != std::string::npos)
            return true;
    }
    return false;
}

std::string twoByteQuery(size_t characters) {
    std::string query;
    for (size_t at = 0; at < characters; ++at)
        query += "é";
    return query;
}

}  // namespace

TEST_CASE("a find answers the playlist's pair and the positions today's rowMatches gives") {
    size_t queries = 0;
    for (const json& asked : casesIn(kFindCases).at("cases")) {
        const std::string& name = asked.at("name").get_ref<const std::string&>();
        INFO("case: ", name);
        const Served served(name);

        for (const json& query : asked.at("queries")) {
            const std::string& typed = query.at("query").get_ref<const std::string&>();
            INFO("query: '", typed, "'");
            const auto response = served.find(typed);
            REQUIRE(response);
            REQUIRE(response->status == 200);

            const json document = documentOf(*response);
            CHECK(keysOf(document) == Keys{"structure", "revision", "matched"});
            CHECK(document.at("structure") == std::to_string(kFindStructure));
            CHECK(document.at("revision") == std::to_string(kFindRevision));
            const auto expected = query.at("matched").get<std::vector<uint32_t>>();
            CHECK(positionsIn(document.at("matched"), served.rowCount()) == expected);
            // An OrdinalSet's form and a bitset's length are counted against the playlist's rows,
            // as contract/openapi.yaml's Bitset gives, not against the library's tracks.
            CHECK(document.at("matched") == ordinalSetDocument(expected, served.rowCount()));
            ++queries;
        }
    }
    CHECK(queries == 195);
}

TEST_CASE("a find copies the playlist once and asks the player for nothing else") {
    const Served served;

    const auto response = served.find("babas");
    REQUIRE(response);
    REQUIRE(response->status == 200);
    CHECK(served.foobar.count(Call::readTracks) == 1);
    CHECK(served.foobar.total() == 1);
    CHECK(served.foobar.askedAbout(Call::readTracks) == std::vector<std::string>{kPlaylistId});
}

TEST_CASE("a find is held by nobody but the client that asked, gzipped where offered") {
    const Served served;
    auto client = undecoding(served.server);

    const auto packed = client.Get(served.path("a"), accepting("gzip"));
    const auto plain = client.Get(served.path("a"), accepting("identity"));
    REQUIRE(packed);
    REQUIRE(plain);
    REQUIRE(packed->status == 200);
    REQUIRE(plain->status == 200);

    CHECK(plain->get_header_value("Content-Type") == "application/json");
    CHECK(plain->get_header_value("Cache-Control") == "private, no-cache");
    CHECK(plain->get_header_value("Content-Encoding").empty());
    CHECK(variesOnEncoding(*plain));

    CHECK(packed->get_header_value("Content-Encoding") == "gzip");
    CHECK(isGzip(packed->body));
    CHECK(variesOnEncoding(*packed));
}

// A client holding positions counted at one structure and shown matches counted at another
// highlights the wrong rows, so a find at a structure the playlist has moved past is refused. The
// rounded one is what a client reading the counter as a JSON number sends back.
TEST_CASE("a find at a structure that is not the playlist's is a 409 telling it to read again") {
    const Served served;

    for (const uint64_t stale : {kFindStructure + 1, kFindStructure - 1, kThroughADouble}) {
        INFO("structure: ", stale);
        const auto response =
            get(served.server,
                findPath(kPlaylistId, "babas", std::to_string(stale), served.questions.roles));
        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(errorOf(*response) == describe(PlayerOutcome::rowsMoved));
    }
}

TEST_CASE("a find in a playlist the player does not have is a 404") {
    const Served served;

    const auto response =
        get(served.server, findPath(kUnknownPlaylistId, "babas", std::to_string(kFindStructure),
                                    served.questions.roles));
    REQUIRE(response);
    CHECK(response->status == 404);
    CHECK(errorOf(*response) == describe(PlayerOutcome::noSuchPlaylist));
}

TEST_CASE("a query of 1024 bytes is found, and one byte more is refused however few characters") {
    const Served served;
    const json tooLong{{"error", "unacceptable question"},
                       {"detail", "'query' must be at most 1024 bytes"}};

    struct Asked {
        const char* what;
        std::string query;
        int status;
    };
    const std::vector<Asked> queries{
        {"1024 single-byte characters", std::string(1024, 'a'), 200},
        {"1025 single-byte characters", std::string(1025, 'a'), 400},
        {"512 two-byte characters", twoByteQuery(512), 200},
        {"512 two-byte characters and one byte more", twoByteQuery(512) + "a", 400},
    };
    for (const auto& query : queries) {
        INFO("query: ", query.what);
        const int before = served.foobar.total();
        const auto response = served.find(query.query);
        REQUIRE(response);
        CHECK(response->status == query.status);
        if (query.status == 400) {
            CHECK(documentOf(*response) == tooLong);
            CHECK(served.foobar.total() == before);
        }
    }
}

TEST_CASE("a find whose roles or query cannot be read is a 400 saying so, before the player") {
    const Served served;
    const std::string structure = "&structure=" + std::to_string(kFindStructure);
    const std::string tooLong = "role 'album' must be printable text of 1 to " +
                                std::to_string(kMaxColumnLength) + " characters";

    struct Refused {
        const char* what;
        std::string query;
        const char* error;
        std::string detail;
    };
    const std::vector<Refused> refused{
        {"a name that is no role", "query=a" + structure + "&colour=%25title%25",
         "unacceptable role", "'colour' is not a role"},
        {"the search route's own parameter", "query=a" + structure + "&limit=8",
         "unacceptable role", "'limit' is not a role"},
        {"the album route's own parameter", "query=a" + structure + "&name=Rock",
         "unacceptable role", "'name' is not a role"},
        {"an empty expression", "query=a" + structure + "&album=", "unacceptable role", tooLong},
        {"a role named twice", "query=a" + structure + "&album=%25album%25&album=%25artist%25",
         "duplicate role", "role 'album' is named twice"},
        {"an offending role before a missing query", structure.substr(1) + "&colour=x",
         "unacceptable role", "'colour' is not a role"},
        {"no query", structure.substr(1) + "&title=%25title%25", "unacceptable question",
         "'query' is required"},
        {"a query named twice", "query=a&query=b" + structure, "duplicate question",
         "'query' is named twice"},
    };

    for (const auto& request : refused) {
        INFO("refused: ", request.what);
        const auto response = get(
            served.server, std::string("/api/playlists/") + kPlaylistId + "/find?" + request.query);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(documentOf(*response) == json{{"error", request.error}, {"detail", request.detail}});
    }
    CHECK(served.foobar.total() == 0);
}

// contract/openapi.yaml publishes `structure` as a run of decimal digits and the 400 for one that
// is not; which sentence it carries is not published, so only the status is held.
TEST_CASE("a find with no structure, or one that is not a run of digits, is a 400") {
    const Served served;

    for (const std::string structure : {"", "x", "-1", "1.5", "%2B1", "18446744073709551616"}) {
        INFO("structure: '", structure, "'");
        const auto response =
            get(served.server, "/api/playlists/" + std::string(kPlaylistId) +
                                   "/find?query=a&structure=" + structure + "&title=%25title%25");
        REQUIRE(response);
        CHECK(response->status == 400);
    }

    const auto missing = get(served.server, "/api/playlists/" + std::string(kPlaylistId) +
                                                "/find?query=a&title=%25title%25");
    REQUIRE(missing);
    CHECK(missing->status == 400);
    CHECK(served.foobar.total() == 0);
}

TEST_CASE("without the media library a find is a 503, after what it asks is judged") {
    const QuestionLibrary questions = questionLibraryOf(questionCase(kBasic));
    FakePlayer foobar;
    foobar.add(searchedPlaylist(), titledRows({"babas"}));
    const TestServer server(servingSettings(), foobar.player());

    const auto refused = get(server, findPath(kPlaylistId, std::string(1025, 'a'),
                                              std::to_string(kFindStructure), questions.roles));
    REQUIRE(refused);
    CHECK(refused->status == 400);

    const auto unavailable = get(
        server, findPath(kPlaylistId, "babas", std::to_string(kFindStructure), questions.roles));
    REQUIRE(unavailable);
    CHECK(unavailable->status == 503);
    CHECK(errorOf(*unavailable) == kNoLibrary);
    CHECK(foobar.total() == 0);
}

TEST_CASE("with no snapshot ready a find answers the library document and starts no build") {
    const QuestionLibrary questions = questionLibraryOf(questionCase(kBasic));
    Library library;
    FakePlayer foobar(&library);
    foobar.add(searchedPlaylist(), titledRows({"babas"}));
    std::atomic<int> builds{0};
    Player player = foobar.player();
    player.library.refresh = [&builds](const std::vector<std::string>& /*columns*/,
                                       RebuildReason /*why*/) { ++builds; };
    const TestServer server(servingSettings(), player, &library);

    const auto response = get(
        server, findPath(kPlaylistId, "babas", std::to_string(kFindStructure), questions.roles));
    REQUIRE(response);
    CHECK(response->status == 202);
    const json document = documentOf(*response);
    CHECK(document.at("ready") == false);
    CHECK(document == json::parse(libraryDocument(library.state())));
    CHECK(builds == 0);
    CHECK(foobar.total() == 0);
}

TEST_CASE("a find naming a column the declaration does not hold is a 409 naming it") {
    const Served served;

    const auto response =
        get(served.server, findPath(kPlaylistId, "babas", std::to_string(kFindStructure),
                                    withRole(served.questions.roles, "genre", "%comment%")));
    REQUIRE(response);
    CHECK(response->status == 409);
    CHECK(errorOf(*response) == "'%comment%' is not a declared column");
    CHECK(served.foobar.total() == 0);
}

TEST_CASE("finds past their own budget are refused with a 429 saying how long to wait") {
    const Served served;

    int answered = 0;
    httplib::Result last;
    for (; answered <= 200; ++answered) {
        last = served.find("babas");
        REQUIRE(last);
        if (last->status != 200)
            break;
    }
    CHECK(answered == 200);
    REQUIRE(last->status == 429);
    CHECK(documentOf(*last) == json{{"error", "too many playlist searches"}});
    const auto wait = last->get_header_value("Retry-After");
    CHECK_FALSE(wait.empty());
    CHECK(wait.find_first_not_of("0123456789") == std::string::npos);
    CHECK(served.foobar.count(Call::readTracks) == 200);
}
