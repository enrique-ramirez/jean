#include "third_party/doctest.h"

#include "core/failures.h"
#include "core/library.h"
#include "core/library_roles.h"
#include "support/fake_player.h"
#include "support/fixtures.h"
#include "support/keys.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <atomic>
#include <cctype>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kAlbum[] = "%album%";
constexpr char kAlbumArtist[] = "%album artist%";
constexpr char kArtist[] = "%artist%";
constexpr char kDisc[] = "%discnumber%";
constexpr char kPlays[] = "%play_count%";
constexpr char kLocalPlays[] = "%jean_plays%";
constexpr char kSeconds[] = "%length_seconds%";
constexpr char kYear[] = "$year(%date%)";
constexpr char kTitle[] = "%title%";

const std::vector<std::string>& declared() {
    static const std::vector<std::string> columns{kAlbum,      kAlbumArtist, kArtist, kDisc, kPlays,
                                                  kLocalPlays, kSeconds,     kYear,   kTitle};
    return columns;
}

struct Role {
    std::string name;
    std::string expression;
};

const std::vector<Role>& roles() {
    static const std::vector<Role> asked{
        {"album", kAlbum},      {"albumArtist", kAlbumArtist},
        {"artist", kArtist},    {"discNumber", kDisc},
        {"playCount", kPlays},  {"playCountLocal", kLocalPlays},
        {"duration", kSeconds}, {"year", kYear},
        {"title", kTitle},
    };
    return asked;
}

// A playlist's two counters past 2^53, where a JSON number stops being exact, so a structure one
// away from the playlist's is a near miss a double cannot tell from it.
constexpr uint64_t kStructure = 9204739866101318923ULL;
constexpr uint64_t kRevision = 9204739866101318977ULL;

constexpr char kSecondPlaylistId[] = "22222222-2222-2222-2222-222222222222";
constexpr char kUnknownPlaylistId[] = "33333333-3333-4333-8333-333333333333";

constexpr char kRowsMoved[] =
    "the playlist's rows were added, removed or reordered; read them again";

std::string queryEncoded(std::string_view text) {
    std::string escaped;
    for (const char character : text) {
        const auto byte = static_cast<unsigned char>(character);
        if (std::isalnum(byte) != 0) {
            escaped += character;
            continue;
        }
        char hex[4];
        std::snprintf(hex, sizeof hex, "%%%02X", byte);
        escaped += hex;
    }
    return escaped;
}

std::string rolesQuery(const std::vector<Role>& asked) {
    std::string query;
    for (const Role& role : asked)
        query += "&" + role.name + "=" + queryEncoded(role.expression);
    return query;
}

std::string runsPath(const std::string& id, const std::string& structure,
                     const std::vector<Role>& asked = roles()) {
    return "/api/playlists/" + id + "/runs?structure=" + structure + rolesQuery(asked);
}

std::string runsPath(const std::string& id = kPlaylistId, uint64_t structure = kStructure) {
    return runsPath(id, std::to_string(structure));
}

std::vector<Role> rolesWith(const std::string& name, const std::string& expression) {
    auto asked = roles();
    for (Role& role : asked) {
        if (role.name == name)
            role.expression = expression;
    }
    return asked;
}

struct Tags {
    const char* album = kUnresolved;
    const char* albumArtist = kUnresolved;
    const char* artist = kUnresolved;
    const char* plays = kUnresolved;
    const char* seconds = kUnresolved;
    const char* year = kUnresolved;
};

std::map<std::string, std::string> fieldsOf(const Tags& tags, const std::string& title) {
    return {{kAlbum, tags.album},     {kAlbumArtist, tags.albumArtist},
            {kArtist, tags.artist},   {kDisc, "1"},
            {kPlays, tags.plays},     {kLocalPlays, kUnresolved},
            {kSeconds, tags.seconds}, {kYear, tags.year},
            {kTitle, title}};
}

const std::vector<Tags>& libraryTags() {
    static const std::vector<Tags> tracks{
        {"Kid A", "Radiohead", "Radiohead", "3", "200", "2000"},
        {"Kid A", "Radiohead", "Radiohead", "5", "300", "2000"},
        {"Amnesiac", "Radiohead", "Radiohead", "2", "250", "2001"},
        {"Amnesiac", "Radiohead", "Radiohead", "1", "240", "2001"},
        {kUnresolved, kUnresolved, "Loner", "1", "100", kUnresolved},
        {"Mezzanine", "Massive Attack", "Massive Attack", "50", "330", "1998"},
    };
    return tracks;
}

