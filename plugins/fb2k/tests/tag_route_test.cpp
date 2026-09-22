// POST /api/tags over a real socket. tag_write_test.cpp covers the decisions behind it.

#include "third_party/doctest.h"

#include "support/test_server.h"
#include "third_party/json.hpp"

#include <cstdint>
#include <map>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

httplib::Result write(const TestServer& server, const std::string& body) {
    return post(server, "/api/tags", body);
}

// The two ways an address becomes a handle, standing in for fb2k/tag_writer.cpp: that file
// needs the foobar2000 SDK and never compiles here, so this holds a media library snapshot and
// one playlist and answers the way the player will.
struct FakePlayer {
    // One entry per file, holding its subsongs in subsong order, as the snapshot's relative-path
    // map does.
    std::map<std::string, std::vector<std::string>> snapshot;

    std::map<std::string, std::vector<std::string>> playlists;
    uint64_t structure = kWriteStructure;

    // Every address the route handed over, found or not.
    std::vector<TagWrite> asked;

    // The fields each handle ended up with. A handle absent from here was never written to.
    std::map<std::string, std::map<std::string, std::string>> written;
};

constexpr char kSongHandle[] = "01 A Song";
constexpr char kDiscAddress[] = "Someone/A Record/disc.flac";
constexpr char kFirstSubsong[] = "disc, subsong 0";
constexpr char kSecondSubsong[] = "disc, subsong 1";
constexpr char kThirdSubsong[] = "disc, subsong 2";
constexpr char kFirstRow[] = "a row the library misses";
constexpr char kSecondRow[] = "a second such row";
constexpr char kThirdRow[] = "a third such row";

FakePlayer holding() {
    FakePlayer player;
    player.snapshot = {{kTrackAddress, {kSongHandle}},
                       {kDiscAddress, {kFirstSubsong, kSecondSubsong, kThirdSubsong}}};
    player.playlists = {{kPlaylistId, {kFirstRow, kSecondRow, kThirdRow}}};
    return player;
}

// The lookup, the subsong bound, the index bound and the structure check below are this file's
// own, mirroring fb2k/tag_writer.cpp rather than calling it: scripts/test.sh builds core/ and
// tests/ and nothing under fb2k/. So a case here witnesses the route and no more, the address
// arriving at the writer as the client spelled it and the outcome coming back as a status and a
// body. Delete the component's own structure check and every case here stays green. What the
// component resolves is checked on a real player and nowhere in this suite.
//
// The pointer must outlive the server.
Player resolving(FakePlayer* player) {
    return TestServer::writing([player](const TagWrite& write) {
        player->asked.push_back(write);

        if (const auto& library = write.track.library) {
            const auto file = player->snapshot.find(library->track);
            if (file == player->snapshot.end() || library->subsong >= file->second.size())
                return TagWriteOutcome::trackNotKnown;

            player->written[file->second.at(library->subsong)] = write.fields;
            return TagWriteOutcome::written;
        }

        const auto& row = *write.track.playlist;
        const auto rows = player->playlists.find(row.playlistId);
        if (rows == player->playlists.end())
            return TagWriteOutcome::trackNotKnown;

        if (row.structure != player->structure)
            return TagWriteOutcome::rowsMoved;

        if (row.index >= rows->second.size())
            return TagWriteOutcome::trackNotKnown;

        player->written[rows->second.at(row.index)] = write.fields;
        return TagWriteOutcome::written;
    });
}

std::string writingField(const std::string& field, const std::string& value) {
    return R"({"track": ")" + std::string(kTrackAddress) + R"(", "fields": {")" + field +
           R"(": ")" + value + R"("}})";
}

}  // namespace

