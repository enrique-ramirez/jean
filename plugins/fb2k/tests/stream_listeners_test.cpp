// GET /api/stream/listeners and POST /api/stream/leave over a real socket, with a real
// connection open while the roster is read. The identity rides the ticket, so most of these
// are about what a device said about itself surviving the trip to the connection it opened.

#include "third_party/doctest.h"

#include "support/eventually.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;
using namespace std::chrono_literals;
using nlohmann::json;

namespace {

// Stays open until it is let go, which is the only way to read a roster with somebody
// actually on it.
class HeldStream : public StreamListener {
public:
    struct Gate {
        std::mutex mutex;
        std::condition_variable released;
        bool open = true;
    };

    explicit HeldStream(std::shared_ptr<Gate> gate) : gate_(std::move(gate)) {}

    bool next(std::vector<std::uint8_t>& out) override {
        if (!sent_) {
            sent_ = true;
            out = {'o', 'g', 'g'};
            return true;
        }

        std::unique_lock<std::mutex> lock(gate_->mutex);
        gate_->released.wait(lock, [this] { return !gate_->open; });
        return false;
    }

private:
    std::shared_ptr<Gate> gate_;
    bool sent_ = false;
};

// The gate every listener blocks on, and the player built over it. Separate from the
// connections below because the order matters both ways: this has to exist before the
// server, and the connections have to be let go before the server stops -- stopping joins
// the connection threads, and a listener still inside next() would hold them forever.
struct Source {
    std::shared_ptr<HeldStream::Gate> gate = std::make_shared<HeldStream::Gate>();

    Player player(std::function<bool()> outputHeld = {},
                  std::function<void()> releaseOutput = {}) const {
        auto built = TestServer::streaming([gate = gate](const std::string&) -> OpenedStream {
            return {"audio/ogg", std::make_unique<HeldStream>(gate)};
        });
        built.stream.outputHeld = std::move(outputHeld);
        built.stream.releaseOutput = std::move(releaseOutput);
        return built;
    }
};

// Connections that are released and joined when it goes out of scope. Declare it after the
// server it dials.
class Listeners {
public:
    Listeners(const TestServer& server, const Source& source)
        : server_(server), gate_(source.gate) {}

    void open(const std::string& ticket) {
        threads_.emplace_back(
            [this, url = "/api/stream?ticket=" + ticket] { server_.client().Get(url); });
    }

    ~Listeners() {
        {
            const std::lock_guard<std::mutex> held(gate_->mutex);
            gate_->open = false;
        }
        gate_->released.notify_all();

        for (auto& thread : threads_)
            thread.join();
    }

private:
    const TestServer& server_;
    const std::shared_ptr<HeldStream::Gate> gate_;
    std::vector<std::thread> threads_;
};

std::string ticketFor(const TestServer& server, const std::string& body) {
    const auto response = server.client().Post("/api/stream/ticket", body, "application/json");
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body)["ticket"].get<std::string>();
}

bool capabilityToMute(const TestServer& server) {
    const auto response = server.client().Get("/api/capabilities");
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body)["canMuteWhileStreaming"].get<bool>();
}

json roster(const TestServer& server) {
    const auto response = server.client().Get("/api/stream/listeners");
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

// Each connection opens on a thread of its own, so a test waits for them rather than
// sleeping for a guessed interval. Waits on connections rather than devices: two sockets
// from one device are one row, so a roster can be the right length and still be short a
// connection.
//
// The polling reads are deliberately unasserted, and the arrival is asserted once at the
// end: an assertion inside the loop would run as many times as the scheduler felt like,
// and the suite's assertion total is only a checkable invariant while it is fixed.
json rosterOf(const TestServer& server, int connections) {
    eventually([&server, connections] {
        const auto response = server.client().Get("/api/stream/listeners");
        return response && response->status == 200 &&
               json::parse(response->body)["connections"] == connections;
    });

    const auto body = roster(server);
    CHECK(body["connections"] == connections);
    return body;
}

}  // namespace

TEST_CASE("a device's connections are one row, and its name came off the ticket") {
    const Source source;
    const TestServer server(servingSettings(), source.player());
    Listeners live(server, source);

    const auto ticket = ticketFor(server, R"({"deviceId":"phone-1","name":"Android phone"})");

    // Two connections, one probe and one real request (see audience.h). One person, and
    // the roster must say one.
    live.open(ticket);
    live.open(ticket);

    const auto body = rosterOf(server, 2);
    REQUIRE(body["devices"].size() == 1);
    CHECK(body["devices"][0]["deviceId"] == "phone-1");
    CHECK(body["devices"][0]["name"] == "Android phone");
    CHECK(body["devices"][0]["connections"] == 2);
    CHECK(body["devices"][0]["format"] == "opus");

    // The cap is on sockets, because sockets are what cost a thread.
    CHECK(body["connections"] == 2);
    CHECK(body["maxConnections"] == servingSettings().maxConcurrentStreams);
}

