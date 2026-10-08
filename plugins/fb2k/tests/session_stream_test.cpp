// The stream's routes naming a detached session, over a real socket with real connections open:
// the ticket, the stream it opens, the timeline, the roster and the leave. What these pin is that a
// ticket opens the session it was issued for and no other, that a listener holds a session as long
// as its linger and no longer, and that the player's own things stay the player's: its hold on the
// output and the one cap on connections.

#include "third_party/doctest.h"

#include "core/audience.h"
#include "core/output_hold.h"
#include "core/session.h"
#include "support/eventually.h"
#include "support/fixtures.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <iterator>
#include <map>
#include <memory>
#include <mutex>
#include <numeric>
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kPhone[] = "phone-4c1e";
constexpr char kLaptop[] = "laptop-9a07";
constexpr char kTablet[] = "tablet-2b55";

// An id of the shape the mint gives that no session was ever issued.
constexpr char kNobodysSession[] = "Zz00q";

constexpr char kAtTheCap[] =
    "this component is already serving as many streams as it is configured to";

// One past the listening linger, so a device that left has stopped holding anything.
constexpr auto kPastTheLinger = std::chrono::seconds(kMuteLingerSeconds + 1);

// Past the controlling grace, so only a connection or a linger holds a session.
constexpr auto kPastTheGrace = kControllingGrace + std::chrono::minutes(1);

std::string bytesOf(const std::string& key) {
    return "OggS" + key;
}

std::string timelineOf(const std::string& key) {
    return json{{"streamTime", 0}, {"marks", json::array()}, {"of", key}}.dump();
}

std::string contentTypeOf(const std::string& format) {
    return format == "aac" ? "audio/aac" : "audio/ogg";
}

class Source;

// One connection's stream: the bytes of the stream it opened, then whatever the source says.
class KeyedStream : public StreamListener {
public:
    KeyedStream(Source& source, std::string key) : source_(source), key_(std::move(key)) {}

    bool next(std::vector<std::uint8_t>& out) override;

private:
    Source& source_;
    const std::string key_;
    bool sent_ = false;
};

// The player every case here runs against. The engine's stream and each session's answer the
// bytes of their own key, kEngineSessionId for the engine and the id for a session, so a body says
// whose stream it was, and each timeline answers a document naming the same key. A connection to a
// key a case holds stays open after those bytes until the case lets go of it, and a session's own
// stop lets go of it as the player's does. Each session `start` is handed is kept, weakly, so a
// case can read the audience the server drives for it.
class Source {
public:
    Player player() {
        Player built = servingPlayer();
        built.stream.formats = {"opus", "aac"};
        built.stream.open = [this](const std::string& format) {
            return opened(kEngineSessionId, format);
        };
        built.stream.readTimeline = [] { return timelineOf(kEngineSessionId); };
        built.stream.outputHeld = [this] {
            const OutputHold* const hold = hold_.load();
            return hold != nullptr ? hold->held() : playerMuted_.load();
        };

        built.sessions.start = [this](Session& session) {
            const std::string id = session.id();
            {
                const std::lock_guard<std::mutex> held(mutex_);
                started_[id] = session.shared_from_this();
            }

            SessionStream stream;
            stream.open = [this, id](const std::string& format) { return opened(id, format); };
            stream.readTimeline = [id] { return timelineOf(id); };
            stream.stop = [this, id] { stopped(id); };
            return stream;
        };

        built.sessions.takePlaylist = [](const std::string&,
                                         const std::optional<std::vector<uint32_t>>&) {
            SessionTrack track;
            track.path = R"(X:\music\Fictional Artist\01 Road.flac)";
            track.libraryPath = "Fictional Artist/01 Road.flac";
            track.handle = std::make_shared<const std::string>("Road");

            SessionTracksRead read;
            read.tracks = {track};
            return read;
        };

        return built;
    }

    // Connections to `key` opened from now on stay open until it is let go of.
    void hold(const std::string& key) {
        const std::lock_guard<std::mutex> held(mutex_);
        held_.insert(key);
    }

    void letGo(const std::string& key) {
        {
            const std::lock_guard<std::mutex> held(mutex_);
            held_.erase(key);
        }
        changed_.notify_all();
    }

    void letGoOfAll() {
        {
            const std::lock_guard<std::mutex> held(mutex_);
            closing_ = true;
        }
        changed_.notify_all();
    }

    // Called on a connection's thread once its bytes are sent; true once it may end.
    void awaitLetGo(const std::string& key) {
        std::unique_lock<std::mutex> held(mutex_);
        changed_.wait(held, [this, &key] { return closing_ || !held_.contains(key); });
    }

    // The format each stream of `key` was opened in, in the order opened.
    std::vector<std::string> opens(const std::string& key) const {
        const std::lock_guard<std::mutex> held(mutex_);
        const auto found = opens_.find(key);
        return found == opens_.end() ? std::vector<std::string>{} : found->second;
    }

    int stops(const std::string& key) const {
        const std::lock_guard<std::mutex> held(mutex_);
        const auto found = stops_.find(key);
        return found == stops_.end() ? 0 : found->second;
    }

    void mutePlayer(bool muted) { playerMuted_ = muted; }

    // From now on the roster's playerMuted is what `hold` says.
    void heldBy(const OutputHold* hold) { hold_ = hold; }