constexpr uint32_t kAmnesiacSecond = 3;
constexpr uint32_t kKidAFirst = 0;
constexpr uint32_t kKidASecond = 1;

std::vector<std::string> libraryRowOf(uint32_t ordinal, const Tags& tags) {
    const std::string path = builtTrackPath(ordinal);
    const size_t slash = path.rfind('/') + 1;
    std::vector<std::string> row{path.substr(0, slash), path.substr(slash), "0"};
    const auto fields = fieldsOf(tags, builtTrackTitle(ordinal));
    for (const std::string& column : declared())
        row.push_back(fields.at(column));
    return row;
}

Snapshot librarySnapshot() {
    std::vector<std::vector<std::string>> rows;
    for (uint32_t ordinal = 0; ordinal < libraryTags().size(); ++ordinal)
        rows.push_back(libraryRowOf(ordinal, libraryTags()[ordinal]));
    return snapshotOf(declared(), rows);
}

FakeRow heldRow(uint32_t ordinal) {
    return libraryTrack(ordinal);
}

FakeRow strayRow(const Tags& tags, const std::string& title) {
    FakeRow row;
    row.fields = fieldsOf(tags, title);
    return row;
}

constexpr uint32_t kStrayAmnesiac = 3;
constexpr uint32_t kStrayDrifter = 5;

FakeRow strayKidA() {
    return strayRow({"Kid A", "Radiohead", "Radiohead", "4", "210", "2003"}, "Stray Kid A");
}

FakeRow strayAmnesiac() {
    return strayRow({"Amnesiac", "Radiohead", "Radiohead", "2", "230", "1997"}, "Stray Amnesiac");
}

FakeRow strayDrifter(const char* plays = "1") {
    return strayRow({.artist = "Drifter", .plays = plays, .seconds = "60"}, "Drifted in");
}

std::vector<FakeRow> roadTripRows() {
    return {heldRow(kKidASecond), heldRow(kKidAFirst), strayKidA(),
            strayAmnesiac(),      heldRow(2),          strayDrifter()};
}

PlaylistAnnotation playlistNamed(const std::string& id, const std::string& title) {
    PlaylistAnnotation playlist;
    playlist.id = id;
    playlist.title = title;
    playlist.structure = kStructure;
    playlist.revision = kRevision;
    return playlist;
}

json documentOf(const httplib::Response& response) {
    return json::parse(response.body, nullptr, false);
}

std::string etagOf(const httplib::Result& response) {
    REQUIRE(response);
    REQUIRE(response->status == 200);
    const auto tag = response->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());
    return tag;
}

bool variesOnEncoding(const httplib::Response& response) {
    for (size_t at = 0; at < response.get_header_value_count("Vary"); ++at) {
        if (response.get_header_value("Vary", "", at).find("Accept-Encoding") != std::string::npos)
            return true;
    }
    return false;
}

std::string digits(uint64_t counter) {
    return "\"" + std::to_string(counter) + "\"";
}

struct Setup {
    bool snapshot = true;
    std::function<void(FakePlayer&)> holding;
    std::function<void(Player&)> wiring;
};

struct Served {
    Library library;
    FakePlayer foobar{&library};
    std::atomic<int> refreshes{0};
    std::unique_ptr<TestServer> server;

    explicit Served(const Setup& setup = {}) {
        if (setup.snapshot)
            library.replace(librarySnapshot());
        foobar.add(playlistNamed(kPlaylistId, "Road trip"), roadTripRows());
        if (setup.holding)
            setup.holding(foobar);

        Player player = foobar.player();
        player.library.refresh = [this](const std::vector<std::string>& /*columns*/,
                                        RebuildReason /*why*/) { ++refreshes; };
        if (setup.wiring)
            setup.wiring(player);
        server = std::make_unique<TestServer>(servingSettings(), player, &library);
    }

    httplib::Result ask(const std::string& path = runsPath()) const { return get(*server, path); }

    httplib::Result askHolding(const std::string& tag) const {
        return server->client().Get(runsPath(), httplib::Headers{{"If-None-Match", tag}});
    }

    void play(uint32_t ordinal, const char* plays) {
        Tags tags = libraryTags()[ordinal];
        tags.plays = plays;
        library.apply({RowChange{ordinal, libraryRowOf(ordinal, tags)}});
    }

    int copies() const { return foobar.count(Call::readTracks); }
};

}  // namespace