// Every other case about the cap finishes its stream before the next request starts, and
// would pass with maxConcurrentStreams ignored entirely.
TEST_CASE("the cap counts connections that are still open, and refuses the one past it") {
    auto settings = servingSettings();
    settings.maxConcurrentStreams = 2;

    const Source source;
    const TestServer server(settings, source.player());
    Listeners live(server, source);

    live.open(ticketFor(server, R"({"deviceId":"phone-1"})"));
    live.open(ticketFor(server, R"({"deviceId":"laptop-1"})"));
    REQUIRE(rosterOf(server, 2)["devices"].size() == 2);

    const auto third = ticketFor(server, R"({"deviceId":"tablet-1"})");
    const auto refused = server.client().Get("/api/stream?ticket=" + third);

    REQUIRE(refused);
    CHECK(refused->status == 503);
    CHECK(json::parse(refused->body)["error"].get<std::string>().find("already serving") !=
          std::string::npos);

    CHECK(roster(server)["connections"] == 2);

    const auto elsewhere = server.client().Get("/api/status");
    REQUIRE(elsewhere);
    CHECK(elsewhere->status == 200);
}

TEST_CASE("a connection that named nothing is a row with a null name") {
    const Source source;
    const TestServer server(servingSettings(), source.player());
    Listeners live(server, source);

    live.open(ticketFor(server, ""));

    const auto body = rosterOf(server, 1);

    CHECK(body["devices"][0]["name"].is_null());
    CHECK(body["devices"][0]["deviceId"].get<std::string>().rfind('#', 0) == 0);
}

TEST_CASE("an unusable name costs the label and not the audio") {
    const Source source;
    const TestServer server(servingSettings(), source.player());
    Listeners live(server, source);

    // A newline forges a line in the log, so the name is dropped -- but the ticket is
    // still issued and the device still gets its stream.
    live.open(ticketFor(server, "{\"deviceId\":\"phone-1\",\"name\":\"a\\nb\"}"));

    const auto body = rosterOf(server, 1);
    CHECK(body["devices"][0]["name"].is_null());
    CHECK(body["devices"][0]["deviceId"] == "phone-1");
}

TEST_CASE("a name longer than the limit is refused before a ticket is issued") {
    const TestServer server(servingSettings(), TestServer::streaming([](const std::string&) {
                                return OpenedStream{};
                            }));

    const auto response = server.client().Post(
        "/api/stream/ticket", json{{"deviceId", "phone-1"}, {"name", std::string(200, 'x')}}.dump(),
        "application/json");

    REQUIRE(response);
    CHECK(response->status == 400);
}

TEST_CASE("the roster says whether the player was silenced for these listeners") {
    const Source source;
    std::atomic<bool> holding{true};
    const TestServer server(servingSettings(),
                            source.player([&holding] { return holding.load(); }));
    Listeners live(server, source);

    live.open(ticketFor(server, R"({"deviceId":"phone-1"})"));
    CHECK(rosterOf(server, 1)["playerMuted"] == true);

    holding = false;
    CHECK(roster(server)["playerMuted"] == false);
}

TEST_CASE("leaving is noted, and says nothing about whether there was anything to end") {
    const Source source;
    const TestServer server(servingSettings(), source.player());
    const Listeners live(server, source);

    const auto response = post(server, "/api/stream/leave", R"({"deviceId":"phone-1"})");
    REQUIRE(response);
    CHECK(response->status == 204);
}