    std::shared_ptr<Session> session(const std::string& id) const {
        const std::lock_guard<std::mutex> held(mutex_);
        const auto found = started_.find(id);
        auto session = found == started_.end() ? nullptr : found->second.lock();
        INFO("the session stream was never started for session ", id);
        REQUIRE(session != nullptr);
        return session;
    }

private:
    OpenedStream opened(const std::string& key, const std::string& format) {
        {
            const std::lock_guard<std::mutex> held(mutex_);
            opens_[key].push_back(format);
        }
        return {contentTypeOf(format), std::make_unique<KeyedStream>(*this, key)};
    }

    void stopped(const std::string& key) {
        {
            const std::lock_guard<std::mutex> held(mutex_);
            ++stops_[key];
            held_.erase(key);
        }
        changed_.notify_all();
    }

    mutable std::mutex mutex_;
    std::condition_variable changed_;
    std::set<std::string> held_;
    bool closing_ = false;
    std::map<std::string, std::vector<std::string>> opens_;
    std::map<std::string, int> stops_;
    std::map<std::string, std::weak_ptr<Session>> started_;
    std::atomic<bool> playerMuted_{false};
    std::atomic<const OutputHold*> hold_{nullptr};
};

bool KeyedStream::next(std::vector<std::uint8_t>& out) {
    if (!sent_) {
        sent_ = true;
        const auto bytes = bytesOf(key_);
        out.assign(bytes.begin(), bytes.end());
        return true;
    }

    source_.awaitLetGo(key_);
    return false;
}

// Connections on threads of their own, let go of and joined as this goes out of scope. Declared
// after the server they dial, so they end before it stops: stopping joins the connection threads,
// and a stream still waiting to be let go of would hold them.
class Connections {
public:
    Connections(const TestServer& server, Source& source) : server_(server), source_(source) {}

    void open(const std::string& ticket) {
        threads_.emplace_back(
            [this, url = "/api/stream?ticket=" + ticket] { server_.client().Get(url); });
    }

    ~Connections() {
        source_.letGoOfAll();
        for (auto& thread : threads_)
            thread.join();
    }

    Connections(const Connections&) = delete;
    Connections& operator=(const Connections&) = delete;

private:
    const TestServer& server_;
    Source& source_;
    std::vector<std::thread> threads_;
};

int connectionsOn(const Audience& audience) {
    const auto roster = audience.roster(audience.now());
    return std::accumulate(
        roster.begin(), roster.end(), 0,
        [](int sum, const AudienceMember& member) { return sum + member.connections; });
}

// A connection opens and closes on a thread of its own, so a case waits for the count it is about
// to rely on. The waiting reads are unasserted and the count is asserted once, so the suite's
// assertion total stays fixed.
void settlesAt(const Audience& audience, int connections) {
    eventually([&audience, connections] { return connectionsOn(audience) == connections; });
    REQUIRE(connectionsOn(audience) == connections);
}

bool holdsDevice(const Audience& audience, const std::string& deviceId) {
    return audience.holds(deviceId, audience.now());
}

std::string scoped(const std::string& path, const std::string& session,
                   const std::string& deviceId) {
    std::string query;
    if (!session.empty())
        query += "session=" + session;
    if (!deviceId.empty())
        query += (query.empty() ? "" : "&") + std::string("deviceId=") + deviceId;
    return query.empty() ? path : path + "?" + query;
}

std::string bodyNaming(const std::string& deviceId) {
    return deviceId.empty() ? std::string() : json{{"deviceId", deviceId}}.dump();
}

int statusOf(const httplib::Result& response) {
    return response ? response->status : 0;
}

void checkSameAnswer(const httplib::Result& asked, const httplib::Result& expected) {
    REQUIRE(asked);
    REQUIRE(expected);
    CHECK(asked->status == expected->status);
    CHECK(asked->body == expected->body);
}

std::string createdBy(const TestServer& server, const std::string& deviceId) {
    const auto response = post(server, "/api/sessions", json{{"deviceId", deviceId}}.dump());
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body)["id"].get<std::string>();
}

httplib::Result read(const TestServer& server, const std::string& id, const std::string& deviceId) {
    return get(server, scoped("/api/sessions/" + id, "", deviceId));
}

json documentOf(const TestServer& server, const std::string& id, const std::string& deviceId) {
    const auto response = read(server, id, deviceId);
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

std::vector<std::string> idsSeenBy(const TestServer& server, const std::string& deviceId) {
    const auto response = get(server, scoped("/api/sessions", "", deviceId));
    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto sessions = json::parse(response->body)["sessions"];
    std::vector<std::string> ids;
    std::transform(sessions.begin(), sessions.end(), std::back_inserter(ids),
                   [](const json& session) { return session["id"].get<std::string>(); });
    return ids;
}

// What an id nobody issued answers, which a refusal for a private session must not differ from.
httplib::Result unknownSessionAnswer(const TestServer& server) {
    return read(server, kNobodysSession, kTablet);
}

void share(const TestServer& server, const std::string& id, const std::string& deviceId,
           bool shared) {
    const auto response =
        post(server, scoped("/api/sessions/" + id, "", deviceId), json{{"shared", shared}}.dump());
    REQUIRE(response);
    REQUIRE(response->status == 200);
}

void play(const TestServer& server, const std::string& id, const std::string& deviceId) {
    const auto response = post(
        server,
        scoped("/api/playlists/" + std::string(kPlaylistId) + "/items/0/play", id, deviceId), "");
    REQUIRE(response);
    REQUIRE(response->status == 204);
}

httplib::Result askForTicket(const TestServer& server, const std::string& session,
                             const std::string& deviceId) {
    return post(server, scoped("/api/stream/ticket", session, ""), bodyNaming(deviceId));
}

std::string ticketFor(const TestServer& server, const std::string& session,
                      const std::string& deviceId) {
    const auto response = askForTicket(server, session, deviceId);
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body)["ticket"].get<std::string>();
}

