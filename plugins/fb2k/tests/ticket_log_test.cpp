#include "third_party/doctest.h"

#include "support/devices.h"
#include "support/http.h"
#include "support/log_capture.h"
#include "support/streams.h"
#include "support/test_server.h"
#include "support/tickets.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kTicketPath[] = "/api/stream/ticket";
constexpr char kAudio[] = "OggS and what follows it";

constexpr char kTicketRequired[] = "a valid stream ticket is required";

TestServer serving(const Player& player, const Settings& settings = servingSettings()) {
    return TestServer(settings, player, nullptr, hexMint());
}

StreamOpener countingOpens(int* opens) {
    return opensWith({kAudio}, "audio/ogg", opens);
}

std::string ticketFrom(const TestServer& server, std::vector<std::string>& sent,
                       const std::string& path = kTicketPath,
                       const std::string& body = bodyNaming(phone())) {
    const auto response = post(server, path, body);
    REQUIRE(response);
    REQUIRE(response->status == 200);

    auto ticket = json::parse(response->body)["ticket"].get<std::string>();
    REQUIRE(isTicketShaped(ticket));
    REQUIRE(std::find(sent.begin(), sent.end(), ticket) == sent.end());

    sent.push_back(ticket);
    return ticket;
}

httplib::Result listen(const TestServer& server, const std::string& ticket,
                       const httplib::Headers& headers = {}) {
    return server.client().Get("/api/stream?ticket=" + ticket, headers);
}

std::string upperCased(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char letter) { return static_cast<char>(std::toupper(letter)); });
    return text;
}

std::string repeated(const std::string& text, size_t times) {
    std::string made;
    for (size_t n = 0; n < times; ++n)
        made += text;
    return made;
}

struct Spelling {
    std::string what;
    std::string sent;
    int status = 401;
};

}  // namespace

TEST_CASE("a ticket that opens a stream is in no log line, from the mint to the last byte") {
    clearLog();
    std::vector<std::string> sent;
    int opens = 0;

    {
        const TestServer server = serving(TestServer::streaming(countingOpens(&opens)));

        const auto anonymous = ticketFrom(server, sent, kTicketPath, "");
        const auto named = ticketFrom(server, sent);

        for (const auto& ticket : {anonymous, named}) {
            const auto heard = listen(server, ticket);
            REQUIRE(heard);
            CHECK(heard->status == 200);
            CHECK(heard->body == kAudio);
        }

        // Safari's media element probes a source with this Range before fetching it for real.
        const auto probe = listen(server, named, httplib::Headers{{"Range", "bytes=0-1"}});
        REQUIRE(probe);
        CHECK(probe->status == 200);
    }

    CHECK(opens == 3);
    CHECK(linesLogging(sent) == "");
    CHECK(linesLoggingHexRuns() == "");
}

TEST_CASE("a ticket the stream refuses is in no log line, whatever was wrong with what was sent") {
    clearLog();
    std::vector<std::string> sent;
    int opens = 0;

    {
        const TestServer server = serving(TestServer::streaming(countingOpens(&opens)));
        const auto ticket = ticketFrom(server, sent);

        std::string neverIssued = ticket;
        neverIssued.back() = neverIssued.back() == '0' ? '1' : '0';

        // cpp-httplib answers 414 itself to a request line past 8192 bytes.
        constexpr size_t kPastTheRequestLine = 200;

        const std::vector<Spelling> refused{
            {"one never issued", neverIssued},
            {"cut short by a digit", ticket.substr(0, ticket.size() - 1)},
            {"a digit too long", ticket + "0"},
            {"in upper case", upperCased(ticket)},
            {"twice over", ticket + ticket},
            {"behind a space", "%20" + ticket},
            {"ahead of a NUL", ticket + "%00"},
            {"ahead of a line break", ticket + "%0d%0a"},
            {"inside other text", "ticket-" + ticket + "-ticket"},
            {"sixty times over", repeated(ticket, 60)},
            {"second, behind one never issued", neverIssued + "&ticket=" + ticket},
            {"past what a request line holds", repeated(ticket, kPastTheRequestLine), 414},
        };

        for (const auto& spelling : refused) {
            INFO("the ticket ", spelling.what);
            sent.push_back(spelling.sent);

            const auto response = listen(server, spelling.sent);

            REQUIRE(response);
            CHECK(response->status == spelling.status);
            if (spelling.status == 401)
                CHECK(errorOf(*response) == kTicketRequired);
        }

        const auto inAHeader = server.client().Get(
            "/api/stream", httplib::Headers{{"Authorization", "Bearer " + ticket}});
        REQUIRE(inAHeader);
        CHECK(inAHeader->status == 401);

        const auto inThePath = get(server, "/api/stream/" + ticket);
        REQUIRE(inThePath);
        CHECK(inThePath->status == 404);

        CHECK(opens == 0);

        const auto heard = listen(server, ticket);
        REQUIRE(heard);
        CHECK(heard->status == 200);
    }

    CHECK(opens == 1);
    CHECK(linesLogging(sent) == "");
    CHECK(linesLoggingHexRuns() == "");
}