TEST_CASE("a forged anonymous deviceId cannot end a stranger's linger") {
    const Source source;
    const TestServer server(servingSettings(), source.player());

    {
        Listeners live(server, source);
        live.open(ticketFor(server, ""));
        REQUIRE(rosterOf(server, 1)["devices"].size() == 1);
    }

    // The connection is gone and the device is inside its linger, which is what stops the
    // player unmuting into a reconnect.
    REQUIRE(rosterOf(server, 0)["devices"].empty());
    const auto now = Audience::Clock::now();
    REQUIRE(server.audience().anyListening(now));

    // The key of an unnamed connection is its number. Anybody reaching this route can spell
    // one, and nobody may: this device sent no id, so there is no id that ends its linger.
    const auto response = post(server, "/api/stream/leave", R"({"deviceId":"#1"})");
    REQUIRE(response);
    CHECK(response->status == 204);
    CHECK(server.audience().anyListening(now));
}

// Every refusal here faces a device inside its linger, because a 400 that nevertheless
// reached the audience would end that linger and unmute the player into a reconnect.
// Refusing and not acting are two promises, and only the second is the feature.
TEST_CASE("leaving needs a device to name, and a refusal never reaches the audience") {
    const Source source;
    const TestServer server(servingSettings(), source.player());

    {
        Listeners live(server, source);
        live.open(ticketFor(server, R"({"deviceId":"phone-1"})"));
        REQUIRE(rosterOf(server, 1)["devices"].size() == 1);
    }

    const auto now = Audience::Clock::now();
    REQUIRE(server.audience().anyListening(now));

    SUBCASE("with no deviceId") {
        const auto response = post(server, "/api/stream/leave", R"({"name":"Android phone"})");
        REQUIRE(response);
        CHECK(response->status == 400);
    }

    SUBCASE("with a body that is not an object") {
        const auto response = post(server, "/api/stream/leave", "[]");
        REQUIRE(response);
        CHECK(response->status == 400);
    }

    SUBCASE("with a body that is not JSON at all") {
        const auto response = server.client().Post("/api/stream/leave", "phone-1", "text/plain");
        REQUIRE(response);
        CHECK(response->status == 415);
    }

    // POST /api/stream/ticket takes an empty body as an anonymous device; this one has
    // nothing to be anonymous about, so the asymmetry is deliberate.
    SUBCASE("with no body at all") {
        const auto response = server.client().Post("/api/stream/leave", "", "text/plain");
        REQUIRE(response);
        CHECK(response->status == 415);
    }

    CHECK(server.audience().anyListening(now));
}

TEST_CASE("asking for both outputs reaches the hold") {
    std::atomic<int> released{0};
    const Source source;
    const TestServer server(servingSettings(), source.player({}, [&released] { ++released; }));

    const auto response = server.client().Delete("/api/stream/hold");
    REQUIRE(response);
    CHECK(response->status == 204);
    CHECK(released == 1);

    // Idempotent, and it says nothing about whether there was a hold: with nobody listening
    // there is nothing to release and nothing has gone wrong.
    CHECK(server.client().Delete("/api/stream/hold")->status == 204);
}

TEST_CASE("an install that never mutes says so rather than answering as though it did") {
    const Source source;
    const TestServer server(servingSettings(), source.player());

    const auto response = server.client().Delete("/api/stream/hold");
    REQUIRE(response);
    CHECK(response->status == 503);
}

// A client reads the capability and hides the control; the route is what it would have
// called. The two must not disagree, or the control is offered and fails.
TEST_CASE("canMuteWhileStreaming says in advance what the hold route will answer") {
    const Source source;

    SUBCASE("an install that holds the player's output") {
        const TestServer server(servingSettings(), source.player({}, [] {}));

        CHECK(capabilityToMute(server) == true);
        CHECK(server.client().Delete("/api/stream/hold")->status == 204);
    }

    // muteWhileStreaming is on by default, so a component that never started an encoder has
    // the setting and no hold. The capability follows the hold, not the setting.
    SUBCASE("an install with nothing to hold") {
        REQUIRE(servingSettings().muteWhileStreaming);
        const TestServer server(servingSettings(), source.player());

        CHECK(capabilityToMute(server) == false);
        CHECK(server.client().Delete("/api/stream/hold")->status == 503);
    }
}

namespace {

struct Cut {
    std::atomic<bool> reloaded{false};
    std::atomic<int> callsAfterReload{0};
    std::atomic<bool> overran{false};
};

constexpr int kCallsAllowedAfterReload = 4;

// Never ends by itself while it is wanted. Once the reload has landed it allows a few more calls
// and then ends anyway, so a server that never cuts fails this test rather than hanging it.
class LiveStream : public StreamListener {
public:
    LiveStream(std::shared_ptr<Cut> cut, bool paused) : cut_(std::move(cut)), paused_(paused) {}

    bool next(std::vector<std::uint8_t>& out) override {
        if (cut_->reloaded && ++cut_->callsAfterReload > kCallsAllowedAfterReload) {
            cut_->overran = true;
            return false;
        }

        out.clear();
        if (!sent_ || !paused_)
            out = {'o', 'g', 'g'};
        sent_ = true;
        return true;
    }

private:
    std::shared_ptr<Cut> cut_;
    bool paused_;
    bool sent_ = false;
};

}  // namespace

// A paused player sends nothing, so a server that only looks at the switch when it writes audio
// would keep a paused listener for as long as the pause lasts.
TEST_CASE("a listener is cut when a reload turns streamingEnabled off, playing or paused") {
    for (const bool paused : {false, true}) {
        INFO("player: ", std::string(paused ? "paused" : "playing"));

        auto cut = std::make_shared<Cut>();
        TestServer server(servingSettings(),
                          TestServer::streaming([cut, paused](const std::string&) -> OpenedStream {
                              return {"audio/ogg", std::make_unique<LiveStream>(cut, paused)};
                          }));

        const auto ticket = ticketFor(server, "");
        server.client().Get("/api/stream?ticket=" + ticket, [&server, &cut](const char*, size_t) {
            if (!cut->reloaded) {
                server.reload(R"({"streamingEnabled": false})");
                cut->reloaded = true;
            }
            return true;
        });

        CHECK(cut->reloaded);
        CHECK_FALSE(cut->overran);
        rosterOf(server, 0);
    }
}