httplib::Result listen(const TestServer& server, const std::string& ticket,
                       const std::string& alsoAsked = "") {
    return get(server, "/api/stream?ticket=" + ticket + alsoAsked);
}

httplib::Result leave(const TestServer& server, const std::string& session,
                      const std::string& deviceId) {
    return post(server, scoped("/api/stream/leave", session, ""), bodyNaming(deviceId));
}

void checkLeft(const httplib::Result& response) {
    REQUIRE(response);
    CHECK(response->status == 204);
    CHECK(response->body.empty());
}

httplib::Result askForRoster(const TestServer& server, const std::string& session,
                             const std::string& deviceId) {
    return get(server, scoped("/api/stream/listeners", session, deviceId));
}

json rosterOf(const TestServer& server, const std::string& session, const std::string& deviceId) {
    const auto response = askForRoster(server, session, deviceId);
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

std::vector<std::string> devicesOn(const json& roster) {
    std::vector<std::string> ids;
    std::transform(roster["devices"].begin(), roster["devices"].end(), std::back_inserter(ids),
                   [](const json& device) { return device["deviceId"].get<std::string>(); });
    return ids;
}

httplib::Result askForTimeline(const TestServer& server, const std::string& session,
                               const std::string& deviceId) {
    return get(server, scoped("/api/stream/timeline", session, deviceId));
}

TestServer oneClock(Source& source, Settings settings = servingSettings()) {
    return TestServer::onOneClock(std::move(settings), source.player());
}

}  // namespace

TEST_CASE(
    "a ticket naming a private session is 404 to a stranger and to no device, as an unknown id") {
    Source source;
    const TestServer server = oneClock(source);
    const auto id = createdBy(server, kPhone);
    const auto unknown = unknownSessionAnswer(server);

    checkSameAnswer(askForTicket(server, id, kTablet), unknown);
    checkSameAnswer(askForTicket(server, id, ""), unknown);
    checkSameAnswer(askForTicket(server, kNobodysSession, kPhone), unknown);

    // A refused ticket is no joining: the stranger is still nobody's member.
    checkSameAnswer(read(server, id, kTablet), unknown);
}

// The tablet only read the shared session, which joins nothing, so it is the control: the laptop
// keeps the session after the unshare because its ticket made it a member.
TEST_CASE(
    "a ticket naming a shared session makes its device a member that keeps it once unshared") {
    Source source;
    const TestServer server = oneClock(source);
    const auto id = createdBy(server, kPhone);
    share(server, id, kPhone, true);

    ticketFor(server, id, kLaptop);
    CHECK(statusOf(read(server, id, kTablet)) == 200);
    share(server, id, kPhone, false);

    CHECK(statusOf(read(server, id, kLaptop)) == 200);
    CHECK(idsSeenBy(server, kLaptop) == std::vector<std::string>{kEngineSessionId, id});
    checkSameAnswer(read(server, id, kTablet), unknownSessionAnswer(server));
}

TEST_CASE("a ticket naming no session or the engine session is today's ticket to the engine") {
    Source source;
    const TestServer server = oneClock(source);
    createdBy(server, kPhone);

    for (const std::string& session : {std::string(), std::string(kEngineSessionId)}) {
        CAPTURE(session);
        const auto response = listen(server, ticketFor(server, session, kPhone));
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(response->body == bytesOf(kEngineSessionId));
    }

    CHECK(source.opens(kEngineSessionId).size() == 2);
}

TEST_CASE("with streamingEnabled off, a session's ticket and stream are refused as the engine's") {
    Source source;
    TestServer server = oneClock(source);
    const auto id = createdBy(server, kPhone);
    const auto engineTicket = ticketFor(server, "", kPhone);
    const auto sessionTicket = ticketFor(server, id, kPhone);

    server.reload(R"({"streamingEnabled": false})");

    const auto engine = askForTicket(server, "", kPhone);
    REQUIRE(engine);
    CHECK(engine->status == 503);
    checkSameAnswer(askForTicket(server, id, kPhone), engine);

    const auto engineStream = listen(server, engineTicket);
    REQUIRE(engineStream);
    CHECK(engineStream->status == 503);
    checkSameAnswer(listen(server, sessionTicket), engineStream);

    CHECK(source.opens(kEngineSessionId).empty());
    CHECK(source.opens(id).empty());
}