TEST_CASE("a library address reaches the writer as it was sent, and the answer echoes it") {
    FakePlayer player = holding();
    const TestServer server(servingSettings(), resolving(&player));

    const auto response = write(server, ratingWrite(kTrackAddress));

    REQUIRE(response);
    CHECK(response->status == 200);

    CHECK(json::parse(response->body) == json{{"written", true},
                                              {"track", kTrackAddress},
                                              {"subsong", 0},
                                              {"fields", {{"rating", kRating}}}});

    REQUIRE(player.asked.size() == 1);
    REQUIRE(player.asked[0].track.library.has_value());
    CHECK(player.asked[0].track.library->track == kTrackAddress);
    CHECK_FALSE(player.asked[0].track.playlist.has_value());

    CHECK(player.written.at(kSongHandle).at("rating") == kRating);
}

// An address is a key into the snapshot rather than a path, so `..` in one is neither refused
// nor meaningful. The third spelling below names the track the first one does, and a component
// resolving it as a path would write to it.
TEST_CASE("an address the writer does not know is a 404, `..` and all") {
    FakePlayer player = holding();
    const TestServer server(servingSettings(), resolving(&player));

    for (const char* address : {"Someone/A Record/02 Another Song.flac", "../../etc/passwd",
                                "Someone/A Record/../A Record/01 A Song.flac"}) {
        const auto response = write(server, ratingWrite(address));

        INFO("address: ", address);
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK_FALSE(json::parse(response->body).value("written", true));
    }

    CHECK(player.asked.size() == 3);
    CHECK(player.written.empty());
}

TEST_CASE("each subsong of one file is carried to the writer on its own") {
    FakePlayer player = holding();
    const TestServer server(servingSettings(), resolving(&player));

    for (uint32_t subsong = 0; subsong < 3; ++subsong) {
        const auto response = write(server, ratingWrite(kDiscAddress, subsong));

        INFO("subsong: ", subsong);
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(json::parse(response->body) == json{{"written", true},
                                                  {"track", kDiscAddress},
                                                  {"subsong", subsong},
                                                  {"fields", {{"rating", kRating}}}});

        REQUIRE(player.asked.size() == subsong + 1);
        CHECK(player.asked.at(subsong).track.library->subsong == subsong);
    }

    // Three of the stand-in's handles rather than one written three times, which is what a
    // dropped subsong looks like: every write landing on the file's first track.
    CHECK(player.written.size() == 3);
}

TEST_CASE("a write naming no subsong is carried as subsong 0, and the answer says so") {
    FakePlayer player = holding();
    const TestServer server(servingSettings(), resolving(&player));

    const auto response = write(server, ratingWrite(kDiscAddress));

    REQUIRE(response);
    CHECK(response->status == 200);

    // The value the write used rather than the one the request carried, which is why it is
    // echoed for a request that carried none.
    CHECK(json::parse(response->body) == json{{"written", true},
                                              {"track", kDiscAddress},
                                              {"subsong", 0},
                                              {"fields", {{"rating", kRating}}}});

    REQUIRE(player.asked.size() == 1);
    REQUIRE(player.asked[0].track.library.has_value());
    CHECK(player.asked[0].track.library->subsong == 0);
    CHECK(player.written.count(kFirstSubsong) == 1);
    CHECK(player.written.count(kSecondSubsong) == 0);
}

TEST_CASE("a playlist address reaches the writer whole, and comes back without its generation") {
    FakePlayer player = holding();
    const TestServer server(servingSettings(), resolving(&player));

    const auto response = write(server, ratingWriteAtRow(kPlaylistId, 1, kWriteStructure));

    REQUIRE(response);
    CHECK(response->status == 200);

    // No structure: a precondition on the write rather than part of the address.
    CHECK(json::parse(response->body) == json{{"written", true},
                                              {"playlist", kPlaylistId},
                                              {"index", 1},
                                              {"fields", {{"rating", kRating}}}});

    REQUIRE(player.asked.size() == 1);
    REQUIRE(player.asked[0].track.playlist.has_value());
    CHECK(player.asked[0].track.playlist->playlistId == kPlaylistId);
    CHECK(player.asked[0].track.playlist->index == 1);
    CHECK(player.asked[0].track.playlist->structure == kWriteStructure);
    CHECK_FALSE(player.asked[0].track.library.has_value());

    CHECK(player.written.at(kSecondRow).at("rating") == kRating);
}