TEST_CASE(
    "a playlist's runs and figures are answered at its own pair, over its library rows and the "
    "rows outside the library alike") {
    Served at;

    const auto response = at.ask();
    REQUIRE(response);
    REQUIRE(response->status == 200);
    CHECK(response->get_header_value("Content-Type") == "application/json");

    const auto document = documentOf(*response);
    CHECK(keysOf(document) == Keys{"structure", "revision", "lengths", "mostPlays", "albumCount",
                                   "trackCount", "seconds", "earliestYear", "latestYear"});
    CHECK(document.at("structure").dump() == digits(kStructure));
    CHECK(document.at("revision").dump() == digits(kRevision));

    CHECK(document.at("lengths") == json::array({3, 2, 1}));
    CHECK(document.at("mostPlays") == 5);
    CHECK(document.at("albumCount") == 2);
    CHECK(document.at("trackCount") == 6);
    CHECK(document.at("seconds") == 300 + 200 + 210 + 230 + 250 + 60);
    CHECK(document.at("earliestYear") == 1997);
    CHECK(document.at("latestYear") == 2003);
    for (const char* integer :
         {"mostPlays", "albumCount", "trackCount", "earliestYear", "latestYear"}) {
        INFO("field: ", integer);
        CHECK(document.at(integer).is_number_integer());
    }
}

// fb2k/playlist_reads.cpp copies a page of handles in one main-thread job; the runs read every row
// of the playlist and still cost one.
TEST_CASE("a playlist's runs copy its rows from the player once, and page through none of them") {
    Served at;

    const auto response = at.ask();
    REQUIRE(response);
    REQUIRE(response->status == 200);
    CHECK(at.copies() == 1);
    CHECK(at.foobar.count(Call::readRows) == 0);
    CHECK(at.foobar.askedAbout(Call::readTracks) == std::vector<std::string>{kPlaylistId});
    CHECK(at.foobar.writes() == 0);
    CHECK(at.refreshes == 0);
}

TEST_CASE("playlist runs are held by nobody but the client that asked, under a strong validator") {
    Served at;

    const auto response = at.ask();
    REQUIRE(response);
    REQUIRE(response->status == 200);
    CHECK(response->get_header_value("Cache-Control") == "private, no-cache");
    const auto tag = etagOf(response);
    CHECK(tag.front() == '"');
    CHECK(tag.back() == '"');
}

TEST_CASE("playlist runs are gzipped where offered, sent as they stand where not, and vary on it") {
    Served at;
    auto client = at.server->client();
    client.set_decompress(false);

    const auto packed = client.Get(runsPath(), accepting("gzip"));
    const auto plain = client.Get(runsPath(), accepting("identity"));
    REQUIRE(packed);
    REQUIRE(plain);
    REQUIRE(packed->status == 200);
    REQUIRE(plain->status == 200);

    CHECK(packed->get_header_value("Content-Encoding") == "gzip");
    CHECK(isGzip(packed->body));
    CHECK(variesOnEncoding(*packed));

    CHECK(plain->get_header_value("Content-Encoding").empty());
    CHECK(documentOf(*plain).at("lengths") == json::array({3, 2, 1}));
    CHECK(variesOnEncoding(*plain));
}

TEST_CASE("playlist runs asked for again with their ETag are answered 304 with no body") {
    Served at;
    const auto tag = etagOf(at.ask());

    const auto again = at.askHolding(tag);
    REQUIRE(again);
    CHECK(again->status == 304);
    CHECK(again->body.empty());
    CHECK(again->get_header_value("ETag") == tag);
}

// A playlist's revision moves about once per track played from it, and a client revalidates its
// runs each time: a play that is not the highest moves no run and no figure.
TEST_CASE(
    "a revision that moves no run and no figure keeps the ETag, so a client holding it is "
    "answered 304") {
    Served at;
    const auto tag = etagOf(at.ask());

    at.foobar.retag(kPlaylistId, {{kStrayDrifter, strayDrifter("2")}});
    const uint64_t revision = at.foobar.playlist(kPlaylistId)->revision;
    REQUIRE(revision != kRevision);

    const auto held = at.askHolding(tag);
    REQUIRE(held);
    CHECK(held->status == 304);
    CHECK(held->body.empty());

    const auto fresh = at.ask();
    CHECK(etagOf(fresh) == tag);
    CHECK(documentOf(*fresh).at("revision").dump() == digits(revision));

    at.play(kKidAFirst, "4");
    const auto libraryPlayed = at.askHolding(tag);
    REQUIRE(libraryPlayed);
    CHECK(libraryPlayed->status == 304);
}