TEST_CASE("a ticket issued for a session streams that session's bytes, and no other's") {
    Source source;
    const TestServer server = oneClock(source);
    const auto kitchen = createdBy(server, kPhone);
    const auto desk = createdBy(server, kLaptop);

    const auto fromKitchen = listen(server, ticketFor(server, kitchen, kPhone));
    const auto fromDesk = listen(server, ticketFor(server, desk, kLaptop));
    const auto fromEngine = listen(server, ticketFor(server, "", kTablet));

    REQUIRE(fromKitchen);
    CHECK(fromKitchen->status == 200);
    CHECK(fromKitchen->body == bytesOf(kitchen));
    CHECK(fromKitchen->get_header_value("Content-Type") == "audio/ogg");
    CHECK(fromKitchen->get_header_value("Cache-Control") == "no-store");

    REQUIRE(fromDesk);
    CHECK(fromDesk->body == bytesOf(desk));

    REQUIRE(fromEngine);
    CHECK(fromEngine->body == bytesOf(kEngineSessionId));

    CHECK(source.opens(kitchen).size() == 1);
    CHECK(source.opens(desk).size() == 1);
    CHECK(source.opens(kEngineSessionId).size() == 1);
}

// An <audio> element's URL is the ticket and whatever a client appended to it, so a session named
// there is a second, unchecked way to choose a stream.
TEST_CASE(
    "the stream reads no session of its own, so one named beside the ticket changes nothing") {
    Source source;
    const TestServer server = oneClock(source);
    const auto kitchen = createdBy(server, kPhone);
    const auto desk = createdBy(server, kLaptop);
    share(server, desk, kLaptop, true);

    for (const std::string& named :
         {desk, std::string(kEngineSessionId), std::string(kNobodysSession)}) {
        CAPTURE(named);
        const auto response =
            listen(server, ticketFor(server, kitchen, kPhone), "&session=" + named);
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(response->body == bytesOf(kitchen));
    }

    const auto engine = listen(server, ticketFor(server, "", kPhone), "&session=" + kitchen);
    REQUIRE(engine);
    CHECK(engine->status == 200);
    CHECK(engine->body == bytesOf(kEngineSessionId));

    CHECK(source.opens(desk).empty());
}

TEST_CASE("a ticket whose session was reaped before it connected is 404, as an unknown id") {
    Source source;
    const TestServer server = oneClock(source);
    const auto id = createdBy(server, kPhone);
    const auto ticket = ticketFor(server, id, kPhone);

    checkLeft(leave(server, id, kPhone));

    checkSameAnswer(listen(server, ticket), unknownSessionAnswer(server));
    CHECK(source.opens(id).empty());
}

TEST_CASE(
    "a session's stream opens in the format asked for, and refuses what the engine's refuses") {
    Source source;
    const TestServer server = oneClock(source);
    const auto id = createdBy(server, kPhone);

    const auto aac = listen(server, ticketFor(server, id, kPhone), "&format=aac");
    REQUIRE(aac);
    CHECK(aac->status == 200);
    CHECK(aac->get_header_value("Content-Type") == "audio/aac");
    CHECK(source.opens(id) == std::vector<std::string>{"aac"});

    const auto engineFlac = listen(server, ticketFor(server, "", kPhone), "&format=flac");
    REQUIRE(engineFlac);
    CHECK(engineFlac->status == 400);
    checkSameAnswer(listen(server, ticketFor(server, id, kPhone), "&format=flac"), engineFlac);

    const auto unissued = listen(server, "ticket-nobody-issued");
    REQUIRE(unissued);
    CHECK(unissued->status == 401);
    checkSameAnswer(listen(server, "ticket-nobody-issued", "&session=" + id), unissued);

    CHECK(source.opens(id) == std::vector<std::string>{"aac"});
    CHECK(source.opens(kEngineSessionId).empty());
    CHECK(documentOf(server, id, kPhone)["listeners"] == 0);
}

// A session plays to nobody without decoding, and a linger is nobody: decoding then would play to
// a device that has gone and skip a returning one ahead.
TEST_CASE("a session decodes only while a connection listens, and its document counts the device") {
    Source source;
    const TestServer server = oneClock(source);
    Connections live(server, source);
    const auto id = createdBy(server, kPhone);
    play(server, id, kPhone);
    const auto session = source.session(id);
    REQUIRE(session->turn().has_value());
    CHECK_FALSE(session->running());

    source.hold(id);
    live.open(ticketFor(server, id, kPhone));
    settlesAt(session->audience(), 1);

    CHECK(session->running());
    CHECK(documentOf(server, id, kPhone)["listeners"] == 1);
    CHECK(devicesOn(rosterOf(server, id, kPhone)) == std::vector<std::string>{kPhone});

    source.letGo(id);
    settlesAt(session->audience(), 0);

    CHECK_FALSE(session->running());
    CHECK(documentOf(server, id, kPhone)["listeners"] == 0);
    CHECK(rosterOf(server, id, kPhone)["devices"].empty());
}

// Past the grace, the connection alone holds the session, and once it closes the linger alone.
TEST_CASE("a device that stops listening holds the session through its linger, and not after it") {
    Source source;
    const TestServer server = oneClock(source);
    Connections live(server, source);
    const auto id = createdBy(server, kPhone);
    const auto session = source.session(id);

    source.hold(id);
    live.open(ticketFor(server, id, kPhone));
    settlesAt(session->audience(), 1);
    server.advanceRateLimits(kPastTheGrace);
    REQUIRE(statusOf(read(server, id, kPhone)) == 200);

    source.letGo(id);
    settlesAt(session->audience(), 0);
    server.advanceRateLimits(std::chrono::seconds(kMuteLingerSeconds - 1));
    CHECK(statusOf(read(server, id, kPhone)) == 200);

    server.advanceRateLimits(std::chrono::seconds(2));
    checkSameAnswer(read(server, id, kPhone), unknownSessionAnswer(server));
    CHECK(idsSeenBy(server, kPhone) == std::vector<std::string>{kEngineSessionId});
    CHECK(source.stops(id) == 1);
}