TEST_CASE("a playlist and a position the writer does not know are both a 404") {
    FakePlayer player = holding();
    const TestServer server(servingSettings(), resolving(&player));

    constexpr char kNoSuchPlaylist[] = "00000000-0000-0000-0000-000000000000";

    for (const auto& body : {ratingWriteAtRow(kNoSuchPlaylist, 0, kWriteStructure),
                             ratingWriteAtRow(kPlaylistId, 3, kWriteStructure),
                             ratingWriteAtRow(kPlaylistId, 9, kWriteStructure)}) {
        const auto response = write(server, body);

        INFO("body: ", body);
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK_FALSE(json::parse(response->body).value("written", true));
    }

    CHECK(player.written.empty());
}

// The generation is nineteen digits, so one taken as a JSON number rounds together with its
// neighbours and a stale position passes for a current one. The write that follows lands on
// whichever track was moved into that row.
TEST_CASE(
    "a write against a generation the playlist has moved past is a 409 saying the rows moved") {
    FakePlayer player = holding();
    const TestServer server(servingSettings(), resolving(&player));

    const auto response = write(server, ratingWriteAtRow(kPlaylistId, 1, kWriteStructure - 1));

    REQUIRE(response);
    CHECK(response->status == 409);

    CHECK(json::parse(response->body) ==
          json{{"written", false},
               {"error", "the playlist's rows were added, removed or reordered; read them again"}});

    CHECK(player.written.empty());
}

// The address is library-relative whatever the root is, so a share and a local drive send the
// same string and no path crosses the route in either direction. This is the one case holding
// the route to reading nothing off the shape of an address, which is the refusal that makes
// every track of a library on a NAS unrateable. The share itself is the stand-in's, sitting
// where the player holds it: behind the writer, where the route never sees it.
TEST_CASE("a library whose root is a UNC share is rated like any other") {
    constexpr char kSharedFile[] = R"(\\nas\share\Music\Someone\A Record\01 A Song.flac)";

    FakePlayer player;
    player.snapshot = {{kTrackAddress, {kSharedFile}}};
    const TestServer server(servingSettings(), resolving(&player));

    const auto response = write(server, ratingWrite(kTrackAddress));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(player.written.at(kSharedFile).at("rating") == kRating);
}

TEST_CASE("an empty address is a 400 and is never looked up") {
    FakePlayer player = holding();
    const TestServer server(servingSettings(), resolving(&player));

    const auto response = write(server, ratingWrite(""));

    REQUIRE(response);
    CHECK(response->status == 400);
    CHECK(player.asked.empty());
}

TEST_CASE("writing needs the token like everything else") {
    TestServer::WriterLog log;
    const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

    const auto response =
        server.client().Post("/api/tags", ratingWrite(kTrackAddress), "application/json");

    REQUIRE(response);
    CHECK(response->status == 401);
    CHECK(log.calls.empty());
}

TEST_CASE("a field outside the allowlist is refused without involving the player") {
    TestServer::WriterLog log;
    const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

    const auto response = write(server, writingField("artist", "Someone Else"));

    REQUIRE(response);
    CHECK(response->status == 403);

    const auto body = json::parse(response->body);
    CHECK_FALSE(body.value("written", true));
    CHECK(body.value("field", std::string()) == "artist");

    CHECK(log.calls.empty());
}

TEST_CASE("a malformed body is a 400 rather than a 500") {
    const TestServer server(servingSettings(), TestServer::writing([](const TagWrite&) {
                                return TagWriteOutcome::written;
                            }));

    for (const char* body : {"not json", "[1,2,3]", R"({"track": "a.flac"})", "{}"}) {
        const auto response = write(server, body);

        INFO("body: ", body);
        REQUIRE(response);
        CHECK(response->status == 400);
    }
}