TEST_CASE(
    "a library row played past the most plays moves the ETag though the playlist's pair "
    "stood still") {
    Served at;
    const auto tag = etagOf(at.ask());

    at.play(kKidASecond, "9");

    const auto moved = at.askHolding(tag);
    REQUIRE(moved);
    CHECK(moved->status == 200);
    CHECK(etagOf(moved) != tag);
    const auto document = documentOf(*moved);
    CHECK(document.at("mostPlays") == 9);
    CHECK(document.at("revision").dump() == digits(kRevision));
}

TEST_CASE("a row outside the library played past the most plays moves the ETag") {
    Served at;
    const auto tag = etagOf(at.ask());

    at.foobar.retag(kPlaylistId, {{kStrayDrifter, strayDrifter("11")}});

    const auto moved = at.askHolding(tag);
    REQUIRE(moved);
    CHECK(moved->status == 200);
    CHECK(etagOf(moved) != tag);
    CHECK(documentOf(*moved).at("mostPlays") == 11);
}

TEST_CASE("a row outside the library retagged into its neighbour's album moves the runs") {
    Served at;
    const auto tag = etagOf(at.ask());

    FakeRow retagged = strayAmnesiac();
    retagged.fields.at(kAlbum) = "Kid A";
    at.foobar.retag(kPlaylistId, {{kStrayAmnesiac, retagged}});

    const auto moved = at.askHolding(tag);
    REQUIRE(moved);
    CHECK(moved->status == 200);
    CHECK(etagOf(moved) != tag);
    const auto document = documentOf(*moved);
    CHECK(document.at("lengths") == json::array({4, 1, 1}));
    CHECK(document.at("albumCount") == 2);
}

TEST_CASE("a row added is a 409 at the structure before it and answers new runs at the one after") {
    Served at;
    const auto tag = etagOf(at.ask());

    const auto filled = post(*at.server, std::string("/api/playlists/") + kPlaylistId + "/items",
                             json{{"structure", at.library.state().structure},
                                  {"ordinals", json::array({kAmnesiacSecond})}}
                                 .dump());
    REQUIRE(filled);
    REQUIRE(filled->status == 200);
    const uint64_t structure = at.foobar.playlist(kPlaylistId)->structure;
    REQUIRE(structure != kStructure);

    const auto stale = at.ask();
    REQUIRE(stale);
    CHECK(stale->status == 409);
    CHECK(errorOf(*stale) == kRowsMoved);

    const auto moved = at.server->client().Get(runsPath(kPlaylistId, structure),
                                               httplib::Headers{{"If-None-Match", tag}});
    REQUIRE(moved);
    CHECK(moved->status == 200);
    CHECK(etagOf(moved) != tag);
    const auto document = documentOf(*moved);
    CHECK(document.at("structure").dump() == digits(structure));
    CHECK(document.at("lengths") == json::array({3, 2, 1, 1}));
    CHECK(document.at("trackCount") == 7);
}

TEST_CASE("two playlists at the same pair are each answered their own runs") {
    Served at({.holding = [](FakePlayer& foobar) {
        foobar.add(playlistNamed(kSecondPlaylistId, "Sundays"), {heldRow(kKidAFirst), heldRow(2)});
    }});

    const auto first = at.ask();
    const auto second = at.ask(runsPath(kSecondPlaylistId));
    const auto firstAgain = at.ask();
    REQUIRE(first);
    REQUIRE(second);
    REQUIRE(firstAgain);
    REQUIRE(second->status == 200);

    CHECK(documentOf(*first).at("lengths") == json::array({3, 2, 1}));
    CHECK(documentOf(*second).at("lengths") == json::array({1, 1}));
    CHECK(documentOf(*second).at("trackCount") == 2);
    CHECK(documentOf(*firstAgain).at("lengths") == json::array({3, 2, 1}));
    CHECK(etagOf(second) != etagOf(first));
}

TEST_CASE("playlist runs take every role the four questions take") {
    Served at;

    std::vector<Role> every;
    for (const std::string_view name : kAllRoleNames) {
        std::string expression = kTitle;
        for (const Role& role : roles()) {
            if (role.name == name)
                expression = role.expression;
        }
        every.push_back({std::string(name), expression});
    }

    const auto response = at.ask(runsPath(kPlaylistId, std::to_string(kStructure), every));
    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(documentOf(*response).at("lengths") == json::array({3, 2, 1}));
}