// The ticket a reconnect asks for sweeps the registry first, so a session its only listener had
// left would be reaped by the very request coming back for it, but for the linger.
TEST_CASE("a reconnect inside the linger keeps a session its listener was the only member of") {
    Source source;
    const TestServer server = oneClock(source);
    Connections live(server, source);
    const auto id = createdBy(server, kPhone);
    const auto session = source.session(id);

    source.hold(id);
    live.open(ticketFor(server, id, kPhone));
    settlesAt(session->audience(), 1);
    server.advanceRateLimits(kPastTheGrace);
    source.letGo(id);
    settlesAt(session->audience(), 0);

    server.advanceRateLimits(std::chrono::seconds(kMuteLingerSeconds - 1));
    const auto back = listen(server, ticketFor(server, id, kPhone));

    REQUIRE(back);
    CHECK(back->status == 200);
    CHECK(back->body == bytesOf(id));
    CHECK(source.stops(id) == 0);
}

TEST_CASE("the timeline naming a session is that session's clock, and naming none the engine's") {
    Source source;
    const TestServer server = oneClock(source);
    const auto kitchen = createdBy(server, kPhone);
    const auto desk = createdBy(server, kLaptop);

    const auto engine = askForTimeline(server, "", "");
    REQUIRE(engine);
    CHECK(engine->status == 200);
    CHECK(engine->body == timelineOf(kEngineSessionId));
    checkSameAnswer(askForTimeline(server, kEngineSessionId, kPhone), engine);

    const auto ofKitchen = askForTimeline(server, kitchen, kPhone);
    REQUIRE(ofKitchen);
    CHECK(ofKitchen->status == 200);
    CHECK(ofKitchen->body == timelineOf(kitchen));
    CHECK(ofKitchen->get_header_value("Cache-Control") ==
          engine->get_header_value("Cache-Control"));

    const auto ofDesk = askForTimeline(server, desk, kLaptop);
    REQUIRE(ofDesk);
    CHECK(ofDesk->body == timelineOf(desk));
}

TEST_CASE("the timeline naming a private session is 404 to a stranger and to no device") {
    Source source;
    const TestServer server = oneClock(source);
    const auto id = createdBy(server, kPhone);
    const auto unknown = unknownSessionAnswer(server);

    checkSameAnswer(askForTimeline(server, id, kTablet), unknown);
    checkSameAnswer(askForTimeline(server, id, ""), unknown);
    checkSameAnswer(askForTimeline(server, kNobodysSession, kPhone), unknown);
}

// The laptop created both sessions, so the phone's leave reaps neither and its linger in each is
// still there to read.
TEST_CASE("a leave naming a session ends the device's linger in that session and in no other") {
    Source source;
    const TestServer server = oneClock(source);
    Connections live(server, source);
    const auto kitchen = createdBy(server, kLaptop);
    const auto desk = createdBy(server, kLaptop);
    share(server, kitchen, kLaptop, true);
    share(server, desk, kLaptop, true);
    const auto inKitchen = source.session(kitchen);
    const auto atDesk = source.session(desk);

    for (const std::string& key : {std::string(kEngineSessionId), kitchen, desk})
        source.hold(key);
    live.open(ticketFor(server, "", kPhone));
    live.open(ticketFor(server, kitchen, kPhone));
    live.open(ticketFor(server, desk, kPhone));
    settlesAt(server.audience(), 1);
    settlesAt(inKitchen->audience(), 1);
    settlesAt(atDesk->audience(), 1);

    for (const std::string& key : {std::string(kEngineSessionId), kitchen, desk})
        source.letGo(key);
    settlesAt(server.audience(), 0);
    settlesAt(inKitchen->audience(), 0);
    settlesAt(atDesk->audience(), 0);
    REQUIRE(holdsDevice(inKitchen->audience(), kPhone));

    checkLeft(leave(server, kitchen, kPhone));

    CHECK_FALSE(holdsDevice(inKitchen->audience(), kPhone));
    CHECK(holdsDevice(atDesk->audience(), kPhone));
    CHECK(holdsDevice(server.audience(), kPhone));
}

TEST_CASE("a leave naming no session or the engine session ends the engine's linger and no other") {
    Source source;
    const TestServer server = oneClock(source);
    Connections live(server, source);
    const auto id = createdBy(server, kPhone);
    const auto session = source.session(id);

    source.hold(kEngineSessionId);
    source.hold(id);
    live.open(ticketFor(server, "", kPhone));
    live.open(ticketFor(server, id, kPhone));
    settlesAt(server.audience(), 1);
    settlesAt(session->audience(), 1);
    source.letGo(kEngineSessionId);
    source.letGo(id);
    settlesAt(server.audience(), 0);
    settlesAt(session->audience(), 0);
    REQUIRE(holdsDevice(server.audience(), kPhone));

    SUBCASE("naming none") {
        checkLeft(leave(server, "", kPhone));
    }
    SUBCASE("naming the engine session") {
        checkLeft(leave(server, kEngineSessionId, kPhone));
    }

    CHECK_FALSE(holdsDevice(server.audience(), kPhone));
    CHECK(holdsDevice(session->audience(), kPhone));
    CHECK(statusOf(read(server, id, kPhone)) == 200);
    CHECK(statusOf(read(server, kEngineSessionId, kPhone)) == 200);
}