TEST_CASE("what the player says maps onto a status a client can act on") {
    struct Case {
        TagWriteOutcome outcome;
        int status;
    };

    for (const auto& expected :
         {Case{TagWriteOutcome::trackNotKnown, 404}, Case{TagWriteOutcome::rowsMoved, 409},
          Case{TagWriteOutcome::writeFailed, 500}, Case{TagWriteOutcome::timedOut, 504},
          Case{TagWriteOutcome::unavailable, 503}}) {
        TestServer::WriterLog log;
        log.answer = expected.outcome;
        const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

        const auto response = write(server, ratingWrite(kTrackAddress));

        INFO("outcome: ", describe(expected.outcome));
        REQUIRE(response);
        CHECK(response->status == expected.status);
        CHECK_FALSE(json::parse(response->body).value("written", true));
    }
}

TEST_CASE("a component with no writer refuses honestly rather than pretending it wrote") {
    const TestServer server;

    const auto response = write(server, ratingWrite(kTrackAddress));

    REQUIRE(response);
    CHECK(response->status == 503);
    CHECK(json::parse(response->body)["written"] == false);
}

TEST_CASE("a failure says what went wrong without handing back an address or an SDK message") {
    TestServer::WriterLog log;
    log.answer = TagWriteOutcome::writeFailed;
    const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

    const auto response = write(server, ratingWrite(kTrackAddress));

    REQUIRE(response);
    const auto body = json::parse(response->body);
    CHECK(body.size() == 2);  // written, error, and nothing else
    CHECK(body["error"].get<std::string>().find(kTrackAddress) == std::string::npos);
}

// set_payload_max_length only bounds a route that reads a body: cpp-httplib routes before it
// reads, so a POST to an unrouted path is a 404 and the limit is never consulted.
TEST_CASE("an oversized write body is refused before it is parsed") {
    TestServer::WriterLog log;
    const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

    const auto bodyOf = [](size_t padding) {
        return writingField("rating", std::string(padding, 'x'));
    };

    SUBCASE("comfortably under the limit is accepted") {
        const auto response = write(server, bodyOf(kMaxBodyBytes - 1024));
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(log.calls.size() == 1);
    }

    // One byte past the limit rather than a multiple of it. The refusal is decided from
    // Content-Length before a byte of the body is read, so the size makes no difference to
    // what is being tested, and a body the client is still writing when the server closes on
    // it makes whether the 413 arrives at all a race.
    SUBCASE("over the limit never reaches the player") {
        const auto response = write(server, bodyOf(kMaxBodyBytes + 1));

        REQUIRE(response);
        CHECK(response->status == 413);
        CHECK(log.calls.empty());

        const auto afterwards = server.client().Get("/api/status");
        REQUIRE(afterwards);
        CHECK(afterwards->status == 200);
    }

    // The body is refused from Content-Length and never read, so the bytes the client sent
    // are still in the socket. Ending the connection is what stops the next request being
    // parsed out of the middle of them.
    SUBCASE("the refusal ends the connection rather than leaving a body in it") {
        auto client = server.client();
        client.set_keep_alive(true);

        const auto refused = client.Post("/api/tags", TestServer::bearer(),
                                         bodyOf(kMaxBodyBytes + 1), "application/json");
        REQUIRE(refused);
        CHECK(refused->status == 413);
        CHECK(refused->get_header_value("Connection") == "close");

        const auto next = client.Get("/api/status", TestServer::bearer());
        REQUIRE(next);
        CHECK(next->status == 200);
        CHECK(json::parse(next->body)["name"] == "foo_jean");

        CHECK(log.calls.empty());
    }
}

TEST_CASE("GET is not a way to write") {
    TestServer::WriterLog log;
    const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

    const auto response = server.client().Get("/api/tags", TestServer::bearer());

    REQUIRE(response);
    CHECK(response->status == 404);
    CHECK(log.calls.empty());
}