TEST_CASE("a ticket the store no longer honours is in no log line") {
    clearLog();
    std::vector<std::string> sent;
    int opens = 0;

    SUBCASE("because it ran out before it was used") {
        const auto settings = servingSettings();
        const TestServer server = serving(TestServer::streaming(countingOpens(&opens)), settings);

        const auto ticket = ticketFrom(server, sent);
        server.advanceClock(std::chrono::seconds(settings.streamTicketTtlSeconds + 1));

        for (int attempt = 0; attempt < 2; ++attempt) {
            const auto response = listen(server, ticket);
            REQUIRE(response);
            CHECK(response->status == 401);
            CHECK(errorOf(*response) == kTicketRequired);
        }

        CHECK(opens == 0);
    }

    SUBCASE("because newer ones pushed it out") {
        const TestServer server = serving(TestServer::streaming(countingOpens(&opens)));
        const auto first = ticketFrom(server, sent);
        int pushedOutAfter = 0;

        for (int newer = 1; newer <= kMoreTicketsThanAnyoneHolds && pushedOutAfter == 0; ++newer) {
            ticketFrom(server, sent);
            if (statusOf(listen(server, first)) == 401)
                pushedOutAfter = newer;
        }

        REQUIRE(pushedOutAfter > 0);

        const auto newest = listen(server, sent.back());
        REQUIRE(newest);
        CHECK(newest->status == 200);
        CHECK(opens == pushedOutAfter);
    }

    CHECK(linesLogging(sent) == "");
    CHECK(linesLoggingHexRuns() == "");
}

TEST_CASE("a good ticket turned away after it was accepted is in no log line") {
    clearLog();
    std::vector<std::string> sent;

    SUBCASE("for a format this install does not encode") {
        int opens = 0;
        const TestServer server = serving(TestServer::streaming(countingOpens(&opens)));
        const auto ticket = ticketFrom(server, sent);

        const auto response = get(server, "/api/stream?format=flac&ticket=" + ticket);

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(opens == 0);
    }

    SUBCASE("because every place is taken") {
        auto settings = servingSettings();
        settings.maxConcurrentStreams = 0;

        int opens = 0;
        const TestServer server = serving(TestServer::streaming(countingOpens(&opens)), settings);
        const auto ticket = ticketFrom(server, sent);

        const auto response = listen(server, ticket);

        REQUIRE(response);
        CHECK(response->status == 503);
        CHECK(opens == 0);
    }

    SUBCASE("because streaming was switched off since") {
        int opens = 0;
        TestServer server = serving(TestServer::streaming(countingOpens(&opens)));
        const auto ticket = ticketFrom(server, sent);
        server.reload(R"({"streamingEnabled": false})");

        const auto response = listen(server, ticket);

        REQUIRE(response);
        CHECK(response->status == 503);
        CHECK(opens == 0);

        const auto another = post(server, kTicketPath, bodyNaming(phone()));
        REQUIRE(another);
        CHECK(another->status == 503);
    }

    SUBCASE("because the player has nothing to open") {
        const TestServer server =
            serving(TestServer::streaming([](const std::string&) -> OpenedStream { return {}; }));
        const auto ticket = ticketFrom(server, sent);

        const auto response = listen(server, ticket);

        REQUIRE(response);
        CHECK(response->status == 503);
    }

    SUBCASE("because the player threw, which is logged") {
        const TestServer server =
            serving(TestServer::streaming([](const std::string&) -> OpenedStream {
                throw std::runtime_error("the encoder gave up");
            }));
        const auto ticket = ticketFrom(server, sent);

        const auto response = listen(server, ticket);

        REQUIRE(response);
        CHECK(response->status == 500);
        CHECK(errorLinesContaining("request handler threw: the encoder gave up") == 1);
        REQUIRE(loggedLines().size() == 1);
    }

    REQUIRE(sent.size() == 1);
    CHECK(linesLogging(sent) == "");
    CHECK(linesLoggingHexRuns() == "");
}