TEST_CASE("a leave naming a detached session ends the device's controlling grace there too") {
    Source source;
    const TestServer server = oneClock(source);
    const auto id = createdBy(server, kLaptop);
    share(server, id, kLaptop, true);
    ticketFor(server, id, kPhone);
    share(server, id, kLaptop, false);
    REQUIRE(statusOf(read(server, id, kPhone)) == 200);

    checkLeft(leave(server, id, kPhone));

    checkSameAnswer(read(server, id, kPhone), unknownSessionAnswer(server));
    CHECK(statusOf(read(server, id, kLaptop)) == 200);
}

// Shared, so a stranger could read it until the leave: gone means gone for everybody, at once,
// with the clock where the create left it.
TEST_CASE("a session whose last member leaves is gone at once for everyone and frees its place") {
    Source source;
    const TestServer server = oneClock(source, parseSettings(R"({"maxSessions": 1})"));
    const auto id = createdBy(server, kPhone);
    share(server, id, kPhone, true);
    REQUIRE(statusOf(read(server, id, kLaptop)) == 200);

    checkLeft(leave(server, id, kPhone));

    // Read before any other request, whose own sweep would reap an expired session anyway.
    CHECK(source.stops(id) == 1);
    const auto unknown = unknownSessionAnswer(server);
    checkSameAnswer(read(server, id, kPhone), unknown);
    checkSameAnswer(read(server, id, kLaptop), unknown);
    CHECK(statusOf(post(server, "/api/sessions", json{{"deviceId", kLaptop}}.dump())) == 200);
}

TEST_CASE("a leave keeps a session another member controls, the leaver no longer a member") {
    Source source;
    const TestServer server = oneClock(source);
    const auto id = createdBy(server, kPhone);
    share(server, id, kPhone, true);
    ticketFor(server, id, kLaptop);

    checkLeft(leave(server, id, kPhone));

    CHECK(statusOf(read(server, id, kLaptop)) == 200);
    CHECK(source.stops(id) == 0);
    share(server, id, kLaptop, false);
    checkSameAnswer(read(server, id, kPhone), unknownSessionAnswer(server));
}

// No route ends a session for a device still in it: the leave takes the grace, the connection
// keeps the device on the roster, and its linger is what holds the session once it closes.
TEST_CASE("a leave by a device still connected keeps it on the roster and keeps the session") {
    Source source;
    const TestServer server = oneClock(source);
    Connections live(server, source);
    const auto id = createdBy(server, kPhone);
    const auto session = source.session(id);
    source.hold(id);
    live.open(ticketFor(server, id, kPhone));
    settlesAt(session->audience(), 1);

    checkLeft(leave(server, id, kPhone));

    CHECK(devicesOn(rosterOf(server, id, kPhone)) == std::vector<std::string>{kPhone});
    CHECK(documentOf(server, id, kPhone)["listeners"] == 1);
    CHECK(source.stops(id) == 0);

    source.letGo(id);
    settlesAt(session->audience(), 0);
    CHECK(statusOf(read(server, id, kPhone)) == 200);

    server.advanceRateLimits(kPastTheLinger);
    checkSameAnswer(read(server, id, kPhone), unknownSessionAnswer(server));
}

// Each refusal faces a device lingering in the session and in the engine, because a 404 that still
// reached either audience would end a linger somebody else is relying on.
TEST_CASE(
    "a leave naming a private session is 404 to a stranger and for an unknown id, and ends "
    "nothing") {
    Source source;
    const TestServer server = oneClock(source);
    Connections live(server, source);
    const auto id = createdBy(server, kPhone);
    const auto session = source.session(id);
    source.hold(kEngineSessionId);
    source.hold(id);
    live.open(ticketFor(server, "", kPhone));
    live.open(ticketFor(server, id, kPhone));
    settlesAt(server.audience(), 1);
    settlesAt(session->audience(), 1);
    source.letGo(kEngineSessionId);
    source.letGo(id);
    settlesAt(server.audience(), 0);
    settlesAt(session->audience(), 0);
    const auto unknown = unknownSessionAnswer(server);

    checkSameAnswer(leave(server, id, kTablet), unknown);
    checkSameAnswer(leave(server, kNobodysSession, kPhone), unknown);

    CHECK(holdsDevice(session->audience(), kPhone));
    CHECK(holdsDevice(server.audience(), kPhone));
    CHECK(statusOf(read(server, id, kPhone)) == 200);
}

// The sequence the conformance probe drives, once, end to end: the leave is the one request that
// ends a session before its grace does.
TEST_CASE("a session is created, played, listened to, closed and left, and is then gone") {
    Source source;
    const TestServer server = oneClock(source);
    Connections live(server, source);

    const auto id = createdBy(server, kPhone);
    play(server, id, kPhone);
    const auto ticket = ticketFor(server, id, kPhone);
    const auto session = source.session(id);
    source.hold(id);
    live.open(ticket);
    settlesAt(session->audience(), 1);
    CHECK(session->running());

    source.letGo(id);
    settlesAt(session->audience(), 0);
    REQUIRE(source.stops(id) == 0);

    checkLeft(leave(server, id, kPhone));

    CHECK(source.stops(id) == 1);
    checkSameAnswer(read(server, id, kPhone), unknownSessionAnswer(server));
    CHECK(idsSeenBy(server, kPhone) == std::vector<std::string>{kEngineSessionId});
    CHECK(source.opens(id).size() == 1);
}

