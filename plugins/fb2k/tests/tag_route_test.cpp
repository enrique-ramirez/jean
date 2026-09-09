// POST /api/tags over a real socket. tag_write_test.cpp covers the decisions behind it.

#include "third_party/doctest.h"

#include "support/test_server.h"
#include "third_party/json.hpp"

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

httplib::Result write(const TestServer& server, const std::string& body) {
    return post(server, "/api/tags", body);
}

}  // namespace

TEST_CASE("a permitted write reaches the player and is echoed back") {
    TestServer::WriterLog log;
    const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

    const auto response = write(server, kRatingWrite);

    REQUIRE(response);
    CHECK(response->status == 200);

    const auto body = json::parse(response->body);
    CHECK(body["written"] == true);
    CHECK(body["path"] == kRatingWritePath);
    CHECK(body["fields"]["rating"] == "4");

    REQUIRE(log.calls.size() == 1);
    CHECK(log.calls[0].track.path == kRatingWritePath);
    CHECK(log.calls[0].fields.at("rating") == "4");
}

TEST_CASE("writing needs the token like everything else") {
    TestServer::WriterLog log;
    const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

    const auto response = server.client().Post("/api/tags", kRatingWrite, "application/json");

    REQUIRE(response);
    CHECK(response->status == 401);
    CHECK(log.calls.empty());
}

TEST_CASE("a field outside the allowlist is refused without involving the player") {
    TestServer::WriterLog log;
    const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

    const auto response =
        write(server, R"({"path": "F:\\a\\b.mp3", "fields": {"artist": "Someone Else"}})");

    REQUIRE(response);
    CHECK(response->status == 403);

    const auto body = json::parse(response->body);
    CHECK(body["written"] == false);
    CHECK(body["field"] == "artist");

    CHECK(log.calls.empty());
}

TEST_CASE("an unacceptable path is refused without involving the player") {
    TestServer::WriterLog log;
    const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

    for (const char* path : {R"(..\\..\\etc\\passwd)", "http://evil.example/a.mp3",
                             R"(\\\\evil.example\\share\\a.mp3)", "relative.mp3"}) {
        const auto body = std::string(R"({"path": ")") + path + R"(", "fields": {"rating": "4"}})";
        const auto response = write(server, body);

        INFO("path: ", path);
        REQUIRE(response);
        CHECK(response->status == 400);
    }

    CHECK(log.calls.empty());
}

TEST_CASE("a malformed body is a 400 rather than a 500") {
    const TestServer server(servingSettings(), TestServer::writing([](const TagWrite&) {
                                return TagWriteOutcome::written;
                            }));

    for (const char* body : {"not json", "[1,2,3]", R"({"path": "F:\\a.mp3"})", "{}"}) {
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
         {Case{TagWriteOutcome::trackNotKnown, 404}, Case{TagWriteOutcome::writeFailed, 500},
          Case{TagWriteOutcome::timedOut, 504}, Case{TagWriteOutcome::unavailable, 503}}) {
        TestServer::WriterLog log;
        log.answer = expected.outcome;
        const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

        const auto response = write(server, kRatingWrite);

        INFO("outcome: ", describe(expected.outcome));
        REQUIRE(response);
        CHECK(response->status == expected.status);
        CHECK(json::parse(response->body)["written"] == false);
    }
}

TEST_CASE("a component with no writer refuses honestly rather than pretending it wrote") {
    const TestServer server;

    const auto response = write(server, kRatingWrite);

    REQUIRE(response);
    CHECK(response->status == 503);
    CHECK(json::parse(response->body)["written"] == false);
}

TEST_CASE("a failure says what went wrong without handing back a path or an SDK message") {
    TestServer::WriterLog log;
    log.answer = TagWriteOutcome::writeFailed;
    const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

    const auto response = write(server, kRatingWrite);

    REQUIRE(response);
    const auto body = json::parse(response->body);
    CHECK(body.size() == 2);  // written, error -- and nothing else
    CHECK(body["error"].get<std::string>().find("F:") == std::string::npos);
}

// set_payload_max_length only bounds a route that reads a body: cpp-httplib routes before it
// reads, so a POST to an unrouted path is a 404 and the limit is never consulted.
TEST_CASE("an oversized write body is refused before it is parsed") {
    TestServer::WriterLog log;
    const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

    const auto bodyOf = [](size_t padding) {
        return R"({"path": "F:\\a.mp3", "fields": {"rating": ")" + std::string(padding, 'x') +
               R"("}})";
    };

    SUBCASE("comfortably under the limit is accepted") {
        const auto response = write(server, bodyOf(kMaxBodyBytes - 1024));
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(log.calls.size() == 1);
    }

    // One byte past the limit rather than a multiple of it. The refusal is decided from
    // Content-Length before a byte of the body is read, so the size makes no difference to
    // what is being tested -- and a body the client is still writing when the server closes
    // on it makes whether the 413 arrives at all a race.
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