TEST_CASE("a ticket for a detached session is in no log line, while the session lives or after") {
    clearLog();
    std::vector<std::string> sent;
    std::string session;
    int opens = 0;

    {
        const TestServer server = serving(streamingToSessions(countingOpens(&opens)));

        const auto created = post(server, "/api/sessions", bodyNaming(phone()));
        REQUIRE(created);
        REQUIRE(created->status == 200);
        session = json::parse(created->body)["id"].get<std::string>();
        REQUIRE(isTicketShaped(session));

        const auto forSession = std::string(kTicketPath) + "?session=" + session;
        const auto ticket = ticketFrom(server, sent, forSession);

        const auto stranger = post(server, forSession, bodyNaming(laptop()));
        REQUIRE(stranger);
        CHECK(stranger->status == 404);

        const auto heard = listen(server, ticket);
        REQUIRE(heard);
        CHECK(heard->status == 200);
        CHECK(heard->body == kAudio);
        CHECK(opens == 1);

        const auto left = post(server, "/api/stream/leave?session=" + session, bodyNaming(phone()));
        REQUIRE(left);
        REQUIRE(left->status == 204);

        const auto afterwards = listen(server, ticket);
        REQUIRE(afterwards);
        CHECK(afterwards->status == 404);
        CHECK(errorOf(*afterwards) == "no such session");
    }

    CHECK(opens == 1);
    CHECK(linesLogging(sent) == "");
    CHECK(linesLoggingHexRuns({session}) == "");
}

TEST_CASE(
    "a ticket sent where nothing reads one is in no log line, even where the request is logged") {
    clearLog();
    std::vector<std::string> sent;
    int opens = 0;

    {
        Player player = TestServer::streaming(countingOpens(&opens));
        player.page.names = {"index.html"};
        player.page.read = [](const std::string& path) -> std::optional<std::string_view> {
            constexpr std::string_view kIndex = "<!doctype html><title>Jean</title>";
            return path == "index.html" ? std::optional<std::string_view>(kIndex) : std::nullopt;
        };

        const TestServer server = serving(player);
        const auto ticket = ticketFrom(server, sent);
        const auto carried = "?ticket=" + ticket;

        const auto page = get(server, "/" + carried);
        REQUIRE(page);
        CHECK(page->status == 200);

        const auto misspelt = get(server, "/API/stream" + carried);
        REQUIRE(misspelt);
        CHECK(misspelt->status == 404);
        CHECK(logged("requests under \"API\" are never answered from www/"));
        REQUIRE(loggedLines().size() == 1);

        const auto status = get(server, "/api/status" + carried);
        REQUIRE(status);
        CHECK(status->status == 200);

        const auto nowhere = get(server, "/api/nowhere" + carried);
        REQUIRE(nowhere);
        CHECK(nowhere->status == 404);

        const auto listeners = get(server, "/api/stream/listeners" + carried);
        REQUIRE(listeners);
        CHECK(listeners->status == 200);

        const auto reissue = post(server, kTicketPath + carried, bodyNaming(phone()));
        REQUIRE(reissue);
        CHECK(reissue->status == 200);
        sent.push_back(json::parse(reissue->body)["ticket"].get<std::string>());

        const auto notJson =
            server.client().Post("/api/stream/leave" + carried, bodyNaming(phone()), "text/plain");
        REQUIRE(notJson);
        CHECK(notJson->status == 415);

        const auto preflight = server.client().Options("/api/stream" + carried);
        REQUIRE(preflight);
        CHECK(preflight->status == 204);

        const auto anotherHost = listen(server, ticket, httplib::Headers{{"Host", "evil.example"}});
        REQUIRE(anotherHost);
        CHECK(anotherHost->status == 403);

        const auto anotherSite =
            listen(server, ticket, httplib::Headers{{"Sec-Fetch-Site", "cross-site"}});
        REQUIRE(anotherSite);
        CHECK(anotherSite->status == 403);

        CHECK(opens == 0);

        constexpr int kPollsPastAnyBudget = 200;
        int refused = 0;
        for (int poll = 0; poll < kPollsPastAnyBudget; ++poll)
            refused += statusOf(get(server, "/api/state" + carried)) == 429 ? 1 : 0;

        REQUIRE(refused > 0);
        CHECK(errorLinesContaining("refusing state polls from 127.0.0.1") == 1);
        REQUIRE(loggedLines().size() == 2);
    }

    CHECK(opens == 0);
    CHECK(linesLogging(sent) == "");
    CHECK(linesLoggingHexRuns() == "");
}