// HttpServer::stop joins the connection threads, and a listener blocked in a session's stream
// holds its thread until that session's stream stops, so the sessions have to stop first.
TEST_CASE("stopping the server stops a session once and ends the stream its listener is reading") {
    Source source;
    auto server = std::make_unique<TestServer>(oneClock(source));
    const auto id = createdBy(*server, kPhone);
    const auto session = source.session(id);
    source.hold(id);

    auto client = server->client();
    const auto url = "/api/stream?ticket=" + ticketFor(*server, id, kPhone);
    std::atomic<bool> readEnded{false};
    std::thread listener([&client, &url, &readEnded] {
        client.Get(url);
        readEnded = true;
    });

    settlesAt(session->audience(), 1);
    REQUIRE(devicesOn(rosterOf(*server, id, kPhone)) == std::vector<std::string>{kPhone});
    REQUIRE_FALSE(readEnded);

    std::atomic<bool> stopped{false};
    std::thread stopper([&server, &stopped] {
        server.reset();
        stopped = true;
    });
    joinOnceFinished(stopper, stopped, "the server to stop with a session listener connected");
    joinOnceFinished(listener, readEnded, "the listener's read to end once the server stopped");

    CHECK(source.stops(id) == 1);
}

TEST_CASE("the roster naming a session lists its own devices, and counts connections across all") {
    Source source;
    const TestServer server = oneClock(source);
    Connections live(server, source);
    const auto kitchen = createdBy(server, kPhone);
    const auto desk = createdBy(server, kLaptop);
    const auto inKitchen = source.session(kitchen);
    const auto atDesk = source.session(desk);

    for (const std::string& key : {std::string(kEngineSessionId), kitchen, desk})
        source.hold(key);
    live.open(ticketFor(server, kitchen, kPhone));
    live.open(ticketFor(server, desk, kLaptop));
    live.open(ticketFor(server, "", kTablet));
    settlesAt(inKitchen->audience(), 1);
    settlesAt(atDesk->audience(), 1);
    settlesAt(server.audience(), 1);

    const auto ofKitchen = rosterOf(server, kitchen, kPhone);
    const auto ofDesk = rosterOf(server, desk, kLaptop);
    const auto ofEngine = rosterOf(server, "", "");
    const auto ofEngineNamed = rosterOf(server, kEngineSessionId, kPhone);

    CHECK(devicesOn(ofKitchen) == std::vector<std::string>{kPhone});
    CHECK(devicesOn(ofDesk) == std::vector<std::string>{kLaptop});
    CHECK(devicesOn(ofEngine) == std::vector<std::string>{kTablet});
    CHECK(devicesOn(ofEngineNamed) == std::vector<std::string>{kTablet});

    for (const auto* roster : {&ofKitchen, &ofDesk, &ofEngine, &ofEngineNamed}) {
        CHECK((*roster)["connections"] == 3);
        CHECK((*roster)["maxConnections"] == servingSettings().maxConcurrentStreams);
    }
}

TEST_CASE("playerMuted on a session's roster is the player's, whichever session is named") {
    Source source;
    const TestServer server = oneClock(source);
    const auto id = createdBy(server, kPhone);

    for (const bool muted : {true, false}) {
        CAPTURE(muted);
        source.mutePlayer(muted);
        CHECK(rosterOf(server, id, kPhone)["playerMuted"] == muted);
        CHECK(rosterOf(server, kEngineSessionId, kPhone)["playerMuted"] == muted);
        CHECK(rosterOf(server, "", "")["playerMuted"] == muted);
    }
}

TEST_CASE("a private session's roster is a member's alone, and a shared one's is anybody's") {
    Source source;
    const TestServer server = oneClock(source);
    const auto id = createdBy(server, kPhone);
    const auto unknown = unknownSessionAnswer(server);

    CHECK(statusOf(askForRoster(server, id, kPhone)) == 200);
    checkSameAnswer(askForRoster(server, id, kTablet), unknown);
    checkSameAnswer(askForRoster(server, id, ""), unknown);
    checkSameAnswer(askForRoster(server, kNobodysSession, kPhone), unknown);

    share(server, id, kPhone, true);
    CHECK(statusOf(askForRoster(server, id, kTablet)) == 200);
    CHECK(statusOf(askForRoster(server, id, "")) == 200);
}

namespace {

// The player's volume as OutputHold reaches it, counting each silence the hold takes.
struct Volume {
    std::atomic<float> level{-10.0F};
    std::atomic<float> beforeMute{-10.0F};
    std::atomic<bool> muted{false};
    std::atomic<int> mutes{0};

    OutputHold::Player seam() {
        OutputHold::Player player;
        player.isMuted = [this] { return muted.load(); };
        player.setMuted = [this](bool value) {
            if (value) {
                beforeMute = level.load();
                ++mutes;
            }
            level = value ? -100.0F : beforeMute.load();
            muted = value;
        };
        player.volume = [this]() -> std::optional<float> { return level.load(); };
        player.setVolume = [this](float value) { level = value; };
        return player;
    }
};

}  // namespace