// One past the playlist's structure parses to the same double, so a structure read through a
// JSON number would be answered as if it were current.
TEST_CASE(
    "a structure that is not the playlist's is a 409 its error tells from an undeclared "
    "role") {
    Served at;

    const auto stale = at.ask(runsPath(kPlaylistId, kStructure + 1));
    REQUIRE(stale);
    CHECK(stale->status == 409);
    CHECK(errorOf(*stale) == kRowsMoved);

    const int copiesBefore = at.copies();
    const auto undeclared =
        at.ask(runsPath(kPlaylistId, std::to_string(kStructure), rolesWith("album", "%comment%")));
    REQUIRE(undeclared);
    CHECK(undeclared->status == 409);
    CHECK(errorOf(*undeclared) == "'%comment%' is not a declared column");
    CHECK(at.copies() == copiesBefore);
    CHECK(at.refreshes == 0);
}

TEST_CASE("runs of a playlist the player does not hold are a 404") {
    Served at;

    const auto response = at.ask(runsPath(kUnknownPlaylistId));
    REQUIRE(response);
    CHECK(response->status == 404);
    CHECK(errorOf(*response) == "no such playlist");
}

TEST_CASE(
    "a runs request the component can judge for itself is a 400 that never reaches the "
    "player") {
    Served at;
    const std::string current = std::to_string(kStructure);

    struct Refused {
        const char* what;
        std::string path;
        const char* error;
    };
    const std::vector<Refused> refused{
        {"a role that is none beside the good ones",
         runsPath(kPlaylistId, current) + "&colour=%25title%25", "unacceptable role"},
        {"an empty expression", runsPath(kPlaylistId, current, rolesWith("album", "")),
         "unacceptable role"},
        {"an expression carrying a control character",
         runsPath(kPlaylistId, current,
                  rolesWith("album",
                            "%al\x01"
                            "bum%")),
         "unacceptable role"},
        {"a role named twice", runsPath(kPlaylistId, current) + "&album=%25artist%25",
         "duplicate role"},
        {"no structure",
         "/api/playlists/" + std::string(kPlaylistId) + "/runs?" + rolesQuery(roles()).substr(1),
         nullptr},
        {"an empty structure", runsPath(kPlaylistId, ""), nullptr},
        {"a structure that is no number", runsPath(kPlaylistId, "nine"), nullptr},
        {"a negative structure", runsPath(kPlaylistId, "-1"), nullptr},
        {"a structure past 64 bits", runsPath(kPlaylistId, "18446744073709551616"), nullptr},
        // Right length and right alphabet, so the router hands it over and the component's own
        // check is what refuses it.
        {"a malformed playlist id", runsPath("------------------------------------", current),
         nullptr},
    };

    for (const auto& request : refused) {
        INFO("refused: ", request.what, " ", request.path);
        const auto response = at.ask(request.path);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(documentOf(*response).at("error").is_string());
        if (request.error != nullptr)
            CHECK(errorOf(*response) == request.error);
    }

    CHECK(at.foobar.total() == 0);
    CHECK(at.refreshes == 0);
}

TEST_CASE("without the media library playlist runs are a 503, after what the request says") {
    FakePlayer foobar;
    foobar.add(playlistNamed(kPlaylistId, "Road trip"), roadTripRows());
    const TestServer server(servingSettings(), foobar.player());

    const auto refused = get(server, runsPath(kPlaylistId, "nine"));
    REQUIRE(refused);
    CHECK(refused->status == 400);

    const auto unavailable = get(server, runsPath());
    REQUIRE(unavailable);
    CHECK(unavailable->status == 503);
    CHECK(errorOf(*unavailable) == kNoLibrary);
    CHECK(foobar.total() == 0);
}

// ARCHITECTURE.md, *The seams*: a null callback is how an install says it reads no such thing.
TEST_CASE("an install that reads no playlist rows answers playlist runs 503") {
    Served at({.wiring = [](Player& player) { player.playlists.readTracks = nullptr; }});

    const auto response = at.ask();
    REQUIRE(response);
    CHECK(response->status == 503);
    CHECK_FALSE(errorOf(*response).empty());
}

TEST_CASE("with no snapshot ready playlist runs answer the library document and start no build") {
    Served at({.snapshot = false});

    const auto response = at.ask();
    REQUIRE(response);
    CHECK(response->status == 202);
    CHECK(documentOf(*response).at("ready") == false);
    CHECK(at.refreshes == 0);
    CHECK(at.foobar.total() == 0);
}