// The hold is built on the engine's audience, as foo_jean builds it, and decides on a thread of its
// own that gives no event for a decision it did not take. So the absence is read off the audience
// the hold follows, which is synchronous, and the hold's own mute is waited for where there is one.
TEST_CASE(
    "a device listening to a detached session takes no hold on the player, an engine one does") {
    Source source;
    const TestServer server(servingSettings(), source.player());
    Volume volume;
    const OutputHold hold(server.audience(), volume.seam(), true);
    source.heldBy(&hold);
    Connections live(server, source);
    const auto id = createdBy(server, kPhone);
    const auto session = source.session(id);

    source.hold(id);
    live.open(ticketFor(server, id, kPhone));
    settlesAt(session->audience(), 1);

    CHECK_FALSE(server.audience().anyListening(server.audience().now()));
    CHECK(rosterOf(server, id, kPhone)["playerMuted"] == false);

    source.hold(kEngineSessionId);
    live.open(ticketFor(server, "", kLaptop));
    settlesAt(server.audience(), 1);
    REQUIRE(eventually([&volume] { return volume.muted.load(); }));
    CHECK(rosterOf(server, id, kPhone)["playerMuted"] == true);
    CHECK(rosterOf(server, "", "")["playerMuted"] == true);

    source.letGo(id);
    settlesAt(session->audience(), 0);
    CHECK(server.audience().anyListening(server.audience().now()));
    CHECK(volume.muted);
    CHECK(volume.mutes == 1);
}

// Every connection costs a pooled thread whichever session it hears, so the cap counts them all,
// and a refusal is the engine's whichever stream was asked for.
TEST_CASE("maxConcurrentStreams bounds the connections of every session and the engine together") {
    auto settings = servingSettings();
    settings.maxConcurrentStreams = 2;
    Source source;
    const TestServer server = oneClock(source, settings);
    Connections live(server, source);
    const auto kitchen = createdBy(server, kPhone);
    const auto desk = createdBy(server, kLaptop);
    const auto inKitchen = source.session(kitchen);
    const auto atDesk = source.session(desk);

    for (const std::string& key : {std::string(kEngineSessionId), kitchen, desk})
        source.hold(key);
    live.open(ticketFor(server, "", kPhone));
    live.open(ticketFor(server, kitchen, kPhone));
    settlesAt(server.audience(), 1);
    settlesAt(inKitchen->audience(), 1);

    const auto engine = listen(server, ticketFor(server, "", kTablet));
    REQUIRE(engine);
    CHECK(engine->status == 503);
    CHECK(errorOf(*engine) == kAtTheCap);
    checkSameAnswer(listen(server, ticketFor(server, desk, kLaptop)), engine);
    checkSameAnswer(listen(server, ticketFor(server, kitchen, kPhone)), engine);
    CHECK(source.opens(desk).empty());

    source.letGo(kitchen);
    settlesAt(inKitchen->audience(), 0);
    live.open(ticketFor(server, desk, kLaptop));
    settlesAt(atDesk->audience(), 1);

    checkSameAnswer(listen(server, ticketFor(server, kitchen, kPhone)), engine);
    CHECK(source.opens(kitchen).size() == 1);
    CHECK(source.opens(desk).size() == 1);
}

namespace {

httplib::Result pollHolding(const TestServer& server, const std::string& id,
                            const std::string& tag) {
    return server.client().Get(scoped("/api/state", id, kPhone),
                               httplib::Headers{{"If-None-Match", tag}});
}

json playerOf(const httplib::Result& response) {
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body)["player"];
}

std::string tagOf(const httplib::Result& response) {
    REQUIRE(response);
    REQUIRE(response->status == 200);
    auto tag = response->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());
    return tag;
}

// A connection is counted on the session under the session's own lock, a moment after the audience
// counts it, so a case waits on the session itself. The waiting reads are unasserted and the answer
// is asserted once, so the suite's assertion total stays fixed.
void runsAt(const Session& session, bool running) {
    eventually([&session, running] { return session.running() == running; });
    REQUIRE(session.running() == running);
}

}  // namespace

TEST_CASE(
    "a session set to play reads paused until a connection listens, and again once it closes") {
    Source source;
    const TestServer server = oneClock(source);
    Connections live(server, source);
    const auto id = createdBy(server, kPhone);
    play(server, id, kPhone);
    const auto session = source.session(id);

    const auto unheard = get(server, scoped("/api/state", id, kPhone));
    const auto unheardTag = tagOf(unheard);
    const auto revision = playerOf(unheard)["sessionRevision"];
    CHECK(playerOf(unheard)["playback"] == "paused");
    CHECK(documentOf(server, id, kPhone)["playback"] == "paused");

    source.hold(id);
    live.open(ticketFor(server, id, kPhone));
    runsAt(*session, true);

    const auto heard = pollHolding(server, id, unheardTag);
    CHECK(playerOf(heard)["playback"] == "playing");
    CHECK(heard->get_header_value("ETag") != unheardTag);
    CHECK(playerOf(heard)["sessionRevision"] == revision);
    CHECK(documentOf(server, id, kPhone)["playback"] == "playing");

    const auto heardTag = tagOf(heard);
    source.letGo(id);
    runsAt(*session, false);

    const auto left = pollHolding(server, id, heardTag);
    CHECK(playerOf(left)["playback"] == "paused");
    CHECK(left->get_header_value("ETag") != heardTag);
    CHECK(playerOf(left)["sessionRevision"] == revision);
    CHECK(documentOf(server, id, kPhone)["playback"] == "paused");
}
