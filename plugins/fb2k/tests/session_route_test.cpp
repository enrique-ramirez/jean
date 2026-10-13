// /api/sessions over a real socket: creating a detached session, the list and the read each device
// is answered, and sharing. What these pin is what a client drawing a session picker reads, and
// that none of it reaches the player: a session is the component's own, and the player hears of
// it only once something plays.

#include "third_party/doctest.h"

#include "core/artwork.h"
#include "core/audience.h"
#include "core/failures.h"
#include "core/library.h"
#include "core/player_state.h"
#include "core/session.h"
#include "core/settings.h"
#include "support/fake_player.h"
#include "support/http.h"
#include "support/keys.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <iterator>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kPhone[] = "phone-4c1e";
constexpr char kLaptop[] = "laptop-9a07";
constexpr char kTablet[] = "tablet-2b55";

constexpr char kNoSuchSession[] = "no such session";

// The ids the mint gives, in this order. Sorted, they run the other way round and all come
// before "engine", so a list kept in id order rather than creation order fails.
const std::vector<std::string>& mintedIds() {
    static const std::vector<std::string> ids{"Wb3kq", "Ad9xz", "Mq7rv"};
    return ids;
}

TicketMint scriptedMint() {
    const auto issued = std::make_shared<size_t>(0);
    return [issued] {
        const size_t next = (*issued)++;
        return next < mintedIds().size() ? mintedIds()[next] : "minted-" + std::to_string(next);
    };
}

// A track a session plays: its path, and the library path the session's document publishes,
// which is how a case reads which track a session is on.
SessionTrack track(const std::string& name) {
    SessionTrack made;
    made.path = "X:\\music\\" + name + ".flac";
    made.libraryPath = "Fictional Artist/" + name + ".flac";
    made.handle = std::make_shared<const std::string>(name);
    return made;
}

std::vector<SessionTrack> tracks(const std::string& prefix, size_t count) {
    std::vector<SessionTrack> made;
    made.reserve(count);
    for (size_t row = 0; row < count; ++row)
        made.push_back(track(prefix + " " + std::to_string(row)));
    return made;
}

std::string libraryPathOf(const SessionTrack& made) {
    return made.libraryPath.value_or("");
}

// The name track() gave, read back through the handle as fb2k/ reads a track, so a reader handed
// a track without its handle answers an empty name.
std::string nameOf(const SessionTrack& made) {
    return made.handle ? *static_cast<const std::string*>(made.handle.get()) : std::string();
}

// A track whose name starts "Untagged" carries a title and no artist, album or album artist.
bool untagged(const std::string& name) {
    return name.rfind("Untagged", 0) == 0;
}

// What the track reader answers for a track, each name and each column asked for spelled from the
// track's own. An untagged track's three missing names are read as foobar2000 evaluates a missing
// field, as an empty string.
SessionTrackRead namesOf(const SessionTrack& made, const std::vector<std::string>& columns = {}) {
    const auto name = nameOf(made);
    SessionTrackRead read;
    read.title = name;
    if (!untagged(name)) {
        read.artist = "Artist of " + name;
        read.album = "Album of " + name;
        read.albumArtist = "Album artist of " + name;
    }
    std::transform(columns.begin(), columns.end(), std::back_inserter(read.columns),
                   [&name](const std::string& column) { return column + " of " + name; });
    return read;
}

// A JPEG for each track, told apart by the track's name. A track whose name starts "Bare" has none.
std::string coverOf(const std::string& name) {
    return std::string("\xFF\xD8\xFF") + "the cover of " + name;
}

bool bare(const std::string& name) {
    return name.rfind("Bare", 0) == 0;
}

// The picture the cover reader answers for a track. A track whose name starts "Oversized" carries
// one a byte past kMaxArtworkBytes, and one whose name starts "Full" one exactly that long.
std::string pictureOf(const std::string& name) {
    auto picture = coverOf(name);
    if (name.rfind("Oversized", 0) == 0)
        picture.resize(kMaxArtworkBytes + 1, 'x');
    else if (name.rfind("Full", 0) == 0)
        picture.resize(kMaxArtworkBytes, 'x');
    return picture;
}

// The engine's own playing track, which no session's answer may carry.
constexpr char kEnginePlayingPath[] = R"(X:\music\Fictional Artist\Engine Album\01 Engine.flac)";

// The revision the queue reader answers with every read. The route sets the session's own, so a
// queue answering this one passed the reader's through.
constexpr uint64_t kReaderRevision = 7770;

QueuedTrack queuedOf(const SessionTrack& made) {
    QueuedTrack queued;
    queued.title = nameOf(made);
    queued.artist = "Fictional Artist";
    queued.album = "Imaginary Album";
    queued.albumArtist = "Various Fictional Artists";
    queued.duration = 200;
    queued.libraryPath = made.libraryPath;
    return queued;
}

// The track the library taker answers for `ordinal`, before anything changes what it answers.
std::string libraryName(uint32_t ordinal, const std::string& prefix = "Library") {
    return prefix + " " + std::to_string(ordinal);
}

using LibraryTake = std::pair<uint64_t, std::vector<uint32_t>>;

// What the engine was asked, in the order it was asked.
struct EngineCommands {
    std::vector<Transport> transports;
    std::vector<std::pair<double, bool>> seeks;
    std::vector<size_t> orders;
};

// The player every case runs against. Playlists, the queue and the row play are the fake
// foobar2000's, holding kPlaylistId; the engine's transport, seek and order are recorded here and
// every other playback call is counted; the session stream starts and plays nothing, and each
// session it is started for is kept, weakly, so a case can read what no route publishes yet; the
// playlist taker answers whatever a case holds for a playlist; and the track and cover readers
// answer from the track they are handed. The player streams, so a session can be created. A route
// here that reached the player at all shows in calls().
class Recorder {
public:
    Recorder() {
        PlaylistAnnotation roadTrip;
        roadTrip.id = kPlaylistId;
        roadTrip.title = "Road trip";
        foobar_.add(roadTrip, titledRows({"One", "Two", "Three"}));
    }

    Player player(bool offersSessions = true) {
        auto built = foobar_.player();
        built.report.playbackOrders = installedOrders();

        built.playback.commandTransport = [this](Transport command) {
            const std::lock_guard<std::mutex> held(mutex_);
            engine_.transports.push_back(command);
            return PlayerOutcome::done;
        };
        built.playback.seek = [this](double seconds, bool relative) {
            const std::lock_guard<std::mutex> held(mutex_);
            engine_.seeks.emplace_back(seconds, relative);
            return PlayerOutcome::done;
        };
        built.playback.setOrder = [this](size_t index) {
            const std::lock_guard<std::mutex> held(mutex_);
            engine_.orders.push_back(index);
            return PlayerOutcome::done;
        };
        built.playback.setVolume = [this](double) { return counted(); };
        built.playback.stepVolume = [this](VolumeStep) { return counted(); };
        built.playback.setMuted = [this](bool) { return counted(); };
        built.playback.readPlayingTrack = [this](const std::vector<std::string>& columns) {
            counted();
            PlayingTrackRead read;
            read.playing = true;
            read.path = kEnginePlayingPath;
            std::transform(columns.begin(), columns.end(), std::back_inserter(read.columns),
                           [](const std::string& column) { return column + " at the engine"; });
            return read;
        };
        built.outputs.setActive = [this](const std::string&) { return counted(); };

        if (offersSessions) {
            built.sessions.start = [this](Session& session) {
                const std::lock_guard<std::mutex> held(mutex_);
                started_[session.id()] = session.shared_from_this();
                SessionStream stream;
                stream.stop = [] {};
                return stream;
            };
        }

        built.sessions.takePlaylist = [this](
                                          const std::string& playlistId,
                                          const std::optional<std::vector<uint32_t>>& positions) {
            const std::lock_guard<std::mutex> held(mutex_);
            taken_.push_back(playlistId);
            takenWithPositions_ += positions ? 1 : 0;

            SessionTracksRead read;
            const auto found = held_.find(playlistId);
            if (found == held_.end()) {
                read.outcome = PlayerOutcome::noSuchPlaylist;
            } else if (!positions) {
                read.tracks = found->second;
            } else {
                for (const auto position : *positions) {
                    if (position >= found->second.size())
                        return SessionTracksRead{PlayerOutcome::positionPastEnd, {}};
                    read.tracks.push_back(found->second[position]);
                }
            }
            return read;
        };

        built.sessions.takeLibrary = [this](uint64_t structure,
                                            const std::vector<uint32_t>& ordinals) {
            const std::lock_guard<std::mutex> held(mutex_);
            libraryTaken_.emplace_back(structure, ordinals);

            SessionTracksRead read;
            if (libraryMoved_) {
                read.outcome = PlayerOutcome::structureMoved;
                return read;
            }
            std::transform(
                ordinals.begin(), ordinals.end(), std::back_inserter(read.tracks),
                [this](uint32_t ordinal) { return track(libraryName(ordinal, libraryPrefix_)); });
            return read;
        };

        built.sessions.readTrack = [this](const SessionTrack& playing,
                                          const std::vector<std::string>& columns) {
            const std::lock_guard<std::mutex> held(mutex_);
            trackReads_.push_back(nameOf(playing));
            trackColumns_.push_back(columns);
            const auto unread = unnamed_.find(nameOf(playing));
            if (unread != unnamed_.end() && unread->second != PlayerOutcome::done)
                return SessionTrackRead{.outcome = unread->second};

            auto read = namesOf(playing, columns);
            const auto length = lengths_.find(nameOf(playing));
            read.duration = length == lengths_.end() ? 0 : length->second;
            if (unread != unnamed_.end()) {
                read = SessionTrackRead{};
                read.named = false;
                read.columns.assign(columns.size(), "?");
            }
            return read;
        };

        built.sessions.readArtwork = [this](const SessionTrack& playing) {
            const std::lock_guard<std::mutex> held(mutex_);
            const auto name = nameOf(playing);
            artworkReads_.push_back(name);

            ArtworkSource source;
            if (bare(name))
                return source;
            auto picture = pictureOf(name);
            source.tag = artworkTag(picture);
            source.picture = std::make_shared<const std::string>(std::move(picture));
            return source;
        };

        built.sessions.readQueue = [this](const std::vector<SessionTrack>& entries) {
            const std::lock_guard<std::mutex> held(mutex_);
            ++queueReads_;

            QueueRead read;
            read.revision = kReaderRevision;
            std::transform(entries.begin(), entries.end(), std::back_inserter(read.entries),
                           queuedOf);
            return read;
        };

        built.stream.formats = {"opus", "aac"};

        return built;
    }

    // An install whose orders are neither stock nor in the stock sequence, with one this
    // component has no name for.
    static std::vector<std::string> installedOrders() {
        return {"Shuffle (albums)", "Default", "Random", "Repeat (track)", "Shuffle (by mood)"};
    }

    // Every call the engine's seams answered, the fake foobar2000's included.
    int calls() const {
        const std::lock_guard<std::mutex> held(mutex_);
        return foobar_.total() + playbackCalls_ + static_cast<int>(engine_.transports.size()) +
               static_cast<int>(engine_.seeks.size()) + static_cast<int>(engine_.orders.size());
    }

    EngineCommands engine() const {
        const std::lock_guard<std::mutex> held(mutex_);
        return engine_;
    }

    int rowPlays() const { return foobar_.count(Call::playRow); }

    // What the taker answers for `playlistId` from now on.
    void hold(const std::string& playlistId, std::vector<SessionTrack> rows) {
        const std::lock_guard<std::mutex> held(mutex_);
        held_[playlistId] = std::move(rows);
    }

    // The playlists the taker was asked for, in the order asked.
    std::vector<std::string> taken() const {
        const std::lock_guard<std::mutex> held(mutex_);
        return taken_;
    }

    int takenWithPositions() const {
        const std::lock_guard<std::mutex> held(mutex_);
        return takenWithPositions_;
    }

    // Each structure and ordinal set the library taker was asked for, in the order asked.
    std::vector<LibraryTake> libraryTaken() const {
        const std::lock_guard<std::mutex> held(mutex_);
        return libraryTaken_;
    }

    // From now on the library taker names its tracks with `prefix`, as a rebuilt library would
    // answer other tracks for the same ordinals.
    void answerLibraryWith(const std::string& prefix) {
        const std::lock_guard<std::mutex> held(mutex_);
        libraryPrefix_ = prefix;
    }

    // From now on the library taker answers structureMoved, as it does once the library rebuilt
    // between the route's check and the resolve.
    void moveTheLibrary() {
        const std::lock_guard<std::mutex> held(mutex_);
        libraryMoved_ = true;
    }

    // The length the track reader answers for the track named `name` from now on, as foobar2000
    // reads one from the track's metadata. Every other track it answers 0 for.
    void lasts(const std::string& name, double seconds) {
        const std::lock_guard<std::mutex> held(mutex_);
        lengths_[name] = seconds;
    }

    // From now on the track reader cannot read the names of the track named `name`. Where `outcome`
    // is done it answers as the reader does for a file whose info foobar2000 has not loaded: no
    // names, and "?" for each column. Any other outcome it answers alone.
    void cannotName(const std::string& name, PlayerOutcome outcome) {
        const std::lock_guard<std::mutex> held(mutex_);
        unnamed_[name] = outcome;
    }

    void canName(const std::string& name) {
        const std::lock_guard<std::mutex> held(mutex_);
        unnamed_.erase(name);
    }

    // The name of each track the track reader was asked about, in the order asked.
    std::vector<std::string> trackReads() const {
        const std::lock_guard<std::mutex> held(mutex_);
        return trackReads_;
    }

    int queueReads() const {
        const std::lock_guard<std::mutex> held(mutex_);
        return queueReads_;
    }

    // Each column list the track reader was handed, in the order asked.
    std::vector<std::vector<std::string>> trackColumns() const {
        const std::lock_guard<std::mutex> held(mutex_);
        return trackColumns_;
    }

    // The name of each track the cover reader was asked about, in the order asked.
    std::vector<std::string> artworkReads() const {
        const std::lock_guard<std::mutex> held(mutex_);
        return artworkReads_;
    }

    // How often the fake foobar2000 was asked `call`, the engine's queue calls among them.
    int engineCalls(Call call) const { return foobar_.count(call); }

    std::vector<QueuedTrack> engineQueue() const { return foobar_.queued(); }

    // foobar2000's own queue from now on, arranged rather than asked for, so it counts no call.
    void queueAtTheEngine(std::vector<QueuedTrack> entries) { foobar_.queue(std::move(entries)); }

    // The session `start` was handed for `id`. Creating a session starts its stream, so every
    // session a case created is here.
    std::shared_ptr<Session> session(const std::string& id) const {
        const std::lock_guard<std::mutex> held(mutex_);
        const auto found = started_.find(id);
        auto session = found == started_.end() ? nullptr : found->second.lock();
        INFO("the session stream was never started for session ", id);
        REQUIRE(session != nullptr);
        return session;
    }

private:
    PlayerOutcome counted() {
        const std::lock_guard<std::mutex> held(mutex_);
        ++playbackCalls_;
        return PlayerOutcome::done;
    }

    FakePlayer foobar_;

    mutable std::mutex mutex_;
    int playbackCalls_ = 0;
    EngineCommands engine_;
    std::map<std::string, std::weak_ptr<Session>> started_;
    std::map<std::string, std::vector<SessionTrack>> held_;
    std::vector<std::string> taken_;
    int takenWithPositions_ = 0;
    std::vector<LibraryTake> libraryTaken_;
    std::string libraryPrefix_ = "Library";
    bool libraryMoved_ = false;
    std::vector<std::string> trackReads_;
    std::map<std::string, double> lengths_;
    std::map<std::string, PlayerOutcome> unnamed_;
    std::vector<std::vector<std::string>> trackColumns_;
    std::vector<std::string> artworkReads_;
    int queueReads_ = 0;
};

// Answers nothing once, as a mint that failed to draw does, and then the first scripted id.
TicketMint failingOnceMint() {
    const auto issued = std::make_shared<size_t>(0);
    return [issued] { return (*issued)++ == 0 ? std::string() : mintedIds()[0]; };
}

TestServer serving(const Player& player, PlayerStateStore* store = nullptr,
                   const TicketMint& mint = scriptedMint(), Settings settings = servingSettings()) {
    return TestServer(std::move(settings), player, nullptr, mint, store);
}

std::string naming(const std::string& path, const std::string& deviceId) {
    return deviceId.empty() ? path : path + "?deviceId=" + deviceId;
}

std::string sessionPath(const std::string& id) {
    return "/api/sessions/" + id;
}

httplib::Result create(const TestServer& server, const json& identity) {
    return post(server, "/api/sessions", identity.dump());
}

json created(const TestServer& server, const std::string& deviceId,
             const std::string& name = "Kitchen phone") {
    const auto response = create(server, json{{"deviceId", deviceId}, {"name", name}});
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

std::string createdId(const TestServer& server, const std::string& deviceId) {
    return created(server, deviceId)["id"].get<std::string>();
}

json sessionsSeenBy(const TestServer& server, const std::string& deviceId) {
    const auto response = get(server, naming("/api/sessions", deviceId));
    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto body = json::parse(response->body);
    REQUIRE(body.contains("sessions"));
    REQUIRE(body["sessions"].is_array());
    return body["sessions"];
}

std::vector<std::string> idsSeenBy(const TestServer& server, const std::string& deviceId) {
    const auto sessions = sessionsSeenBy(server, deviceId);

    std::vector<std::string> ids;
    std::transform(sessions.begin(), sessions.end(), std::back_inserter(ids),
                   [](const json& session) { return session["id"].get<std::string>(); });
    return ids;
}

httplib::Result read(const TestServer& server, const std::string& id, const std::string& deviceId) {
    return get(server, naming(sessionPath(id), deviceId));
}

httplib::Result share(const TestServer& server, const std::string& id, const std::string& deviceId,
                      const json& body) {
    return post(server, naming(sessionPath(id), deviceId), body.dump());
}

json shared(const TestServer& server, const std::string& id, const std::string& deviceId,
            bool shared) {
    const auto response = share(server, id, deviceId, json{{"shared", shared}});
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

const Keys& documentKeys() {
    static const Keys keys{"id",          "kind",      "shared",        "playback",
                           "title",       "artist",    "album",         "albumArtist",
                           "libraryPath", "listeners", "playbackModes", "chainDropped",
                           "reports",     "createdBy"};
    return keys;
}

std::vector<std::string> engineOnly() {
    return {kEngineSessionId};
}

}  // namespace

TEST_CASE("creating a session answers a private, stopped and empty detached session") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto response = create(server, json{{"deviceId", kPhone}, {"name", "Kitchen phone"}});

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto session = json::parse(response->body);
    CHECK(keysOf(session) == documentKeys());
    CHECK(session["id"] == mintedIds()[0]);
    CHECK(session["kind"] == "detached");
    CHECK(session["shared"] == false);
    CHECK(session["playback"] == "stopped");
    CHECK(session["title"].is_null());
    CHECK(session["artist"].is_null());
    CHECK(session["album"].is_null());
    CHECK(session["albumArtist"].is_null());
    CHECK(session["libraryPath"].is_null());
    CHECK(session["listeners"] == 0);
    CHECK(session["chainDropped"] == false);
    CHECK(session["reports"] == json::array());
    CHECK(session["createdBy"] == json{{"deviceId", kPhone}, {"name", "Kitchen phone"}});

    CHECK(recorder.calls() == 0);
}

TEST_CASE("a detached session offers exactly the five orders it can play, in their sequence") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto session = created(server, kPhone);

    const auto expected =
        json::array({"inOrder", "repeatAll", "repeatOne", "random", "shuffleTracks"});
    CHECK(session["playbackModes"] == expected);
    CHECK(sessionsSeenBy(server, kPhone)[1]["playbackModes"] == expected);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a creator that named nothing is answered a null name, whether it sent none or ''") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto unnamed = create(server, json{{"deviceId", kPhone}});
    const auto blank = create(server, json{{"deviceId", kLaptop}, {"name", ""}});

    REQUIRE(unnamed);
    REQUIRE(unnamed->status == 200);
    CHECK(json::parse(unnamed->body)["createdBy"] == json{{"deviceId", kPhone}, {"name", nullptr}});

    REQUIRE(blank);
    REQUIRE(blank->status == 200);
    CHECK(json::parse(blank->body)["createdBy"] == json{{"deviceId", kLaptop}, {"name", nullptr}});

    CHECK(recorder.calls() == 0);
}

TEST_CASE("each session's id is the next one the ticket mint gives") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    CHECK(createdId(server, kPhone) == mintedIds()[0]);
    CHECK(createdId(server, kPhone) == mintedIds()[1]);
    CHECK(recorder.calls() == 0);
}

// The query is not where POST /api/sessions reads its device, so a deviceId there does not
// rescue a body without one.
TEST_CASE("a create without a deviceId in its body is refused and leaves no session behind") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const std::vector<std::string> bodies{R"({})", R"({"name": "Kitchen phone"})",
                                          R"({"deviceId": "", "name": "Kitchen phone"})"};

    for (const auto& body : bodies) {
        CAPTURE(body);
        const auto response = post(server, "/api/sessions", body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == "'deviceId' is required");
    }

    const auto fromTheQuery = post(server, naming("/api/sessions", kPhone), "{}");
    REQUIRE(fromTheQuery);
    CHECK(fromTheQuery->status == 400);
    CHECK(errorOf(*fromTheQuery) == "'deviceId' is required");

    CHECK(idsSeenBy(server, "") == engineOnly());
    CHECK(idsSeenBy(server, kPhone) == engineOnly());
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a create whose body is not JSON is refused and leaves no session behind") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto plainText = server.client().Post("/api/sessions", "deviceId=phone", "text/plain");
    REQUIRE(plainText);
    CHECK(plainText->status == 415);
    CHECK(errorOf(*plainText) == kSendJson);

    const auto malformed = post(server, "/api/sessions", R"({"deviceId": )");
    REQUIRE(malformed);
    CHECK(malformed->status == 400);

    CHECK(idsSeenBy(server, "") == engineOnly());
    CHECK(recorder.calls() == 0);
}

TEST_CASE("the creator's list is the engine session and then the creator's own session") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto session = created(server, kPhone);

    const auto sessions = sessionsSeenBy(server, kPhone);
    REQUIRE(sessions.size() == 2);
    CHECK(sessions[0]["id"] == kEngineSessionId);
    CHECK(keysOf(sessions[0]) == documentKeys());
    CHECK(sessions[1] == session);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a private session is listed for no other device and for a request naming none") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    createdId(server, kPhone);

    CHECK(idsSeenBy(server, kLaptop) == engineOnly());
    CHECK(idsSeenBy(server, "") == engineOnly());
    CHECK(recorder.calls() == 0);
}

TEST_CASE("detached sessions follow the engine session in the order they were created") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto first = createdId(server, kPhone);
    const auto laptops = createdId(server, kLaptop);
    const auto third = createdId(server, kPhone);

    CHECK(idsSeenBy(server, kPhone) == std::vector<std::string>{kEngineSessionId, first, third});
    CHECK(idsSeenBy(server, kLaptop) == std::vector<std::string>{kEngineSessionId, laptops});
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a session reads for its creator and is 404 for anybody else") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto session = created(server, kPhone);
    const auto id = session["id"].get<std::string>();

    const auto mine = read(server, id, kPhone);
    REQUIRE(mine);
    CHECK(mine->status == 200);
    CHECK(json::parse(mine->body) == session);

    const auto stranger = read(server, id, kLaptop);
    REQUIRE(stranger);
    CHECK(stranger->status == 404);
    CHECK(errorOf(*stranger) == kNoSuchSession);

    const auto nobody = read(server, id, "");
    REQUIRE(nobody);
    CHECK(nobody->status == 404);
    CHECK(errorOf(*nobody) == kNoSuchSession);

    CHECK(recorder.calls() == 0);
}

// A 404 that differs for a private session from one for an id nobody issued would tell a
// stranger which ids are live.
TEST_CASE("a private session read by a stranger answers what an id nobody issued answers") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto id = createdId(server, kPhone);

    const auto stranger = read(server, id, kLaptop);
    const auto unissued = read(server, "Zz00q", kLaptop);
    const auto unissuedForTheCreator = read(server, "Zz00q", kPhone);

    REQUIRE(stranger);
    REQUIRE(unissued);
    REQUIRE(unissuedForTheCreator);
    CHECK(stranger->status == 404);
    CHECK(unissued->status == 404);
    CHECK(unissuedForTheCreator->status == 404);
    CHECK(errorOf(*unissued) == kNoSuchSession);
    CHECK(stranger->body == unissued->body);
    CHECK(unissuedForTheCreator->body == unissued->body);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("the engine session's document is the player's own state, the same for every device") {
    Recorder recorder;
    PlayerStateStore store;
    PlayerState playing;
    playing.playback = PlaybackState::paused;
    playing.path = R"(X:\music\Fictional Artist\Imaginary Album\03 Track.flac)";
    playing.libraryPath = "Fictional Artist/Imaginary Album/03 Track.flac";
    playing.title = "Third Track";
    playing.artist = "Fictional Artist";
    playing.album = "Imaginary Album";
    playing.albumArtist = "Various Fictional Artists";
    playing.playbackMode = "random";
    store.publish(playing);
    const TestServer server = serving(recorder.player(), &store);

    const auto forPhone = read(server, kEngineSessionId, kPhone);
    const auto forNobody = read(server, kEngineSessionId, "");
    REQUIRE(forPhone);
    REQUIRE(forNobody);
    REQUIRE(forPhone->status == 200);
    CHECK(forNobody->status == 200);
    CHECK(forNobody->body == forPhone->body);

    const auto engine = json::parse(forPhone->body);
    CHECK(keysOf(engine) == documentKeys());
    CHECK(engine["id"] == kEngineSessionId);
    CHECK(engine["kind"] == "engine");
    CHECK(engine["shared"] == true);
    CHECK(engine["createdBy"].is_null());
    CHECK(engine["chainDropped"] == false);
    CHECK(engine["reports"] == json::array());
    CHECK(engine["listeners"] == 0);

    CHECK(engine["playback"] == "paused");
    CHECK(engine["title"] == "Third Track");
    CHECK(engine["artist"] == "Fictional Artist");
    CHECK(engine["album"] == "Imaginary Album");
    CHECK(engine["albumArtist"] == "Various Fictional Artists");
    CHECK(engine["libraryPath"] == "Fictional Artist/Imaginary Album/03 Track.flac");

    const auto state = get(server, "/api/state");
    REQUIRE(state);
    REQUIRE(state->status == 200);
    const auto player = json::parse(state->body)["player"];
    for (const char* key : {"playback", "title", "artist", "album", "albumArtist", "libraryPath"}) {
        CAPTURE(key);
        CHECK(engine[key] == player[key]);
    }

    CHECK(sessionsSeenBy(server, kPhone)[0] == engine);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("the engine session offers the orders GET /api/capabilities publishes for the player") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto response = read(server, kEngineSessionId, kPhone);
    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto modes = json::parse(response->body)["playbackModes"];
    CHECK(modes == capabilitiesOf(server)["playbackModes"]);
    CHECK(modes == json::array({"shuffleAlbums", "inOrder", "random", "repeatOne"}));
    CHECK(recorder.calls() == 0);
}

TEST_CASE("the engine session counts each device listening to it once, however many connections") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto now = Audience::Clock::now();
    const auto phone = server.audience().join({kPhone, "Kitchen phone"}, "opus", now);
    const auto phoneAgain = server.audience().join({kPhone, "Kitchen phone"}, "opus", now);
    const auto laptop = server.audience().join({kLaptop, "Desk"}, "opus", now);
    REQUIRE(phone);
    REQUIRE(phoneAgain);
    REQUIRE(laptop);
    REQUIRE(server.audience().connections() == 3);

    const auto response = read(server, kEngineSessionId, kTablet);
    REQUIRE(response);
    REQUIRE(response->status == 200);
    CHECK(json::parse(response->body)["listeners"] == 2);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("with no session stream on the player, a create is 503 and the engine is still listed") {
    Recorder recorder;
    const TestServer server = serving(recorder.player(false));

    const auto response = create(server, json{{"deviceId", kPhone}, {"name", "Kitchen phone"}});
    REQUIRE(response);
    CHECK(response->status == 503);
    CHECK(errorOf(*response) == "sessions are not available");

    CHECK(idsSeenBy(server, kPhone) == engineOnly());
    CHECK(statusOf(read(server, kEngineSessionId, kPhone)) == 200);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("sharing a session lists it for every device and for none, and unsharing unlists it") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto id = createdId(server, kPhone);

    const auto sharing = shared(server, id, kPhone, true);
    CHECK(keysOf(sharing) == documentKeys());
    CHECK(sharing["id"] == id);
    CHECK(sharing["shared"] == true);
    CHECK(sharing["createdBy"] == json{{"deviceId", kPhone}, {"name", "Kitchen phone"}});

    const std::vector<std::string> engineAndShared{kEngineSessionId, id};
    CHECK(idsSeenBy(server, kLaptop) == engineAndShared);
    CHECK(idsSeenBy(server, "") == engineAndShared);
    CHECK(statusOf(read(server, id, kLaptop)) == 200);

    const auto unsharing = shared(server, id, kPhone, false);
    CHECK(keysOf(unsharing) == documentKeys());
    CHECK(unsharing["shared"] == false);

    CHECK(idsSeenBy(server, kLaptop) == engineOnly());
    CHECK(idsSeenBy(server, "") == engineOnly());
    CHECK(statusOf(read(server, id, kLaptop)) == 404);
    CHECK(idsSeenBy(server, kPhone) == engineAndShared);
    CHECK(recorder.calls() == 0);
}

// Reading and listing do not make a device a member.
TEST_CASE("a device that only listed and read a shared session loses it when it is unshared") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto id = createdId(server, kPhone);
    shared(server, id, kPhone, true);

    REQUIRE(idsSeenBy(server, kLaptop) == std::vector<std::string>{kEngineSessionId, id});
    REQUIRE(statusOf(read(server, id, kLaptop)) == 200);

    shared(server, id, kPhone, false);

    CHECK(idsSeenBy(server, kLaptop) == engineOnly());
    CHECK(statusOf(read(server, id, kLaptop)) == 404);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a device that shares a shared session stays a member after the creator unshares it") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto id = createdId(server, kPhone);
    shared(server, id, kPhone, true);
    CHECK(shared(server, id, kLaptop, true)["shared"] == true);

    shared(server, id, kPhone, false);

    CHECK(idsSeenBy(server, kLaptop) == std::vector<std::string>{kEngineSessionId, id});
    CHECK(statusOf(read(server, id, kLaptop)) == 200);
    CHECK(statusOf(read(server, id, kTablet)) == 404);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a second member may share the session again and stop sharing it") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto id = createdId(server, kPhone);
    shared(server, id, kPhone, true);
    shared(server, id, kLaptop, true);
    shared(server, id, kPhone, false);

    CHECK(shared(server, id, kLaptop, true)["shared"] == true);
    CHECK(idsSeenBy(server, kTablet) == std::vector<std::string>{kEngineSessionId, id});

    CHECK(shared(server, id, kLaptop, false)["shared"] == false);
    CHECK(idsSeenBy(server, kTablet) == engineOnly());
    CHECK(statusOf(read(server, id, kPhone)) == 200);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a device that has only seen a shared session may unshare it and is a member after") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto id = createdId(server, kPhone);
    shared(server, id, kPhone, true);

    const auto unsharing = shared(server, id, kLaptop, false);
    CHECK(unsharing["shared"] == false);

    CHECK(statusOf(read(server, id, kLaptop)) == 200);
    CHECK(idsSeenBy(server, kLaptop) == std::vector<std::string>{kEngineSessionId, id});
    CHECK(statusOf(read(server, id, kPhone)) == 200);
    CHECK(statusOf(read(server, id, kTablet)) == 404);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a stranger's share of a private session is 404 and changes nothing") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto id = createdId(server, kPhone);
    const auto unissued = share(server, "Zz00q", kLaptop, json{{"shared", true}});
    REQUIRE(unissued);
    CHECK(unissued->status == 404);
    CHECK(errorOf(*unissued) == kNoSuchSession);

    for (const bool asked : {true, false}) {
        CAPTURE(asked);
        const auto response = share(server, id, kLaptop, json{{"shared", asked}});
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(response->body == unissued->body);
    }

    CHECK(idsSeenBy(server, kLaptop) == engineOnly());
    CHECK(idsSeenBy(server, kTablet) == engineOnly());
    CHECK(statusOf(read(server, id, kLaptop)) == 404);

    const auto mine = read(server, id, kPhone);
    REQUIRE(mine);
    REQUIRE(mine->status == 200);
    CHECK(json::parse(mine->body)["shared"] == false);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("the engine session is 409 to a share and to an unshare, and stays shared") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    for (const bool asked : {true, false}) {
        for (const char* device : {kPhone, ""}) {
            CAPTURE(asked);
            CAPTURE(device);
            const auto response = share(server, kEngineSessionId, device, json{{"shared", asked}});
            REQUIRE(response);
            CHECK(response->status == 409);
            CHECK(errorOf(*response) == "the engine session cannot be changed");
        }
    }

    const auto engine = read(server, kEngineSessionId, kPhone);
    REQUIRE(engine);
    REQUIRE(engine->status == 200);
    CHECK(json::parse(engine->body)["shared"] == true);
    CHECK(recorder.calls() == 0);
}

// A device that could see the session and sent a bad body was refused, so it did not join: once
// the session is private again it is a stranger.
TEST_CASE("a share without a boolean 'shared' is refused and changes nothing") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto id = createdId(server, kPhone);

    const std::vector<std::string> bodies{R"({})", R"({"shared": "true"})", R"({"shared": 1})",
                                          R"({"shared": null})", R"({"share": true})"};

    for (const auto& body : bodies) {
        CAPTURE(body);
        const auto response = post(server, naming(sessionPath(id), kPhone), body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == "'shared' must be true or false");
    }
    CHECK(idsSeenBy(server, kLaptop) == engineOnly());

    shared(server, id, kPhone, true);

    for (const auto& body : bodies) {
        CAPTURE(body);
        const auto response = post(server, naming(sessionPath(id), kLaptop), body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == "'shared' must be true or false");
    }
    CHECK(idsSeenBy(server, kTablet) == std::vector<std::string>{kEngineSessionId, id});

    shared(server, id, kPhone, false);
    CHECK(statusOf(read(server, id, kLaptop)) == 404);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a create the mint gives no id for is 503 and leaves no session behind") {
    Recorder recorder;
    const TestServer server = serving(recorder.player(), nullptr, failingOnceMint());

    const auto refused = create(server, json{{"deviceId", kPhone}, {"name", "Kitchen phone"}});
    REQUIRE(refused);
    CHECK(refused->status == 503);
    CHECK(errorOf(*refused) == "sessions are not available");
    CHECK(idsSeenBy(server, kPhone) == engineOnly());

    CHECK(createdId(server, kPhone) == mintedIds()[0]);
    CHECK(recorder.calls() == 0);
}

// A request naming no device is from no member, and only a member may share or unshare.
TEST_CASE("a share naming no device is refused and leaves the session shared") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto id = createdId(server, kPhone);
    shared(server, id, kPhone, true);

    for (const auto& path : {sessionPath(id), sessionPath(id) + "?deviceId="}) {
        CAPTURE(path);
        const auto response = post(server, path, json{{"shared", false}}.dump());
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == "'deviceId' is required");
    }

    CHECK(idsSeenBy(server, kLaptop) == std::vector<std::string>{kEngineSessionId, id});
    CHECK(recorder.calls() == 0);
}

// The engine is refused before anything else is read, and a session a device may not see is
// refused before its body is: a 400 there would tell a stranger the id is live.
TEST_CASE("a bad share body is answered 409 for the engine and 404 for a stranger's session") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());

    const auto id = createdId(server, kPhone);
    const auto bad = json{{"shared", "yes"}}.dump();

    const auto engine = post(server, naming(sessionPath(kEngineSessionId), kPhone), bad);
    REQUIRE(engine);
    CHECK(engine->status == 409);
    CHECK(errorOf(*engine) == "the engine session cannot be changed");

    const auto stranger = post(server, naming(sessionPath(id), kLaptop), bad);
    REQUIRE(stranger);
    CHECK(stranger->status == 404);
    CHECK(errorOf(*stranger) == kNoSuchSession);
    CHECK(recorder.calls() == 0);
}

namespace {

constexpr char kPlayPause[] = "/api/playback/play-pause";
constexpr char kNext[] = "/api/playback/next";
constexpr char kPrevious[] = "/api/playback/previous";
constexpr char kStop[] = "/api/playback/stop";
constexpr char kSeek[] = "/api/playback/seek";
constexpr char kMode[] = "/api/playback/mode";

// A playlist neither the fake foobar2000 nor the taker holds.
constexpr char kNoSuchPlaylistId[] = "0d6c7e1a-52b9-4f0e-9a43-7b2f1c8e5d90";

// A long enough snapshot that its middle has a row on either side.
constexpr size_t kRows = 5;

std::string rowPlayPath(const std::string& playlistId, size_t index) {
    return "/api/playlists/" + playlistId + "/items/" + std::to_string(index) + "/play";
}

struct Route {
    std::string path;
    std::string body;
};

// One well-formed request to each of the seven, each of which changes a session it reaches.
std::vector<Route> sevenRoutes() {
    return {{kPlayPause, ""},
            {kNext, ""},
            {kPrevious, ""},
            {kStop, ""},
            {kSeek, R"({"seconds": 30})"},
            {kMode, R"({"mode": "repeatOne"})"},
            {rowPlayPath(kPlaylistId, 1), ""}};
}

httplib::Result command(const TestServer& server, const Route& route, const std::string& session,
                        const std::string& deviceId) {
    return post(server, scoped(route.path, session, deviceId), route.body);
}

json documentOf(const TestServer& server, const std::string& id, const std::string& deviceId) {
    const auto response = read(server, id, deviceId);
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

// A 204 with no body, as the engine's transport answers.
void checkDone(const httplib::Result& response) {
    REQUIRE(response);
    CHECK(response->status == 204);
    CHECK(response->body.empty());
}

// What an id nobody issued answers, which a refusal for a private session must not differ from.
httplib::Result unknownSessionAnswer(const TestServer& server) {
    return read(server, "Zz00q", kTablet);
}

// A session created by `deviceId`, playing row `index` of a five-row snapshot of kPlaylistId.
std::string playingSession(const TestServer& server, Recorder& recorder,
                           const std::string& deviceId, const std::vector<SessionTrack>& rows,
                           size_t index) {
    const auto id = createdId(server, deviceId);
    recorder.hold(kPlaylistId, rows);
    checkDone(post(server, scoped(rowPlayPath(kPlaylistId, index), id, deviceId), ""));
    return id;
}

// Read at the instant the server's clock starts from, which no mark is taken before, so the
// position is the one last marked, listener or none.
PlayerState stateOf(const Recorder& recorder, const std::string& id) {
    return recorder.session(id)->state(Session::Clock::time_point{});
}

// A connection listening to the session `id`, as a stream holds one, for as long as the case holds
// what this returns. It reads the session's own audience clock, which is the real one here, ahead
// of the server's: the position it marks stays where it was.
std::shared_ptr<Audience::Membership> listening(const Recorder& recorder, const std::string& id,
                                                const std::string& deviceId) {
    const auto session = recorder.session(id);
    auto ears = session->listen(DeviceIdentity{deviceId, {}}, "opus", session->audience().now());
    REQUIRE(ears);
    return ears;
}

}  // namespace

TEST_CASE("a row play naming a session plays that row of the playlist the taker answered") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto other = createdId(server, kPhone);
    const auto id = createdId(server, kPhone);
    const auto ears = listening(recorder, id, kPhone);
    recorder.hold(kPlaylistId, rows);

    checkDone(post(server, scoped(rowPlayPath(kPlaylistId, 2), id, kPhone), ""));

    CHECK(recorder.taken() == std::vector<std::string>{kPlaylistId});
    CHECK(recorder.takenWithPositions() == 0);

    const auto session = documentOf(server, id, kPhone);
    CHECK(session["playback"] == "playing");
    CHECK(session["libraryPath"] == libraryPathOf(rows[2]));

    const auto untouched = documentOf(server, other, kPhone);
    CHECK(untouched["playback"] == "stopped");
    CHECK(untouched["libraryPath"].is_null());

    CHECK(recorder.rowPlays() == 0);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a row play naming a session answers as the engine's does for a playlist nobody holds") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = createdId(server, kPhone);

    const auto engine = post(server, rowPlayPath(kNoSuchPlaylistId, 0), "");
    const int enginePlays = recorder.rowPlays();
    const auto session = post(server, scoped(rowPlayPath(kNoSuchPlaylistId, 0), id, kPhone), "");

    REQUIRE(engine);
    CHECK(engine->status != 204);
    checkSameAnswer(session, engine);
    CHECK(recorder.taken() == std::vector<std::string>{kNoSuchPlaylistId});
    CHECK(recorder.rowPlays() == enginePlays);
    CHECK(documentOf(server, id, kPhone)["playback"] == "stopped");
}

TEST_CASE("a row play naming a session past the rows taken answers as the engine's does") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = createdId(server, kPhone);
    recorder.hold(kPlaylistId, tracks("Road", 3));

    const auto engine = post(server, rowPlayPath(kPlaylistId, 3), "");
    const int enginePlays = recorder.rowPlays();
    const auto session = post(server, scoped(rowPlayPath(kPlaylistId, 3), id, kPhone), "");

    REQUIRE(engine);
    CHECK(engine->status != 204);
    checkSameAnswer(session, engine);
    CHECK(recorder.rowPlays() == enginePlays);
    CHECK(documentOf(server, id, kPhone)["playback"] == "stopped");
}

TEST_CASE("a session plays on through the rows it took after the playlist changes") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 1);

    recorder.hold(kPlaylistId, tracks("Edited", kRows));
    checkDone(post(server, scoped(kNext, id, kPhone), ""));

    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOf(rows[2]));
    CHECK(recorder.taken().size() == 1);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("play-pause and stop move the session named and no other") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto other = playingSession(server, recorder, kPhone, rows, 0);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    const auto othersEars = listening(recorder, other, kPhone);
    const auto ears = listening(recorder, id, kPhone);

    checkDone(post(server, scoped(kPlayPause, id, kPhone), ""));
    CHECK(documentOf(server, id, kPhone)["playback"] == "paused");
    CHECK(documentOf(server, other, kPhone)["playback"] == "playing");

    checkDone(post(server, scoped(kPlayPause, id, kPhone), ""));
    CHECK(documentOf(server, id, kPhone)["playback"] == "playing");

    checkDone(post(server, scoped(kStop, id, kPhone), ""));
    CHECK(documentOf(server, id, kPhone)["playback"] == "stopped");

    const auto untouched = documentOf(server, other, kPhone);
    CHECK(untouched["playback"] == "playing");
    CHECK(untouched["libraryPath"] == libraryPathOf(rows[0]));
    CHECK(recorder.calls() == 0);
}

TEST_CASE("in the middle of a snapshot, next plays the following row and previous the one before") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto other = playingSession(server, recorder, kPhone, rows, 0);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    const auto ears = listening(recorder, id, kPhone);

    checkDone(post(server, scoped(kPrevious, id, kPhone), ""));
    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOf(rows[1]));

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOf(rows[2]));

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    const auto moved = documentOf(server, id, kPhone);
    CHECK(moved["libraryPath"] == libraryPathOf(rows[3]));
    CHECK(moved["playback"] == "playing");

    CHECK(documentOf(server, other, kPhone)["libraryPath"] == libraryPathOf(rows[0]));
    CHECK(recorder.calls() == 0);
}

// No route queues into a session yet, so the track is queued on the session itself.
TEST_CASE("next plays a track queued in the session before the snapshot resumes") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    const auto queued = track("Queued");
    REQUIRE(recorder.session(id)->enqueue({queued}) == PlayerOutcome::done);

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOf(queued));

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOf(rows[3]));
    CHECK(recorder.calls() == 0);
}

// No route publishes a session's position yet, so it is read off the session.
TEST_CASE("a seek naming a session moves its position, absolutely or relatively, and no other's") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto other = playingSession(server, recorder, kPhone, rows, 0);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);

    checkDone(post(server, scoped(kSeek, id, kPhone), R"({"seconds": 42})"));
    CHECK(stateOf(recorder, id).position.seconds == doctest::Approx(42));

    checkDone(post(server, scoped(kSeek, id, kPhone), R"({"relativeSeconds": -10})"));
    CHECK(stateOf(recorder, id).position.seconds == doctest::Approx(32));

    CHECK(stateOf(recorder, other).position.seconds == doctest::Approx(0));
    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOf(rows[2]));
    CHECK(recorder.engine().seeks.empty());
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a malformed seek naming a session is refused as the engine's seek refuses it") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);
    checkDone(post(server, scoped(kSeek, id, kPhone), R"({"seconds": 42})"));

    for (const char* body : {R"({"seconds": -1})", R"({})", R"({"seconds": "30"})", "{"}) {
        CAPTURE(body);
        const auto engine = post(server, kSeek, body);
        REQUIRE(engine);
        CHECK(engine->status == 400);
        checkSameAnswer(post(server, scoped(kSeek, id, kPhone), body), engine);
    }

    CHECK(stateOf(recorder, id).position.seconds == doctest::Approx(42));
    CHECK(recorder.calls() == 0);
}

// No route publishes a session's order until GET /api/state names one, so it is read off the
// session as that poll will publish it.
TEST_CASE("each of the five orders a session offers sets the named session's order alone") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto other = playingSession(server, recorder, kPhone, rows, 0);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    const auto offered = documentOf(server, id, kPhone)["playbackModes"];

    for (const char* mode : {"repeatAll", "repeatOne", "shuffleTracks", "random", "inOrder"}) {
        CAPTURE(mode);
        checkDone(post(server, scoped(kMode, id, kPhone), json{{"mode", mode}}.dump()));
        CHECK(stateOf(recorder, id).playbackMode == mode);
        CHECK(stateOf(recorder, other).playbackMode == "inOrder");
    }

    CHECK(documentOf(server, id, kPhone)["playbackModes"] == offered);
    CHECK(recorder.engine().orders.empty());
    CHECK(recorder.calls() == 0);
}

TEST_CASE(
    "shuffleAlbums and shuffleFolders are 409 for a session, as for an install without them") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);
    checkDone(post(server, scoped(kMode, id, kPhone), R"({"mode": "repeatAll"})"));

    for (const char* mode : {"shuffleAlbums", "shuffleFolders"}) {
        CAPTURE(mode);
        const auto response = post(server, scoped(kMode, id, kPhone), json{{"mode", mode}}.dump());
        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(errorOf(*response) == kModeNotOffered);
    }

    CHECK(stateOf(recorder, id).playbackMode == "repeatAll");
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a mode naming a session that no session knows is refused as the engine refuses it") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);

    for (const char* body : {R"({"mode": "shuffle"})", R"({"mode": 3})", R"({"mode": "Random"})"}) {
        CAPTURE(body);
        const auto engine = post(server, kMode, body);
        REQUIRE(engine);
        CHECK(engine->status == 400);
        checkSameAnswer(post(server, scoped(kMode, id, kPhone), body), engine);
    }

    CHECK(stateOf(recorder, id).playbackMode == "inOrder");
    CHECK(recorder.calls() == 0);
}

// playback_route_test.cpp, unchanged, is the full proof; this is that naming the engine is the
// same request as naming nothing.
TEST_CASE("each route naming no session or the engine session reaches the engine as today") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    createdId(server, kPhone);

    for (const auto& route : sevenRoutes()) {
        CAPTURE(route.path);
        const auto before = recorder.calls();
        const auto unnamed = command(server, route, "", "");
        checkDone(unnamed);
        CHECK(recorder.calls() == before + 1);

        checkSameAnswer(command(server, route, kEngineSessionId, kPhone), unnamed);
        CHECK(recorder.calls() == before + 2);
    }

    const auto engine = recorder.engine();
    CHECK(engine.transports == std::vector<Transport>{Transport::playPause, Transport::playPause,
                                                      Transport::next, Transport::next,
                                                      Transport::previous, Transport::previous,
                                                      Transport::stop, Transport::stop});
    CHECK(engine.seeks == std::vector<std::pair<double, bool>>{{30, false}, {30, false}});
    // repeatOne is fourth in Recorder::installedOrders().
    CHECK(engine.orders == std::vector<size_t>{3, 3});
    CHECK(recorder.rowPlays() == 2);
    CHECK(recorder.taken().empty());
}

TEST_CASE("an unknown session on each route is 404 in the words of an id nobody issued") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    recorder.hold(kPlaylistId, tracks("Road", kRows));
    const auto unknown = unknownSessionAnswer(server);

    for (const auto& route : sevenRoutes()) {
        CAPTURE(route.path);
        const auto response = command(server, route, "Zz00q", kPhone);
        checkSameAnswer(response, unknown);
        CHECK(errorOf(*response) == kNoSuchSession);
    }

    CHECK(recorder.taken().empty());
    CHECK(recorder.calls() == 0);
}

TEST_CASE("with controlPlayback off, each route naming the engine or none is refused as today") {
    Recorder recorder;
    const TestServer server = serving(recorder.player(), nullptr, scriptedMint(),
                                      parseSettings(R"({"controlPlayback": false})"));

    for (const auto& route : sevenRoutes()) {
        CAPTURE(route.path);
        const auto unnamed = command(server, route, "", "");
        REQUIRE(unnamed);
        CHECK(unnamed->status == 403);
        CHECK(errorOf(*unnamed).find("controlPlayback") != std::string::npos);
        checkSameAnswer(command(server, route, kEngineSessionId, kPhone), unnamed);
    }

    CHECK(recorder.taken().empty());
    CHECK(recorder.calls() == 0);
}

TEST_CASE("with controlPlayback off, a detached session is created, shared and driven as usual") {
    Recorder recorder;
    const TestServer server = serving(recorder.player(), nullptr, scriptedMint(),
                                      parseSettings(R"({"controlPlayback": false})"));
    const auto rows = tracks("Road", kRows);

    const auto id = createdId(server, kPhone);
    CHECK(shared(server, id, kPhone, true)["shared"] == true);
    recorder.hold(kPlaylistId, rows);
    const auto ears = listening(recorder, id, kPhone);

    checkDone(post(server, scoped(rowPlayPath(kPlaylistId, 2), id, kPhone), ""));
    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOf(rows[2]));
    CHECK(documentOf(server, id, kPhone)["playback"] == "playing");

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOf(rows[3]));

    checkDone(post(server, scoped(kPrevious, id, kPhone), ""));
    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOf(rows[2]));

    checkDone(post(server, scoped(kSeek, id, kPhone), R"({"seconds": 42})"));
    CHECK(stateOf(recorder, id).position.seconds == doctest::Approx(42));

    checkDone(post(server, scoped(kMode, id, kPhone), R"({"mode": "repeatOne"})"));
    CHECK(stateOf(recorder, id).playbackMode == "repeatOne");

    checkDone(post(server, scoped(kPlayPause, id, kPhone), ""));
    CHECK(documentOf(server, id, kPhone)["playback"] == "paused");

    checkDone(post(server, scoped(kStop, id, kPhone), ""));
    CHECK(documentOf(server, id, kPhone)["playback"] == "stopped");

    CHECK(recorder.calls() == 0);
}

TEST_CASE("a private session is 404 on each route to a stranger and to no device, and untouched") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    const auto ears = listening(recorder, id, kPhone);
    const auto unknown = unknownSessionAnswer(server);

    for (const auto& route : sevenRoutes()) {
        for (const char* device : {kLaptop, ""}) {
            CAPTURE(route.path);
            CAPTURE(device);
            checkSameAnswer(command(server, route, id, device), unknown);
        }
    }

    const auto session = documentOf(server, id, kPhone);
    CHECK(session["playback"] == "playing");
    CHECK(session["libraryPath"] == libraryPathOf(rows[2]));
    const auto state = stateOf(recorder, id);
    CHECK(state.position.seconds == doctest::Approx(0));
    CHECK(state.playbackMode == "inOrder");
    CHECK(recorder.taken().size() == 1);
    CHECK(recorder.calls() == 0);
}

// A command passes through a session without making its device a member.
TEST_CASE("a stranger may drive a shared session, and is refused again once it is private") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    shared(server, id, kPhone, true);

    checkDone(post(server, scoped(kNext, id, kLaptop), ""));
    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOf(rows[3]));

    shared(server, id, kPhone, false);

    checkSameAnswer(post(server, scoped(kNext, id, kLaptop), ""), unknownSessionAnswer(server));
    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOf(rows[3]));
    CHECK(recorder.calls() == 0);
}

namespace {

constexpr char kState[] = "/api/state";

// Shaped as foobar2000 prints an output module's GUID and a device's, joined by a colon.
constexpr char kSpeakers[] =
    "{5A3E1C27-8B4D-4F0E-9C61-2D7B8E9F0A13}:{0E1D3C47-5A7B-4F21-9C3D-2B8E6F4A1D90}";

TestServer servingWith(const Player& player, Library* library, PlayerStateStore* store = nullptr,
                       Settings settings = servingSettings()) {
    return TestServer(std::move(settings), player, library, scriptedMint(), store);
}

// The engine paused part way into a track in a playlist, with every player-held field set to
// something a fresh session does not hold. The mark is never taken, so its age reads 0 on every
// poll and two polls of it answer the same bytes.
PlayerState engineState() {
    PlayerState state;
    state.playback = PlaybackState::paused;
    state.path = R"(X:\music\Fictional Artist\Engine Album\07 Engine Track.flac)";
    state.subsong = 2;
    state.libraryPath = "Fictional Artist/Engine Album/07 Engine Track.flac";
    state.position.seconds = 97;
    state.duration = 245;
    state.volume = -6;
    state.muted = true;
    state.playbackMode = "random";
    state.outputDeviceId = kSpeakers;
    state.outputSilent = false;
    state.title = "Engine Track";
    state.artist = "Engine Artist";
    state.album = "Engine Album";
    state.albumArtist = "Engine Album Artist";
    state.playingLocation = PlayingLocation{kPlaylistId, 1};
    state.currentPlaylistId = kPlaylistId;
    return state;
}

// The store moves a revision only when what it is handed differs, so each call hands it another.
void moveEveryEngineRevision(PlayerStateStore& store) {
    QueueEntry entry;
    entry.path = R"(X:\music\queued )" + std::to_string(store.read().queueRevision) + ".flac";
    store.queueChanged({entry});

    PlaylistMark mark;
    mark.id = kPlaylistId;
    mark.title = "Road trip " + std::to_string(store.read().playlistsRevision);
    store.playlistsChanged({mark});

    store.timelineMarked();
}

httplib::Result poll(const TestServer& server, const std::string& session,
                     const std::string& deviceId) {
    return get(server, scoped(kState, session, deviceId));
}

httplib::Result pollHolding(const TestServer& server, const std::string& session,
                            const std::string& deviceId, const std::string& tag) {
    return server.client().Get(scoped(kState, session, deviceId),
                               httplib::Headers{{"If-None-Match", tag}});
}

json polled(const TestServer& server, const std::string& session, const std::string& deviceId) {
    const auto response = poll(server, session, deviceId);
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

json playerPolled(const TestServer& server, const std::string& session,
                  const std::string& deviceId) {
    return polled(server, session, deviceId)["player"];
}

void checkUnchanged(const httplib::Result& response, const std::string& tag) {
    REQUIRE(response);
    CHECK(response->status == 304);
    CHECK(response->body.empty());
    CHECK(response->get_header_value("ETag") == tag);
}

void checkMoved(const httplib::Result& response, const std::string& tag) {
    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK_FALSE(response->body.empty());
    CHECK(response->get_header_value("ETag") != tag);
}

}  // namespace

// state_route_test.cpp is the full proof of the engine's poll; this is that naming the engine is
// the same request as naming nothing, down to the tag.
TEST_CASE("a poll naming the engine session answers the poll naming none, its sessionRevision 0") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    PlayerStateStore store;
    store.publish(engineState());
    moveEveryEngineRevision(store);
    const TestServer server = servingWith(recorder.player(), &library, &store);
    const auto id = createdId(server, kPhone);
    shared(server, id, kPhone, true);

    const auto unnamed = poll(server, "", "");
    const auto named = poll(server, kEngineSessionId, kPhone);

    checkSameAnswer(named, unnamed);
    REQUIRE(unnamed->status == 200);
    CHECK(named->get_header_value("ETag") == unnamed->get_header_value("ETag"));

    const auto player = json::parse(unnamed->body)["player"];
    REQUIRE(player.contains("sessionRevision"));
    CHECK(player["sessionRevision"] == 0);
    CHECK(player["title"] == "Engine Track");
    CHECK(player["timelineRevision"] == store.read().timelineRevision);

    PlayerState moved = engineState();
    moved.playback = PlaybackState::stopped;
    store.publish(moved);
    moveEveryEngineRevision(store);
    shared(server, id, kPhone, false);

    CHECK(playerPolled(server, "", "")["sessionRevision"] == 0);
    CHECK(playerPolled(server, kEngineSessionId, kPhone)["sessionRevision"] == 0);
    CHECK(recorder.calls() == 0);
}

// Two sessions and the engine, each in a state the other two are not in, so a field read from the
// wrong one of the three shows. The server's clock stands still, so a session's position is read
// as the seek left it.
TEST_CASE(
    "each session's poll answers its own playback and the player's volume, output and lists") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    PlayerStateStore store;
    store.publish(engineState());
    moveEveryEngineRevision(store);
    moveEveryEngineRevision(store);
    const TestServer server = servingWith(recorder.player(), &library, &store);

    auto rows = tracks("Road", kRows);
    rows[2].subsong = 4;
    const auto paused = playingSession(server, recorder, kPhone, rows, 2);
    const auto ears = listening(recorder, paused, kPhone);
    checkDone(post(server, scoped(kMode, paused, kPhone), R"({"mode": "repeatAll"})"));
    checkDone(post(server, scoped(kSeek, paused, kPhone), R"({"seconds": 42})"));
    checkDone(post(server, scoped(kPlayPause, paused, kPhone), ""));
    REQUIRE(recorder.session(paused)->enqueue({track("Queued")}) == PlayerOutcome::done);

    const auto stopped = createdId(server, kLaptop);
    shared(server, stopped, kLaptop, true);

    const auto pausedPoll = polled(server, paused, kPhone);
    const auto stoppedPoll = polled(server, stopped, kLaptop);
    const auto enginePoll = polled(server, "", "");

    const auto& engine = enginePoll["player"];
    CHECK(engine["playback"] == "paused");
    CHECK(engine["title"] == "Engine Track");
    CHECK(engine["sessionRevision"] == 0);

    const auto& player = pausedPoll["player"];
    CHECK(keysOf(player) == keysOf(engine));
    CHECK(player["playback"] == "paused");
    CHECK(player["path"] == rows[2].path);
    CHECK(player["subsong"] == 4);
    CHECK(player["libraryPath"] == libraryPathOf(rows[2]));
    CHECK(player["position"]["seconds"] == 42);
    CHECK(player["duration"] == stateOf(recorder, paused).duration);
    CHECK(player["playbackMode"] == "repeatAll");
    CHECK(player["title"] == nameOf(rows[2]));
    CHECK(player["artist"] == "Artist of " + nameOf(rows[2]));
    CHECK(player["album"] == "Album of " + nameOf(rows[2]));
    CHECK(player["albumArtist"] == "Album artist of " + nameOf(rows[2]));
    CHECK(player["playingLocation"].is_null());
    CHECK(player["queueRevision"] == recorder.session(paused)->revisions().queue);
    CHECK(player["queueRevision"] != engine["queueRevision"]);
    CHECK(player["timelineRevision"] == 0);
    CHECK(engine["timelineRevision"] != 0);
    CHECK(player["sessionRevision"] == recorder.session(paused)->revisions().session);

    const auto& idle = stoppedPoll["player"];
    CHECK(keysOf(idle) == keysOf(engine));
    CHECK(idle["playback"] == "stopped");
    CHECK(idle["path"] == "");
    CHECK(idle["libraryPath"].is_null());
    CHECK(idle["title"].is_null());
    CHECK(idle["playbackMode"] == "inOrder");
    CHECK(idle["playingLocation"].is_null());
    CHECK(idle["queueRevision"] == recorder.session(stopped)->revisions().queue);
    CHECK(idle["sessionRevision"] == recorder.session(stopped)->revisions().session);
    CHECK(idle["sessionRevision"] != player["sessionRevision"]);

    for (const char* key : {"volume", "muted", "outputDeviceId", "outputSilent",
                            "currentPlaylistId", "playlistsRevision"}) {
        CAPTURE(key);
        CHECK(player[key] == engine[key]);
        CHECK(idle[key] == engine[key]);
    }
    CHECK(player["volume"] == -6);
    CHECK(player["muted"] == true);
    CHECK(player["outputDeviceId"] == kSpeakers);
    CHECK(player["outputSilent"] == false);
    CHECK(player["currentPlaylistId"] == kPlaylistId);
    CHECK(player["playlistsRevision"] == store.read().playlistsRevision);

    for (const char* key : {"library", "mainThread", "configGeneration"}) {
        CAPTURE(key);
        REQUIRE(enginePoll.contains(key));
        CHECK(pausedPoll[key] == enginePoll[key]);
        CHECK(stoppedPoll[key] == enginePoll[key]);
    }
    CHECK(recorder.calls() == 0);
}

// Pausing keeps the turn, so the names read for it hold; the next track is a new turn.
TEST_CASE("a session's poll names its track through the track reader, once for each track") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    const auto ears = listening(recorder, id, kPhone);

    const auto first = playerPolled(server, id, kPhone);
    CHECK(first["title"] == nameOf(rows[2]));
    CHECK(first["artist"] == "Artist of " + nameOf(rows[2]));
    CHECK(first["album"] == "Album of " + nameOf(rows[2]));
    CHECK(first["albumArtist"] == "Album artist of " + nameOf(rows[2]));

    playerPolled(server, id, kPhone);
    checkDone(post(server, scoped(kPlayPause, id, kPhone), ""));
    CHECK(playerPolled(server, id, kPhone)["title"] == nameOf(rows[2]));
    CHECK(recorder.trackReads() == std::vector<std::string>{nameOf(rows[2])});

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    CHECK(playerPolled(server, id, kPhone)["title"] == nameOf(rows[3]));
    CHECK(recorder.trackReads() == std::vector<std::string>{nameOf(rows[2]), nameOf(rows[3])});
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a stopped session's poll answers no track and no names, and reads no track") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto fresh = createdId(server, kPhone);
    const auto stopped = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);
    checkDone(post(server, scoped(kStop, stopped, kPhone), ""));
    const auto readsBefore = recorder.trackReads().size();

    for (const auto& id : {fresh, stopped}) {
        CAPTURE(id);
        const auto player = playerPolled(server, id, kPhone);
        CHECK(player["playback"] == "stopped");
        CHECK(player["path"] == "");
        CHECK(player["libraryPath"].is_null());
        for (const char* key : {"title", "artist", "album", "albumArtist"}) {
            CAPTURE(key);
            CHECK(player[key].is_null());
        }
    }

    CHECK(recorder.trackReads().size() == readsBefore);
    CHECK(recorder.calls() == 0);
}

// foobar2000 evaluates a missing field as an empty string, and the engine's poll answers it null
// (state_route_test.cpp), so a client keys an untagged track the same way whichever session plays
// it. The title is there to show the names were read at all.
TEST_CASE(
    "a name a session's track does not carry is null in its poll and document, as the engine's") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    auto rows = tracks("Road", kRows);
    rows[2] = track("Untagged 2");
    const auto id = playingSession(server, recorder, kPhone, rows, 2);

    const auto player = playerPolled(server, id, kPhone);
    const auto document = documentOf(server, id, kPhone);

    CHECK(player["title"] == "Untagged 2");
    CHECK(document["title"] == "Untagged 2");
    for (const char* key : {"artist", "album", "albumArtist"}) {
        CAPTURE(key);
        REQUIRE(player.contains(key));
        CHECK(player[key].is_null());
        CHECK(document[key].is_null());
    }
    CHECK(recorder.calls() == 0);
}

namespace {

// The entry GET /api/sessions answers `deviceId` for the session `id`.
json listedAs(const TestServer& server, const std::string& deviceId, const std::string& id) {
    const auto sessions = sessionsSeenBy(server, deviceId);
    const auto found = std::find_if(sessions.begin(), sessions.end(),
                                    [&id](const json& session) { return session["id"] == id; });
    REQUIRE(found != sessions.end());
    return *found;
}

void checkNamed(const json& document, const std::string& name) {
    CHECK(document["title"] == name);
    CHECK(document["artist"] == "Artist of " + name);
    CHECK(document["album"] == "Album of " + name);
    CHECK(document["albumArtist"] == "Album artist of " + name);
}

void checkUnnamed(const json& document) {
    for (const char* key : {"title", "artist", "album", "albumArtist"}) {
        CAPTURE(key);
        REQUIRE(document.contains(key));
        CHECK(document[key].is_null());
    }
}

}  // namespace

// A picker lists sessions from GET /api/sessions alone, so a document that waited for some state
// poll to read the names would show a shared session untitled on every device not polling it.
TEST_CASE("a session's document and its list entry name its track with no poll before them") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);

    checkNamed(documentOf(server, id, kPhone), nameOf(rows[2]));
    checkNamed(listedAs(server, kPhone, id), nameOf(rows[2]));
    CHECK(recorder.trackReads() == std::vector<std::string>{nameOf(rows[2])});

    checkDone(post(server, scoped(kNext, id, kPhone), ""));

    checkNamed(listedAs(server, kPhone, id), nameOf(rows[3]));
    checkNamed(documentOf(server, id, kPhone), nameOf(rows[3]));
    CHECK(playerPolled(server, id, kPhone)["title"] == nameOf(rows[3]));
    CHECK(recorder.trackReads() == std::vector<std::string>{nameOf(rows[2]), nameOf(rows[3])});
    CHECK(recorder.calls() == 0);
}

TEST_CASE("names a poll read are the ones the document answers, read once between them") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);

    CHECK(playerPolled(server, id, kPhone)["title"] == nameOf(rows[2]));
    checkNamed(documentOf(server, id, kPhone), nameOf(rows[2]));
    checkNamed(listedAs(server, kPhone, id), nameOf(rows[2]));

    CHECK(recorder.trackReads() == std::vector<std::string>{nameOf(rows[2])});
    CHECK(recorder.calls() == 0);
}

// Two sessions on different tracks, so a list that named one from the other's read shows.
TEST_CASE("the list names each detached session it shows from that session's own track") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto first = playingSession(server, recorder, kPhone, tracks("Road", kRows), 1);
    const auto second = playingSession(server, recorder, kPhone, tracks("Other", kRows), 3);

    checkNamed(listedAs(server, kPhone, first), "Road 1");
    checkNamed(listedAs(server, kPhone, second), "Other 3");

    auto reads = recorder.trackReads();
    std::sort(reads.begin(), reads.end());
    CHECK(reads == std::vector<std::string>{"Other 3", "Road 1"});
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a stopped session's document names nothing and reads nothing, nor does a stranger's") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto fresh = createdId(server, kPhone);
    const auto stopped = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);
    checkDone(post(server, scoped(kStop, stopped, kPhone), ""));
    const auto playing = playingSession(server, recorder, kPhone, tracks("Other", kRows), 1);
    checkNamed(documentOf(server, playing, kPhone), "Other 1");
    const auto readsBefore = recorder.trackReads().size();

    for (const auto& id : {fresh, stopped}) {
        CAPTURE(id);
        checkUnnamed(documentOf(server, id, kPhone));
        checkUnnamed(listedAs(server, kPhone, id));
    }
    CHECK(recorder.trackReads().size() == readsBefore);

    const auto unknown = unknownSessionAnswer(server);
    for (const char* device : {kLaptop, ""}) {
        CAPTURE(device);
        checkSameAnswer(read(server, playing, device), unknown);
        CHECK(idsSeenBy(server, device) == engineOnly());
    }
    CHECK(recorder.trackReads().size() == readsBefore);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a document whose names could not be read is null, and the next read asks again") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    PlayerOutcome outcome = PlayerOutcome::done;

    SUBCASE("the player had not loaded the file's info") {
        outcome = PlayerOutcome::done;
    }
    SUBCASE("the read timed out") {
        outcome = PlayerOutcome::timedOut;
    }

    recorder.cannotName(nameOf(rows[2]), outcome);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    const auto readsBefore = recorder.trackReads().size();

    checkUnnamed(documentOf(server, id, kPhone));
    CHECK(recorder.trackReads().size() == readsBefore + 1);
    checkUnnamed(listedAs(server, kPhone, id));
    CHECK(recorder.trackReads().size() == readsBefore + 2);

    recorder.canName(nameOf(rows[2]));

    checkNamed(documentOf(server, id, kPhone), nameOf(rows[2]));
    checkNamed(documentOf(server, id, kPhone), nameOf(rows[2]));
    CHECK(recorder.trackReads().size() == readsBefore + 3);
    CHECK(recorder.calls() == 0);
}

namespace {

// The decoder's own length for a turn, told to the session as its decoder tells it.
void decoderOpens(Session& session, double duration) {
    const auto turn = session.turn();
    REQUIRE(turn.has_value());
    session.began(turn->serial, duration, Session::Clock::time_point{});
}

}  // namespace

// Nobody listens here, so no decoder opens a track unless the case says so: a controller that is
// not listening draws progress from the length the track's metadata gives.
TEST_CASE("a session's duration is its track's own length until the decoder answers one") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    recorder.lasts(nameOf(rows[2]), 241.5);
    recorder.lasts(nameOf(rows[3]), 187.25);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);

    CHECK(playerPolled(server, id, kPhone)["duration"] == 241.5);

    decoderOpens(*recorder.session(id), 243);
    CHECK(playerPolled(server, id, kPhone)["duration"] == 243);

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    CHECK(playerPolled(server, id, kPhone)["duration"] == 187.25);

    checkDone(post(server, scoped(kStop, id, kPhone), ""));
    CHECK(playerPolled(server, id, kPhone)["duration"] == 0);
    CHECK(recorder.calls() == 0);
}

// The names are read on the first poll, after a listener's decoder may already have opened the
// track, and the length read with them does not replace the decoder's.
TEST_CASE("a decoder's duration answered before the first poll is the one the poll answers") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    recorder.lasts(nameOf(rows[2]), 241.5);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);

    decoderOpens(*recorder.session(id), 243);

    const auto player = playerPolled(server, id, kPhone);
    CHECK(player["title"] == nameOf(rows[2]));
    CHECK(player["duration"] == 243);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a session's poll is 304 while nothing it answers moves, and 200 once anything does") {
    Recorder recorder;
    PlayerStateStore store;
    store.publish(engineState());
    const TestServer server = serving(recorder.player(), &store);
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 1);
    const auto ears = listening(recorder, id, kPhone);

    const auto tag = tagOf(poll(server, id, kPhone));
    checkUnchanged(pollHolding(server, id, kPhone, tag), tag);

    SUBCASE("it pauses") {
        checkDone(post(server, scoped(kPlayPause, id, kPhone), ""));
    }
    SUBCASE("it moves to the next track") {
        checkDone(post(server, scoped(kNext, id, kPhone), ""));
    }
    SUBCASE("it plays another row") {
        checkDone(post(server, scoped(rowPlayPath(kPlaylistId, 3), id, kPhone), ""));
    }
    SUBCASE("it seeks") {
        checkDone(post(server, scoped(kSeek, id, kPhone), R"({"seconds": 42})"));
    }
    SUBCASE("it stops") {
        checkDone(post(server, scoped(kStop, id, kPhone), ""));
    }
    SUBCASE("its order changes") {
        checkDone(post(server, scoped(kMode, id, kPhone), R"({"mode": "repeatOne"})"));
    }
    SUBCASE("its queue changes") {
        REQUIRE(recorder.session(id)->enqueue({track("Queued")}) == PlayerOutcome::done);
    }
    SUBCASE("it is shared") {
        shared(server, id, kPhone, true);
    }
    SUBCASE("the player's volume moves") {
        store.volumeChanged(-12, false);
    }

    checkMoved(pollHolding(server, id, kPhone, tag), tag);
}

// Two sessions just created hold the same state, so only the id can tell their tags apart.
TEST_CASE("the engine and each session poll under tags of their own, none moving with another") {
    Recorder recorder;
    PlayerStateStore store;
    store.publish(engineState());
    const TestServer server = serving(recorder.player(), &store);
    const auto playing = playingSession(server, recorder, kPhone, tracks("Road", kRows), 1);
    const auto first = createdId(server, kPhone);
    const auto second = createdId(server, kPhone);

    const auto engineTag = tagOf(poll(server, "", ""));
    const auto playingTag = tagOf(poll(server, playing, kPhone));
    const auto firstTag = tagOf(poll(server, first, kPhone));
    const auto secondTag = tagOf(poll(server, second, kPhone));

    CHECK(std::set<std::string>{engineTag, playingTag, firstTag, secondTag}.size() == 4);

    checkDone(post(server, scoped(kNext, playing, kPhone), ""));
    shared(server, first, kPhone, true);

    checkMoved(pollHolding(server, playing, kPhone, playingTag), playingTag);
    checkMoved(pollHolding(server, first, kPhone, firstTag), firstTag);
    checkUnchanged(pollHolding(server, second, kPhone, secondTag), secondTag);
    checkUnchanged(pollHolding(server, "", "", engineTag), engineTag);
    CHECK(recorder.calls() == 0);
}

namespace {

// A device the player moves to in playerMoves(), first audible and then playing nowhere.
constexpr char kAnotherOutput[] =
    "{5A3E1C27-8B4D-4F0E-9C61-2D7B8E9F0A13}:{77B1C0DE-0000-4F21-9C3D-2B8E6F4A1D90}";

struct StoreMove {
    std::string name;
    std::function<void(PlayerStateStore&)> apply;
};

// Each moves what the engine's poll answers and nothing a detached session's poll answers.
std::vector<StoreMove> engineMoves() {
    const auto now = [] { return std::chrono::steady_clock::now(); };
    return {
        {"resumed", [now](PlayerStateStore& store) { store.resumed(now()); }},
        {"paused", [now](PlayerStateStore& store) { store.paused(now()); }},
        {"another track",
         [now](PlayerStateStore& store) {
             store.started(PlayingTrack{R"(X:\music\Fictional Artist\Engine Album\08 Next.flac)", 0,
                                        "Fictional Artist/Engine Album/08 Next.flac", 300},
                           now());
         }},
        {"its title",
         [](PlayerStateStore& store) {
             store.nameChanged("Next Track", "Engine Artist", "Engine Album",
                               "Engine Album Artist");
         }},
        {"its position", [now](PlayerStateStore& store) { store.seeked(120, now()); }},
        {"its duration", [](PlayerStateStore& store) { store.durationChanged(301); }},
        {"its mode", [](PlayerStateStore& store) { store.playbackModeChanged("repeatOne"); }},
        {"its row",
         [](PlayerStateStore& store) {
             store.playingLocationChanged(PlayingLocation{kPlaylistId, 2});
         }},
        {"its queue",
         [](PlayerStateStore& store) {
             QueueEntry entry;
             entry.path = R"(X:\music\queued at the engine.flac)";
             store.queueChanged({entry});
         }},
        {"its timeline", [](PlayerStateStore& store) { store.timelineMarked(); }},
        {"stopped", [](PlayerStateStore& store) { store.stopped(); }},
    };
}

// Each moves what every poll answers from the player, whichever session it names.
std::vector<StoreMove> playerMoves() {
    return {
        {"volume", [](PlayerStateStore& store) { store.volumeChanged(-12, true); }},
        {"muted", [](PlayerStateStore& store) { store.volumeChanged(-12, false); }},
        {"output device",
         [](PlayerStateStore& store) {
             store.outputDeviceChanged(std::string(kAnotherOutput), false);
         }},
        {"output playing nowhere",
         [](PlayerStateStore& store) {
             store.outputDeviceChanged(std::string(kAnotherOutput), true);
         }},
        {"current playlist",
         [](PlayerStateStore& store) {
             store.currentPlaylistChanged(std::string(kNoSuchPlaylistId));
         }},
        {"playlists",
         [](PlayerStateStore& store) {
             PlaylistMark mark;
             mark.id = kPlaylistId;
             mark.title = "Road trip, renamed";
             store.playlistsChanged({mark});
         }},
    };
}

}  // namespace

// Four polls a move, and the poll's budget is 30 deep, so each move waits long enough to earn its
// polls back. The session's grace is minutes away throughout.
constexpr auto kAPollsWorth = std::chrono::seconds(1);

// A stopped session's own state stands still, so any tag it moves to came from the player.
TEST_CASE(
    "a session's poll stays 304 through every move of the engine's playback, and moves with the "
    "player's") {
    Recorder recorder;
    PlayerStateStore store;
    store.publish(engineState());
    const TestServer server = serving(recorder.player(), &store);
    const auto id = createdId(server, kPhone);

    for (const auto& move : engineMoves()) {
        CAPTURE(move.name);
        server.advanceClock(kAPollsWorth);
        const auto sessionTag = tagOf(poll(server, id, kPhone));
        const auto engineTag = tagOf(poll(server, "", ""));

        move.apply(store);

        checkUnchanged(pollHolding(server, id, kPhone, sessionTag), sessionTag);
        checkMoved(pollHolding(server, "", "", engineTag), engineTag);
    }

    for (const auto& move : playerMoves()) {
        CAPTURE(move.name);
        server.advanceClock(kAPollsWorth);
        const auto sessionTag = tagOf(poll(server, id, kPhone));
        const auto engineTag = tagOf(poll(server, "", ""));

        move.apply(store);

        checkMoved(pollHolding(server, id, kPhone, sessionTag), sessionTag);
        checkMoved(pollHolding(server, "", "", engineTag), engineTag);
    }
    CHECK(recorder.calls() == 0);
}

// A detached session holds no output of its own, so each answer has to be the player's: a session
// filling the field from anything else answers one of these three wrong.
TEST_CASE("every session's poll answers the player's outputSilent, true, false and null alike") {
    Recorder recorder;
    PlayerStateStore store;
    store.publish(engineState());
    const TestServer server = serving(recorder.player(), &store);
    const auto playing = playingSession(server, recorder, kPhone, tracks("Road", kRows), 1);
    const auto idle = createdId(server, kLaptop);

    const auto pollsSay = [&](const json& silent, const json& deviceId) {
        server.advanceClock(kAPollsWorth);
        for (const auto& asker : {std::pair<std::string, std::string>{playing, kPhone},
                                  {idle, kLaptop},
                                  {kEngineSessionId, kPhone},
                                  {"", ""}}) {
            CAPTURE(asker.first);
            const auto player = playerPolled(server, asker.first, asker.second);
            CHECK(player["outputSilent"] == silent);
            CHECK(player["outputDeviceId"] == deviceId);
        }
    };

    pollsSay(false, kSpeakers);

    store.outputDeviceChanged(std::string(kSpeakers), true);
    pollsSay(true, kSpeakers);

    store.outputDeviceChanged(std::nullopt, std::nullopt);
    pollsSay(nullptr, nullptr);

    store.outputDeviceChanged(std::string(kAnotherOutput), false);
    pollsSay(false, kAnotherOutput);

    CHECK(recorder.calls() == 0);
}

// The creator's own grace began when it created the session; the laptop's poll at minute 14 is
// what is left holding it at minute 16. A 304 is the answer a poll with nothing new gets, so it
// has to hold the session as a 200 does.
TEST_CASE("a member's poll keeps a session past the creator's grace, answered 200 or 304") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = createdId(server, kPhone);
    shared(server, id, kPhone, true);
    CHECK(playerPolled(server, id, kLaptop)["playback"] == "stopped");
    shared(server, id, kPhone, false);
    const auto tag = tagOf(poll(server, id, kLaptop));

    server.advanceClock(std::chrono::minutes(14));

    SUBCASE("answered 200") {
        const auto response = poll(server, id, kLaptop);
        REQUIRE(response);
        CHECK(response->status == 200);
    }
    SUBCASE("answered 304") {
        checkUnchanged(pollHolding(server, id, kLaptop, tag), tag);
    }

    server.advanceClock(std::chrono::minutes(2));

    CHECK(statusOf(read(server, id, kLaptop)) == 200);
    CHECK(idsSeenBy(server, kLaptop) == std::vector<std::string>{kEngineSessionId, id});
    checkSameAnswer(read(server, id, kPhone), unknownSessionAnswer(server));
    CHECK(recorder.calls() == 0);
}

// A command reaching a session does not hold it past the creator's grace; only a poll does.
TEST_CASE("a session nobody polls is gone once its creator's grace has run out") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 1);

    server.advanceClock(std::chrono::minutes(14));
    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    CHECK(statusOf(read(server, id, kPhone)) == 200);

    server.advanceClock(std::chrono::minutes(2));

    const auto unknown = unknownSessionAnswer(server);
    checkSameAnswer(read(server, id, kPhone), unknown);
    checkSameAnswer(poll(server, id, kPhone), unknown);
    CHECK(idsSeenBy(server, kPhone) == engineOnly());
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a poll naming no device holds nothing, even of a shared session it may read") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = createdId(server, kPhone);
    shared(server, id, kPhone, true);

    server.advanceClock(std::chrono::minutes(14));
    CHECK(playerPolled(server, id, "")["playback"] == "stopped");

    server.advanceClock(std::chrono::minutes(2));

    checkSameAnswer(poll(server, id, ""), unknownSessionAnswer(server));
    CHECK(idsSeenBy(server, "") == engineOnly());
    CHECK(idsSeenBy(server, kPhone) == engineOnly());
    CHECK(recorder.calls() == 0);
}

// A state poll is among the requests a device joins a shared session by, and a command is not.
TEST_CASE(
    "a device that polled a shared session keeps it once unshared, one that drove it does not") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 1);
    shared(server, id, kPhone, true);

    CHECK(playerPolled(server, id, kLaptop)["libraryPath"] == libraryPathOf(rows[1]));
    checkDone(post(server, scoped(kNext, id, kTablet), ""));

    shared(server, id, kPhone, false);

    CHECK(playerPolled(server, id, kLaptop)["libraryPath"] == libraryPathOf(rows[2]));
    CHECK(statusOf(read(server, id, kLaptop)) == 200);

    const auto unknown = unknownSessionAnswer(server);
    checkSameAnswer(poll(server, id, kTablet), unknown);
    checkSameAnswer(read(server, id, kTablet), unknown);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a private session's poll is 404 to a stranger and to no device, as an unknown id is") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 1);
    const auto unknown = unknownSessionAnswer(server);

    for (const char* device : {kLaptop, ""}) {
        CAPTURE(device);
        checkSameAnswer(poll(server, id, device), unknown);
    }
    checkSameAnswer(poll(server, "Zz00q", kPhone), unknown);

    CHECK(statusOf(read(server, id, kLaptop)) == 404);
    CHECK(recorder.trackReads().empty());
    CHECK(recorder.calls() == 0);
}

// Nothing in a route test marks a session's timeline: that takes its encoder, which no case here
// runs, so timelineRevision is only seen to start at 0 and stay there.
TEST_CASE("a session's queueRevision moves with its queue and sessionRevision with its sharing") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 1);

    const auto start = playerPolled(server, id, kPhone);

    REQUIRE(recorder.session(id)->enqueue({track("Queued")}) == PlayerOutcome::done);
    const auto queued = playerPolled(server, id, kPhone);
    CHECK(queued["queueRevision"] > start["queueRevision"]);
    CHECK(queued["sessionRevision"] == start["sessionRevision"]);

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    const auto taken = playerPolled(server, id, kPhone);
    CHECK(taken["libraryPath"] == libraryPathOf(track("Queued")));
    CHECK(taken["queueRevision"] > queued["queueRevision"]);
    CHECK(taken["sessionRevision"] == start["sessionRevision"]);

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    const auto moved = playerPolled(server, id, kPhone);
    CHECK(moved["libraryPath"] == libraryPathOf(rows[2]));
    CHECK(moved["queueRevision"] == taken["queueRevision"]);
    CHECK(moved["sessionRevision"] == start["sessionRevision"]);

    shared(server, id, kPhone, true);
    const auto sharing = playerPolled(server, id, kPhone);
    CHECK(sharing["sessionRevision"] > moved["sessionRevision"]);
    CHECK(sharing["queueRevision"] == moved["queueRevision"]);

    shared(server, id, kPhone, false);
    const auto unsharing = playerPolled(server, id, kPhone);
    CHECK(unsharing["sessionRevision"] > sharing["sessionRevision"]);

    for (const auto& player : {start, queued, taken, moved, sharing, unsharing})
        CHECK(player["timelineRevision"] == 0);
    CHECK(recorder.calls() == 0);
}

namespace {

constexpr char kQueue[] = "/api/queue";
constexpr char kMoveQueued[] = "/api/queue/move";

std::string withQuery(const std::string& path, const std::string& more) {
    return path + (path.find('?') == std::string::npos ? "?" : "&") + more;
}

json librarySet(uint64_t structure, const char* form, const json& selection) {
    return json{{"structure", structure}, {form, selection}};
}

json queueOf(const TestServer& server, const std::string& session, const std::string& deviceId) {
    const auto response = get(server, scoped(kQueue, session, deviceId));
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

httplib::Result queueing(const TestServer& server, const std::string& session,
                         const std::string& deviceId, const json& body) {
    return post(server, scoped(kQueue, session, deviceId), body.dump());
}

httplib::Result clearing(const TestServer& server, const std::string& session,
                         const std::string& deviceId) {
    return server.client().Delete(scoped(kQueue, session, deviceId));
}

httplib::Result moving(const TestServer& server, const std::string& session,
                       const std::string& deviceId, uint32_t from, uint32_t to, uint64_t revision) {
    return post(server, scoped(kMoveQueued, session, deviceId),
                json{{"from", from}, {"to", to}, {"revision", revision}}.dump());
}

httplib::Result removing(const TestServer& server, const std::string& session,
                         const std::string& deviceId, uint32_t index, uint64_t revision) {
    return server.client().Delete(
        withQuery(scoped(std::string(kQueue) + "/" + std::to_string(index), session, deviceId),
                  "revision=" + std::to_string(revision)));
}

// What the session holds queued, read off the session rather than through the route under test.
std::vector<std::string> queuedIn(const Recorder& recorder, const std::string& id) {
    const auto entries = recorder.session(id)->queue().entries;
    std::vector<std::string> names;
    std::transform(entries.begin(), entries.end(), std::back_inserter(names), nameOf);
    return names;
}

uint64_t queueRevisionOf(const Recorder& recorder, const std::string& id) {
    return recorder.session(id)->queue().revision;
}

std::vector<SessionTrack> tracksNamed(std::vector<std::string>::const_iterator first,
                                      std::vector<std::string>::const_iterator last) {
    std::vector<SessionTrack> made;
    std::transform(first, last, std::back_inserter(made), track);
    return made;
}

// A queue in the session named `id`, enqueued in two edits so its revision is not 1.
void queueIn(const Recorder& recorder, const std::string& id,
             const std::vector<std::string>& names) {
    REQUIRE(names.size() >= 2);
    const auto second = names.begin() + 1;
    REQUIRE(recorder.session(id)->enqueue(tracksNamed(names.begin(), second)) ==
            PlayerOutcome::done);
    REQUIRE(recorder.session(id)->enqueue(tracksNamed(second, names.end())) == PlayerOutcome::done);
}

std::vector<std::string> fourQueued() {
    return {"Queued A", "Queued B", "Queued C", "Queued D"};
}

std::vector<std::string> engineTitles(const Recorder& recorder) {
    const auto queued = recorder.engineQueue();
    std::vector<std::string> titles;
    std::transform(queued.begin(), queued.end(), std::back_inserter(titles),
                   [](const QueuedTrack& entry) { return entry.title; });
    return titles;
}

QueuedTrack engineQueued(const std::string& title) {
    QueuedTrack queued;
    queued.title = title;
    return queued;
}

struct QueueRoute {
    const char* name;
    std::function<httplib::Result(const std::string& session, const std::string& deviceId)> send;
};

}  // namespace

TEST_CASE(
    "GET /api/queue naming a session reads its entries at its own revision, located nowhere") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto other = createdId(server, kPhone);
    const auto id = createdId(server, kPhone);
    queueIn(recorder, id, {"First", "Second", "Third"});
    queueIn(recorder, other, {"Elsewhere", "Elsewhere too"});
    recorder.queueAtTheEngine({engineQueued("At the engine")});

    const auto body = queueOf(server, id, kPhone);

    CHECK(keysOf(body) == Keys{"entries", "revision"});
    CHECK(body["revision"] == queueRevisionOf(recorder, id));

    const auto& entries = body["entries"];
    REQUIRE(entries.is_array());
    REQUIRE(entries.size() == 3);
    CHECK(entries[0]["title"] == "First");
    CHECK(entries[1]["title"] == "Second");
    CHECK(entries[2]["title"] == "Third");
    for (const auto& entry : entries) {
        CAPTURE(entry.dump());
        CHECK(keysOf(entry) == Keys{"title", "artist", "duration", "album", "albumArtist",
                                    "libraryPath", "location"});
        CHECK(entry["location"].is_null());
    }
    CHECK(entries[1]["libraryPath"] == libraryPathOf(track("Second")));

    CHECK(recorder.queueReads() == 1);
    CHECK(recorder.engineCalls(Call::readQueue) == 0);
    CHECK(recorder.calls() == 0);
}

// A multi-select is queued in the order it was clicked, so 5 before 2.
TEST_CASE("POST /api/queue naming a session takes its ordinals from the library once, at the end") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto other = createdId(server, kPhone);
    const auto id = createdId(server, kPhone);
    queueIn(recorder, id, {"Already", "Already too"});
    queueIn(recorder, other, {"Elsewhere", "Elsewhere too"});
    recorder.queueAtTheEngine({engineQueued("At the engine")});

    checkDone(queueing(server, id, kPhone, librarySet(structure, "ordinals", {5, 2})));

    CHECK(recorder.libraryTaken() == std::vector<LibraryTake>{{structure, {5, 2}}});
    CHECK(queuedIn(recorder, id) ==
          std::vector<std::string>{"Already", "Already too", libraryName(5), libraryName(2)});
    CHECK(queuedIn(recorder, other) == std::vector<std::string>{"Elsewhere", "Elsewhere too"});
    CHECK(engineTitles(recorder) == std::vector<std::string>{"At the engine"});
    CHECK(recorder.calls() == 0);
}

// POST /api/queue queues a playlist's rows into a session as well as the library's tracks.
TEST_CASE("POST /api/queue naming a session takes playlist rows by position, in the order given") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    recorder.hold(kPlaylistId, rows);
    const auto id = createdId(server, kPhone);

    checkDone(
        queueing(server, id, kPhone, json{{"playlistId", kPlaylistId}, {"positions", {3, 0}}}));

    CHECK(recorder.taken() == std::vector<std::string>{kPlaylistId});
    CHECK(recorder.takenWithPositions() == 1);
    CHECK(queuedIn(recorder, id) == std::vector<std::string>{nameOf(rows[3]), nameOf(rows[0])});
    CHECK(recorder.engineCalls(Call::queueRows) == 0);
    CHECK(recorder.calls() == 0);
}

// Zero is the head of the queue, and the position a parse reading a missing field would give.
TEST_CASE("POST /api/queue naming a session at a position lands there at the queue's revision") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto id = createdId(server, kPhone);
    queueIn(recorder, id, {"Queued A", "Queued B", "Queued C"});

    auto atOne = librarySet(structure, "ordinals", {4});
    atOne["at"] = 1;
    atOne["revision"] = queueRevisionOf(recorder, id);
    checkDone(queueing(server, id, kPhone, atOne));

    auto atZero = librarySet(structure, "ordinals", {6});
    atZero["at"] = 0;
    atZero["revision"] = queueRevisionOf(recorder, id);
    checkDone(queueing(server, id, kPhone, atZero));

    CHECK(queuedIn(recorder, id) == std::vector<std::string>{libraryName(6), "Queued A",
                                                             libraryName(4), "Queued B",
                                                             "Queued C"});
    CHECK(recorder.calls() == 0);
}

// The queue's revision is checked before the library is asked anything, as the engine's route
// checks it before the player is asked.
TEST_CASE("POST /api/queue naming a session at a stale revision is 409 and takes nothing") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto id = createdId(server, kPhone);
    queueIn(recorder, id, {"Queued A", "Queued B", "Queued C"});
    const auto current = queueRevisionOf(recorder, id);
    REQUIRE(current >= 2);

    for (const uint64_t revision : {current - 1, current + 1}) {
        CAPTURE(revision);
        auto body = librarySet(structure, "ordinals", {4});
        body["at"] = 1;
        body["revision"] = revision;

        const auto response = queueing(server, id, kPhone, body);
        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(errorOf(*response) == describe(PlayerOutcome::queueMoved));
    }

    CHECK(recorder.libraryTaken().empty());
    CHECK(queuedIn(recorder, id) == std::vector<std::string>{"Queued A", "Queued B", "Queued C"});
    CHECK(queueRevisionOf(recorder, id) == current);
    CHECK(recorder.calls() == 0);
}

// The library can rebuild between the route's check and the take, so the taker answers the same
// 409 the route does for a structure already stale.
TEST_CASE("POST /api/queue naming a session is the engine's 409 for a library that moved on") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto exported = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto id = createdId(server, kPhone);
    queueIn(recorder, id, {"Queued A", "Queued B"});

    recorder.moveTheLibrary();
    const auto duringTheTake = queueing(server, id, kPhone, librarySet(exported, "ordinals", {1}));
    REQUIRE(duringTheTake);
    CHECK(duringTheTake->status == 409);
    CHECK(errorOf(*duringTheTake) == describe(DeltaOutcome::structureChanged));
    CHECK(recorder.libraryTaken().size() == 1);

    buildLibrary(library, kLibraryTracks - 2);
    const auto beforeTheTake = queueing(server, id, kPhone, librarySet(exported, "ordinals", {1}));
    REQUIRE(beforeTheTake);
    CHECK(beforeTheTake->status == 409);
    CHECK(errorOf(*beforeTheTake) == describe(DeltaOutcome::structureChanged));
    CHECK(recorder.libraryTaken().size() == 1);

    CHECK(queuedIn(recorder, id) == std::vector<std::string>{"Queued A", "Queued B"});
    CHECK(recorder.calls() == 0);
}

// What the refusal says is left open: the one sentence the tree holds for tooMany is the
// autoplaylist limit's.
TEST_CASE("POST /api/queue naming a session is refused whole past kMaxSessionQueue entries") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto id = createdId(server, kPhone);
    REQUIRE(recorder.session(id)->enqueue(tracks("Queued", kMaxSessionQueue - 1)) ==
            PlayerOutcome::done);
    const auto revision = queueRevisionOf(recorder, id);

    const auto past = queueing(server, id, kPhone, librarySet(structure, "ordinals", {1, 2}));
    REQUIRE(past);
    CHECK(past->status == 409);
    CHECK_FALSE(errorOf(*past).empty());
    CHECK(recorder.session(id)->queue().entries.size() == kMaxSessionQueue - 1);
    CHECK(queueRevisionOf(recorder, id) == revision);

    checkDone(queueing(server, id, kPhone, librarySet(structure, "ordinals", {1})));
    const auto entries = recorder.session(id)->queue().entries;
    REQUIRE(entries.size() == kMaxSessionQueue);
    CHECK(nameOf(entries.back()) == libraryName(1));
    CHECK(recorder.calls() == 0);
}

TEST_CASE("DELETE /api/queue naming a session empties that session's queue and no other") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto other = createdId(server, kPhone);
    const auto id = createdId(server, kPhone);
    queueIn(recorder, id, fourQueued());
    queueIn(recorder, other, {"Elsewhere", "Elsewhere too"});
    recorder.queueAtTheEngine({engineQueued("At the engine")});
    const auto revision = queueRevisionOf(recorder, id);

    checkDone(clearing(server, id, kPhone));

    CHECK(queuedIn(recorder, id).empty());
    CHECK(queueRevisionOf(recorder, id) > revision);
    CHECK(queueOf(server, id, kPhone)["entries"] == json::array());
    CHECK(queuedIn(recorder, other) == std::vector<std::string>{"Elsewhere", "Elsewhere too"});
    CHECK(engineTitles(recorder) == std::vector<std::string>{"At the engine"});
    CHECK(recorder.engineCalls(Call::clearQueue) == 0);
    CHECK(recorder.calls() == 0);
}

TEST_CASE(
    "POST /api/queue/move naming a session moves its entry at its revision, as the engine's") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto other = createdId(server, kPhone);
    const auto id = createdId(server, kPhone);
    queueIn(recorder, id, fourQueued());
    queueIn(recorder, other, {"Elsewhere", "Elsewhere too"});
    const auto planned = queueRevisionOf(recorder, id);

    checkDone(moving(server, id, kPhone, 3, 0, planned));
    const std::vector<std::string> moved{"Queued D", "Queued A", "Queued B", "Queued C"};
    CHECK(queuedIn(recorder, id) == moved);
    const auto current = queueRevisionOf(recorder, id);
    CHECK(current != planned);

    const auto stale = moving(server, id, kPhone, 0, 1, planned);
    REQUIRE(stale);
    CHECK(stale->status == 409);
    CHECK(errorOf(*stale) == describe(PlayerOutcome::queueMoved));

    const std::vector<std::pair<uint32_t, uint32_t>> pastTheEnd{{9, 0}, {0, 9}};
    for (const auto& move : pastTheEnd) {
        CAPTURE(move.first);
        CAPTURE(move.second);
        const auto past = moving(server, id, kPhone, move.first, move.second, current);
        REQUIRE(past);
        CHECK(past->status == 400);
        CHECK(errorOf(*past) == describe(PlayerOutcome::positionPastEnd));
    }

    CHECK(queuedIn(recorder, id) == moved);
    CHECK(queueRevisionOf(recorder, id) == current);
    CHECK(queuedIn(recorder, other) == std::vector<std::string>{"Elsewhere", "Elsewhere too"});
    CHECK(recorder.calls() == 0);
}

TEST_CASE("DELETE /api/queue/{index} naming a session removes its entry at its revision") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto other = createdId(server, kPhone);
    const auto id = createdId(server, kPhone);
    queueIn(recorder, id, fourQueued());
    queueIn(recorder, other, {"Elsewhere", "Elsewhere too"});
    const auto planned = queueRevisionOf(recorder, id);

    checkDone(removing(server, id, kPhone, 2, planned));
    const std::vector<std::string> left{"Queued A", "Queued B", "Queued D"};
    CHECK(queuedIn(recorder, id) == left);
    const auto current = queueRevisionOf(recorder, id);

    const auto stale = removing(server, id, kPhone, 0, planned);
    REQUIRE(stale);
    CHECK(stale->status == 409);
    CHECK(errorOf(*stale) == describe(PlayerOutcome::queueMoved));

    const auto past = removing(server, id, kPhone, 3, current);
    REQUIRE(past);
    CHECK(past->status == 400);
    CHECK(errorOf(*past) == describe(PlayerOutcome::positionPastEnd));

    CHECK(queuedIn(recorder, id) == left);
    CHECK(queuedIn(recorder, other) == std::vector<std::string>{"Elsewhere", "Elsewhere too"});
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a queue request naming a session that the route can judge is refused as the engine's") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto id = createdId(server, kPhone);
    queueIn(recorder, id, {"Queued A", "Queued B"});

    auto titled = librarySet(structure, "ordinals", {1});
    titled["title"] = "Mix";

    for (const auto& body :
         {std::string("not json"), librarySet(structure, "ordinals", {kLibraryTracks}).dump(),
          librarySet(structure, "ordinals", json::array()).dump(), titled.dump(),
          json{{"playlistId", kPlaylistId}}.dump()}) {
        CAPTURE(body);
        const auto engine = post(server, kQueue, body);
        REQUIRE(engine);
        CHECK(engine->status == 400);
        checkSameAnswer(post(server, scoped(kQueue, id, kPhone), body), engine);
    }

    for (const auto& body : {std::string("{}"), std::string(R"({"from": "1", "to": 0})")}) {
        CAPTURE(body);
        const auto engine = post(server, kMoveQueued, body);
        REQUIRE(engine);
        CHECK(engine->status == 400);
        checkSameAnswer(post(server, scoped(kMoveQueued, id, kPhone), body), engine);
    }

    CHECK(recorder.libraryTaken().empty());
    CHECK(recorder.taken().empty());
    CHECK(queuedIn(recorder, id) == std::vector<std::string>{"Queued A", "Queued B"});
    CHECK(recorder.calls() == 0);
}

// queue_route_test.cpp, unchanged, is the full proof; this is that naming the engine is the same
// request as naming nothing.
TEST_CASE("each queue route naming no session or the engine session reaches foobar2000's queue") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    queueIn(recorder, createdId(server, kPhone), {"Queued A", "Queued B"});
    recorder.queueAtTheEngine({engineQueued("At the engine")});

    struct Reached {
        QueueRoute route;
        Call call;
    };

    const std::vector<Reached> routes{
        {{"read", [&server](const std::string& s,
                            const std::string& d) { return get(server, scoped(kQueue, s, d)); }},
         Call::readQueue},
        {{"queue rows",
          [&server](const std::string& s, const std::string& d) {
              return queueing(server, s, d, json{{"playlistId", kPlaylistId}, {"positions", {0}}});
          }},
         Call::queueRows},
        {{"move", [&server](const std::string& s,
                            const std::string& d) { return moving(server, s, d, 0, 0, 0); }},
         Call::moveQueueEntry},
        {{"remove", [&server](const std::string& s,
                              const std::string& d) { return removing(server, s, d, 0, 0); }},
         Call::removeQueueEntry},
        {{"clear",
          [&server](const std::string& s, const std::string& d) { return clearing(server, s, d); }},
         Call::clearQueue},
    };

    for (const auto& reached : routes) {
        CAPTURE(reached.route.name);
        const auto before = recorder.engineCalls(reached.call);
        const auto unnamed = reached.route.send("", "");
        REQUIRE(unnamed);
        CHECK(recorder.engineCalls(reached.call) == before + 1);

        checkSameAnswer(reached.route.send(kEngineSessionId, kPhone), unnamed);
        CHECK(recorder.engineCalls(reached.call) == before + 2);
    }

    CHECK(recorder.queueReads() == 0);
    CHECK(recorder.taken().empty());
    CHECK(recorder.libraryTaken().empty());
}

TEST_CASE(
    "with controlPlayback off, queue writes naming the engine or none are 403, a session's not") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library, nullptr,
                                          parseSettings(R"({"controlPlayback": false})"));
    const auto id = createdId(server, kPhone);
    queueIn(recorder, id, {"Queued A", "Queued B"});
    recorder.queueAtTheEngine({engineQueued("At the engine")});

    const std::vector<QueueRoute> writes{
        {"queue tracks",
         [&](const std::string& s, const std::string& d) {
             return queueing(server, s, d, librarySet(structure, "ordinals", {1}));
         }},
        {"move",
         [&](const std::string& s, const std::string& d) { return moving(server, s, d, 0, 1, 0); }},
        {"remove",
         [&](const std::string& s, const std::string& d) { return removing(server, s, d, 0, 0); }},
        {"clear",
         [&](const std::string& s, const std::string& d) { return clearing(server, s, d); }},
    };

    for (const auto& write : writes) {
        CAPTURE(write.name);
        const auto unnamed = write.send("", "");
        REQUIRE(unnamed);
        CHECK(unnamed->status == 403);
        CHECK(errorOf(*unnamed).find("controlPlayback") != std::string::npos);
        checkSameAnswer(write.send(kEngineSessionId, kPhone), unnamed);
    }
    CHECK(recorder.libraryTaken().empty());
    CHECK(engineTitles(recorder) == std::vector<std::string>{"At the engine"});

    checkDone(queueing(server, id, kPhone, librarySet(structure, "ordinals", {1})));
    CHECK(queuedIn(recorder, id) ==
          std::vector<std::string>{"Queued A", "Queued B", libraryName(1)});
    checkDone(moving(server, id, kPhone, 2, 0, queueRevisionOf(recorder, id)));
    checkDone(removing(server, id, kPhone, 1, queueRevisionOf(recorder, id)));
    CHECK(queuedIn(recorder, id) == std::vector<std::string>{libraryName(1), "Queued B"});
    checkDone(clearing(server, id, kPhone));
    CHECK(queuedIn(recorder, id).empty());

    CHECK(recorder.calls() == 0);
}

// Each of the five queue routes answers a stranger as it answers an unknown session.
TEST_CASE("a private session's queue is 404 on every queue route to a stranger and to no device") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto id = createdId(server, kPhone);
    queueIn(recorder, id, {"Queued A", "Queued B"});
    const auto revision = queueRevisionOf(recorder, id);
    const auto unknown = unknownSessionAnswer(server);

    const std::vector<QueueRoute> routes{
        {"read", [&](const std::string& s,
                     const std::string& d) { return get(server, scoped(kQueue, s, d)); }},
        {"queue tracks",
         [&](const std::string& s, const std::string& d) {
             return queueing(server, s, d, librarySet(structure, "ordinals", {1}));
         }},
        {"move", [&](const std::string& s,
                     const std::string& d) { return moving(server, s, d, 0, 1, revision); }},
        {"remove", [&](const std::string& s,
                       const std::string& d) { return removing(server, s, d, 0, revision); }},
        {"clear",
         [&](const std::string& s, const std::string& d) { return clearing(server, s, d); }},
    };

    for (const auto& route : routes) {
        CAPTURE(route.name);
        for (const char* device : {kLaptop, ""}) {
            CAPTURE(device);
            checkSameAnswer(route.send(id, device), unknown);
        }
        checkSameAnswer(route.send("Zz00q", kPhone), unknown);
    }

    CHECK(queuedIn(recorder, id) == std::vector<std::string>{"Queued A", "Queued B"});
    CHECK(queueRevisionOf(recorder, id) == revision);
    CHECK(recorder.libraryTaken().empty());
    CHECK(recorder.queueReads() == 0);
    CHECK(recorder.calls() == 0);
}

namespace {

constexpr char kPlaySet[] = "/api/playback/play";

constexpr char kNameADetachedSession[] =
    "the engine session plays a playlist row; name a detached session";

json fromIndex(json body, const json& index) {
    body["index"] = index;
    return body;
}

httplib::Result playing(const TestServer& server, const std::string& session,
                        const std::string& deviceId, const json& body) {
    return post(server, scoped(kPlaySet, session, deviceId), body.dump());
}

std::string libraryPathOfOrdinal(uint32_t ordinal) {
    return libraryPathOf(track(libraryName(ordinal)));
}

}  // namespace

// `runs` and `bitset` decode sorted, so each set's second track is a different ordinal from the
// one `ordinals` would name at index 1. The bitset 0x42 holds ordinals 1 and 6.
TEST_CASE("a library set played in a session plays from its index, whichever form carries it") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto other = createdId(server, kPhone);

    struct Form {
        const char* name;
        json selection;
        std::vector<uint32_t> ordinals;
    };

    for (const auto& form :
         {Form{"ordinals", {5, 2, 7}, {5, 2, 7}}, Form{"runs", json::array({{3, 2}}), {3, 4}},
          Form{"bitset", "Qg==", {1, 6}}}) {
        CAPTURE(form.name);
        const auto id = createdId(server, kPhone);
        const auto ears = listening(recorder, id, kPhone);
        const auto asked = recorder.libraryTaken().size();

        checkDone(playing(server, id, kPhone,
                          fromIndex(librarySet(structure, form.name, form.selection), 1)));

        const auto taken = recorder.libraryTaken();
        REQUIRE(taken.size() == asked + 1);
        CHECK(taken.back() == LibraryTake{structure, form.ordinals});

        const auto session = documentOf(server, id, kPhone);
        CHECK(session["playback"] == "playing");
        CHECK(session["libraryPath"] == libraryPathOfOrdinal(form.ordinals[1]));
    }

    CHECK(documentOf(server, other, kPhone)["playback"] == "stopped");
    CHECK(recorder.taken().empty());
    CHECK(recorder.calls() == 0);
}

// The set is taken once, at the play, so a library answering otherwise later changes nothing
// that plays.
TEST_CASE(
    "a session plays on through the library set it took after the library answers otherwise") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto id = createdId(server, kPhone);

    checkDone(
        playing(server, id, kPhone, fromIndex(librarySet(structure, "ordinals", {1, 2, 3}), 0)));
    recorder.answerLibraryWith("Rebuilt");
    checkDone(post(server, scoped(kNext, id, kPhone), ""));

    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOfOrdinal(2));
    CHECK(recorder.libraryTaken().size() == 1);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a library set naming no session or the engine session is 409 and takes nothing") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    createdId(server, kPhone);
    const auto body = fromIndex(librarySet(structure, "ordinals", {1, 2}), 0);

    const auto unnamed = playing(server, "", "", body);
    REQUIRE(unnamed);
    CHECK(unnamed->status == 409);
    CHECK(errorOf(*unnamed) == kNameADetachedSession);
    checkSameAnswer(playing(server, kEngineSessionId, kPhone, body), unnamed);

    CHECK(recorder.libraryTaken().empty());
    CHECK(recorder.calls() == 0);
}

// The library can rebuild between the route's check and the take, so the taker's structureMoved
// is answered as the route answers a structure already stale.
TEST_CASE("a library set played in a session is the fill's 409 for a library that moved on") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto exported = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto id = createdId(server, kPhone);
    const auto body = fromIndex(librarySet(exported, "ordinals", {1, 2}), 0);

    recorder.moveTheLibrary();
    const auto duringTheTake = playing(server, id, kPhone, body);
    REQUIRE(duringTheTake);
    CHECK(duringTheTake->status == 409);
    CHECK(errorOf(*duringTheTake) == describe(DeltaOutcome::structureChanged));
    CHECK(recorder.libraryTaken().size() == 1);

    buildLibrary(library, kLibraryTracks - 2);
    const auto beforeTheTake = playing(server, id, kPhone, body);
    REQUIRE(beforeTheTake);
    CHECK(beforeTheTake->status == 409);
    CHECK(errorOf(*beforeTheTake) == describe(DeltaOutcome::structureChanged));
    CHECK(recorder.libraryTaken().size() == 1);

    CHECK(documentOf(server, id, kPhone)["playback"] == "stopped");
    CHECK(recorder.calls() == 0);
}

// The set's size is known from the request, so an index past it is refused before the library is
// asked. An empty set is accepted by the fill's parse, so it is refused here by its index.
TEST_CASE("an index past the library set, an empty set included, is the row play's 400") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto id = createdId(server, kPhone);

    for (const auto& body : {fromIndex(librarySet(structure, "ordinals", {1, 2}), 2),
                             fromIndex(librarySet(structure, "ordinals", json::array()), 0),
                             fromIndex(librarySet(structure, "bitset", "AA=="), 0)}) {
        CAPTURE(body.dump());
        const auto response = playing(server, id, kPhone, body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == describe(PlayerOutcome::positionPastEnd));
    }

    CHECK(recorder.libraryTaken().empty());
    CHECK(documentOf(server, id, kPhone)["playback"] == "stopped");
    CHECK(recorder.calls() == 0);
}

// `title` and `duplicates` belong to a fill and to nothing a session plays.
TEST_CASE("a library set carrying a field the play does not take, or no usable index, is a 400") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto id = createdId(server, kPhone);
    const auto set = fromIndex(librarySet(structure, "ordinals", {1, 2}), 0);

    const std::vector<std::pair<std::string, json>> undeclared{
        {"title", "Mix"}, {"duplicates", "add"}, {"playlistId", kPlaylistId}};
    for (const auto& field : undeclared) {
        CAPTURE(field.first);
        auto body = set;
        body[field.first] = field.second;
        const auto response = playing(server, id, kPhone, body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == describe(PlaylistRefusal::malformedBody));
    }

    for (const auto& index : {json("1"), json(-1), json(1.5), json(nullptr)}) {
        CAPTURE(index.dump());
        const auto response = playing(server, id, kPhone,
                                      fromIndex(librarySet(structure, "ordinals", {1, 2}), index));
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK_FALSE(errorOf(*response).empty());
    }

    CHECK(recorder.libraryTaken().empty());
    CHECK(documentOf(server, id, kPhone)["playback"] == "stopped");
    CHECK(recorder.calls() == 0);
}

TEST_CASE("with controlPlayback off, a library set still plays in a detached session") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library, nullptr,
                                          parseSettings(R"({"controlPlayback": false})"));
    const auto id = createdId(server, kPhone);

    checkDone(playing(server, id, kPhone, fromIndex(librarySet(structure, "ordinals", {4, 3}), 1)));

    CHECK(documentOf(server, id, kPhone)["libraryPath"] == libraryPathOfOrdinal(3));
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a library set naming a private session is 404 to a stranger and to no device") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library);
    const auto id = createdId(server, kPhone);
    const auto body = fromIndex(librarySet(structure, "ordinals", {1, 2}), 0);
    const auto unknown = unknownSessionAnswer(server);

    for (const char* device : {kLaptop, ""}) {
        CAPTURE(device);
        checkSameAnswer(playing(server, id, device, body), unknown);
    }
    checkSameAnswer(playing(server, "Zz00q", kPhone, body), unknown);

    CHECK(recorder.libraryTaken().empty());
    CHECK(documentOf(server, id, kPhone)["playback"] == "stopped");
    CHECK(recorder.calls() == 0);
}

namespace {

constexpr char kPlayingTrack[] = "/api/track/playing";
constexpr char kPlayingCover[] = "/api/artwork/playing";

constexpr char kTitleColumn[] = "%title%";
constexpr char kArtistColumn[] = "%artist%";

// Both columns, percent-encoded as a client sends them.
constexpr char kTwoColumns[] = "columns=%25title%25&columns=%25artist%25";

constexpr char kAskEveryTime[] = "private, no-cache";

const std::string& engineCover() {
    static const std::string cover = std::string("\x89PNG\r\n\x1A\n") + "the engine's own cover";
    return cover;
}

std::string playingTrackOf(const std::string& session, const std::string& deviceId) {
    return withQuery(scoped(kPlayingTrack, session, deviceId), kTwoColumns);
}

std::string playingCoverOf(const std::string& session, const std::string& deviceId) {
    return scoped(kPlayingCover, session, deviceId);
}

httplib::Result coverHolding(const TestServer& server, const std::string& path,
                             const std::string& tag) {
    return server.client().Get(path, httplib::Headers{{"If-None-Match", tag}});
}

// The playing cover is held by the engine's own NowPlayingArtwork, which no session may touch.
TestServer servingCovers(const Player& player, NowPlayingArtwork* engine) {
    return TestServer(servingSettings(), player, nullptr, scriptedMint(), nullptr, engine);
}

std::string bodyText(const httplib::Result& response) {
    return response ? response->body : std::string();
}

json bodyOf(const httplib::Result& response) {
    REQUIRE(response);
    return json::parse(response->body);
}

// How many of `attempts` identical requests were refused for arriving too fast, and the sentence
// the last refusal gave. Kept rather than asserted inside the loop, so how many refusals a
// machine's speed produces cannot change how many assertions the suite runs.
struct Refusals {
    int count = 0;
    std::string error;
};

Refusals askRepeatedly(const TestServer& server, const std::string& path, int attempts) {
    auto client = server.client();
    Refusals refusals;
    for (int attempt = 0; attempt < attempts; ++attempt) {
        const auto response = client.Get(path);
        if (!response || response->status != 429)
            continue;
        ++refusals.count;
        refusals.error = errorOf(*response);
    }
    return refusals;
}

}  // namespace

TEST_CASE("a session's playing track answers its own track's path, subsong and columns") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    auto rows = tracks("Road", kRows);
    rows[2].subsong = 4;
    const auto other = playingSession(server, recorder, kPhone, tracks("Other", kRows), 0);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);

    const auto response = get(server, playingTrackOf(id, kPhone));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(bodyOf(response) ==
          json{{"path", rows[2].path},
               {"subsong", 4},
               {"columns", {"%title% of " + nameOf(rows[2]), "%artist% of " + nameOf(rows[2])}}});
    CHECK(response->get_header_value("Cache-Control") == kAskEveryTime);
    CHECK_FALSE(response->has_header("ETag"));
    REQUIRE_FALSE(recorder.trackColumns().empty());
    CHECK(recorder.trackColumns().back() == std::vector<std::string>{kTitleColumn, kArtistColumn});

    CHECK(bodyOf(get(server, playingTrackOf(other, kPhone)))["path"] == track("Other 0").path);

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    const auto moved = bodyOf(get(server, playingTrackOf(id, kPhone)));
    CHECK(moved["path"] == rows[3].path);
    CHECK(moved["columns"][0] == "%title% of " + nameOf(rows[3]));

    CHECK(recorder.calls() == 0);
}

// The poll says paused and the track is still loaded, so a paused session answers as the engine's
// paused player does.
TEST_CASE("a paused session's playing track is answered, and a stopped one is the engine's 404") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto fresh = createdId(server, kPhone);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    const auto ears = listening(recorder, id, kPhone);

    checkDone(post(server, scoped(kPlayPause, id, kPhone), ""));
    const auto paused = get(server, playingTrackOf(id, kPhone));
    REQUIRE(paused);
    CHECK(paused->status == 200);
    CHECK(bodyOf(paused)["path"] == rows[2].path);

    checkDone(post(server, scoped(kStop, id, kPhone), ""));
    const auto readsBefore = recorder.trackReads().size();

    for (const auto& session : {id, fresh}) {
        CAPTURE(session);
        const auto response = get(server, playingTrackOf(session, kPhone));
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(bodyOf(response) == json{{"error", "nothing is playing"}});
        CHECK(response->get_header_value("Cache-Control") == kAskEveryTime);
    }

    CHECK(recorder.trackReads().size() == readsBefore);
    CHECK(recorder.calls() == 0);
}

// cpp-httplib drops a query pair whose raw text repeats an earlier one, so a repeat is spelled
// twice to arrive twice: %74 is `t`.
TEST_CASE("a column list the engine's playing track refuses is refused naming a session too") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);
    const auto readsBefore = recorder.trackReads().size();

    auto raw = server.client();
    raw.set_path_encode(false);

    for (const std::string query :
         {"", "columns=%25title%25&columns=", "columns=%25title%25&columns=%25%74itle%25"}) {
        CAPTURE(query);
        const auto engine =
            raw.Get(std::string(kPlayingTrack) + (query.empty() ? "" : "?" + query));
        REQUIRE(engine);
        CHECK(engine->status == 400);

        const auto session =
            raw.Get(scoped(kPlayingTrack, id, kPhone) + (query.empty() ? "" : "&" + query));
        checkSameAnswer(session, engine);
    }

    CHECK(recorder.trackReads().size() == readsBefore);
    CHECK(recorder.calls() == 0);
}

// track_route_test.cpp, unchanged, is the full proof; this is that naming the engine is the same
// request as naming nothing.
TEST_CASE("the playing track naming no session or the engine session reads the engine's track") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);
    const auto readsBefore = recorder.trackReads().size();

    const auto unnamed = get(server, withQuery(kPlayingTrack, kTwoColumns));
    REQUIRE(unnamed);
    CHECK(unnamed->status == 200);
    CHECK(bodyOf(unnamed)["path"] == kEnginePlayingPath);
    CHECK(recorder.calls() == 1);

    checkSameAnswer(get(server, playingTrackOf(kEngineSessionId, kPhone)), unnamed);
    CHECK(recorder.calls() == 2);
    CHECK(recorder.trackReads().size() == readsBefore);
}

TEST_CASE("a session's playing cover is the one read off its track, sent as the engine sends one") {
    Recorder recorder;
    NowPlayingArtwork engine;
    engine.hold(engineCover());
    const TestServer server = servingCovers(recorder.player(), &engine);
    const auto rows = tracks("Road", kRows);
    const auto other = playingSession(server, recorder, kPhone, tracks("Other", kRows), 0);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);

    const auto response = get(server, playingCoverOf(id, kPhone));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->body == coverOf(nameOf(rows[2])));
    CHECK(response->get_header_value("Content-Type") == "image/jpeg");
    CHECK(response->get_header_value("ETag") == artworkTag(coverOf(nameOf(rows[2]))));
    CHECK(response->get_header_value("Cache-Control") == kAskEveryTime);

    const auto others = get(server, playingCoverOf(other, kPhone));
    REQUIRE(others);
    CHECK(others->status == 200);
    CHECK(others->body == coverOf("Other 0"));

    CHECK(recorder.artworkReads() == std::vector<std::string>{nameOf(rows[2]), "Other 0"});
    CHECK(engine.current().tag == artworkTag(engineCover()));
    CHECK(recorder.calls() == 0);
}

// artwork_test.cpp, unchanged, is the full proof; this is that naming the engine is the same
// request as naming nothing, and that neither reads a session's cover.
TEST_CASE("the playing cover naming no session or the engine session is the engine's held cover") {
    Recorder recorder;
    NowPlayingArtwork engine;
    engine.hold(engineCover());
    const TestServer server = servingCovers(recorder.player(), &engine);
    playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);

    const auto unnamed = get(server, kPlayingCover);
    REQUIRE(unnamed);
    CHECK(unnamed->status == 200);
    CHECK(unnamed->body == engineCover());
    CHECK(unnamed->get_header_value("Content-Type") == "image/png");

    checkSameAnswer(get(server, playingCoverOf(kEngineSessionId, kPhone)), unnamed);
    CHECK(recorder.artworkReads().empty());
    CHECK(recorder.calls() == 0);
}

// A pause and a seek keep the track, and a conditional request is answered from what is held.
TEST_CASE("a session's cover is read once for each track however often it is asked for") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    const auto ears = listening(recorder, id, kPhone);
    const auto path = playingCoverOf(id, kPhone);

    const auto first = get(server, path);
    REQUIRE(first);
    REQUIRE(first->status == 200);
    CHECK(statusOf(get(server, path)) == 200);

    checkDone(post(server, scoped(kPlayPause, id, kPhone), ""));
    CHECK(statusOf(get(server, path)) == 200);
    checkDone(post(server, scoped(kPlayPause, id, kPhone), ""));
    checkDone(post(server, scoped(kSeek, id, kPhone), R"({"seconds": 42})"));
    CHECK(bodyText(get(server, path)) == coverOf(nameOf(rows[2])));
    CHECK(statusOf(coverHolding(server, path, first->get_header_value("ETag"))) == 304);

    CHECK(recorder.artworkReads() == std::vector<std::string>{nameOf(rows[2])});

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    CHECK(bodyText(get(server, path)) == coverOf(nameOf(rows[3])));
    CHECK(bodyText(get(server, path)) == coverOf(nameOf(rows[3])));

    CHECK(recorder.artworkReads() == std::vector<std::string>{nameOf(rows[2]), nameOf(rows[3])});
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a client holding a session's cover is answered 304 until the track changes") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    const auto path = playingCoverOf(id, kPhone);

    const auto first = get(server, path);
    REQUIRE(first);
    REQUIRE(first->status == 200);
    const auto tag = first->get_header_value("ETag");

    const auto again = coverHolding(server, path, tag);
    REQUIRE(again);
    CHECK(again->status == 304);
    CHECK(again->body.empty());
    CHECK(again->get_header_value("ETag") == tag);
    CHECK(again->get_header_value("Cache-Control") == kAskEveryTime);

    checkDone(post(server, scoped(kNext, id, kPhone), ""));

    const auto moved = coverHolding(server, path, tag);
    REQUIRE(moved);
    CHECK(moved->status == 200);
    CHECK(moved->body == coverOf(nameOf(rows[3])));
    CHECK(moved->get_header_value("ETag") == artworkTag(coverOf(nameOf(rows[3]))));
    CHECK(recorder.calls() == 0);
}

// A track with no cover is read once as well: answering nothing is an answer to hold.
TEST_CASE("a stopped session, and a track with no cover, are the engine's 404 for no cover") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto fresh = createdId(server, kPhone);
    const auto stopped = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);
    checkDone(post(server, scoped(kStop, stopped, kPhone), ""));

    for (const auto& session : {fresh, stopped}) {
        CAPTURE(session);
        const auto response = get(server, playingCoverOf(session, kPhone));
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(bodyOf(response) == json{{"error", "no artwork for that track"}});
        CHECK_FALSE(response->has_header("ETag"));
    }
    CHECK(recorder.artworkReads().empty());

    const auto bareFirst =
        playingSession(server, recorder, kPhone, {track("Bare 0"), track("Road with a cover")}, 0);
    for (int ask = 0; ask < 2; ++ask) {
        CAPTURE(ask);
        const auto response = get(server, playingCoverOf(bareFirst, kPhone));
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(bodyOf(response) == json{{"error", "no artwork for that track"}});
    }
    CHECK(recorder.artworkReads() == std::vector<std::string>{"Bare 0"});

    checkDone(post(server, scoped(kNext, bareFirst, kPhone), ""));
    CHECK(bodyText(get(server, playingCoverOf(bareFirst, kPhone))) == coverOf("Road with a cover"));
    CHECK(recorder.calls() == 0);
}

// The track the session moves to has no cover, so a session still serving or validating what it
// held for the track before answers that track's picture where the player has none.
TEST_CASE("a session's held cover goes with its track, so the next track with none is a 404") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id =
        playingSession(server, recorder, kPhone, {track("Road with a cover"), track("Bare 1")}, 0);
    const auto path = playingCoverOf(id, kPhone);

    const auto first = get(server, path);
    REQUIRE(first);
    REQUIRE(first->status == 200);
    REQUIRE(first->body == coverOf("Road with a cover"));
    const auto tag = first->get_header_value("ETag");

    checkDone(post(server, scoped(kNext, id, kPhone), ""));

    const auto plain = get(server, path);
    REQUIRE(plain);
    CHECK(plain->status == 404);
    CHECK(bodyOf(plain) == json{{"error", "no artwork for that track"}});
    CHECK_FALSE(plain->has_header("ETag"));

    const auto holding = coverHolding(server, path, tag);
    REQUIRE(holding);
    CHECK(holding->status == 404);
    CHECK(bodyOf(holding) == json{{"error", "no artwork for that track"}});

    CHECK(recorder.artworkReads() == std::vector<std::string>{"Road with a cover", "Bare 1"});
    CHECK(recorder.calls() == 0);
}

// artwork_test.cpp holds the engine's own refusal; this is that a session's cover answers the same
// one, and that the refusal is held for the track like any other answer.
TEST_CASE("a session's cover a byte past kMaxArtworkBytes is the engine's 413, read once a track") {
    Recorder recorder;
    NowPlayingArtwork engine;
    engine.hold(pictureOf("Oversized at the engine"));
    const TestServer server = servingCovers(recorder.player(), &engine);
    const auto id = playingSession(server, recorder, kPhone,
                                   {track("Oversized 0"), track("Road with a cover")}, 0);
    const auto path = playingCoverOf(id, kPhone);

    const auto engines = get(server, kPlayingCover);
    REQUIRE(engines);
    REQUIRE(engines->status == 413);

    for (int ask = 0; ask < 2; ++ask) {
        CAPTURE(ask);
        const auto response = get(server, path);
        REQUIRE(response);
        CHECK(response->status == 413);
        CHECK(bodyOf(response) == json{{"error", kArtworkTooLarge}});
        CHECK_FALSE(response->has_header("ETag"));
        checkSameAnswer(response, engines);
    }
    CHECK(recorder.artworkReads() == std::vector<std::string>{"Oversized 0"});

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    CHECK(bodyText(get(server, path)) == coverOf("Road with a cover"));
    CHECK(recorder.artworkReads() == std::vector<std::string>{"Oversized 0", "Road with a cover"});
    CHECK(recorder.calls() == 0);
}

// A 413 carries no tag, so the only tag a client can send is one an earlier cover gave it.
TEST_CASE("a client holding the last track's cover tag is refused the next track's oversized one") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone,
                                   {track("Road with a cover"), track("Oversized 1")}, 0);
    const auto path = playingCoverOf(id, kPhone);

    const auto first = get(server, path);
    REQUIRE(first);
    REQUIRE(first->status == 200);
    const auto tag = first->get_header_value("ETag");

    checkDone(post(server, scoped(kNext, id, kPhone), ""));

    const auto holding = coverHolding(server, path, tag);
    REQUIRE(holding);
    CHECK(holding->status == 413);
    CHECK(bodyOf(holding) == json{{"error", kArtworkTooLarge}});
    CHECK_FALSE(holding->has_header("ETag"));
    CHECK(recorder.calls() == 0);
}

// routes_artwork.cpp's sendArtwork compares the tag before it judges the size, so the engine
// answers a matching tag 304 whatever the picture's size; a session keeps the same order.
TEST_CASE("a session answers a matching tag 304 before it judges the size, as the engine does") {
    Recorder recorder;
    NowPlayingArtwork engine;
    engine.hold(pictureOf("Oversized 0"));
    const TestServer server = servingCovers(recorder.player(), &engine);
    const auto id = playingSession(server, recorder, kPhone, {track("Oversized 0")}, 0);
    const auto tag = artworkTag(pictureOf("Oversized 0"));

    const auto engines = coverHolding(server, kPlayingCover, tag);
    REQUIRE(engines);
    REQUIRE(engines->status == 304);

    const auto sessions = coverHolding(server, playingCoverOf(id, kPhone), tag);
    REQUIRE(sessions);
    CHECK(sessions->status == engines->status);
    CHECK(sessions->body.empty());
    CHECK(sessions->get_header_value("ETag") == tag);
    CHECK(recorder.artworkReads() == std::vector<std::string>{"Oversized 0"});
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a session's cover exactly kMaxArtworkBytes long is sent whole") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, {track("Full 0")}, 0);

    const auto response = get(server, playingCoverOf(id, kPhone));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->body.size() == kMaxArtworkBytes);
    CHECK(response->body == pictureOf("Full 0"));
    CHECK(response->get_header_value("Content-Type") == "image/jpeg");
    CHECK(response->get_header_value("ETag") == artworkTag(pictureOf("Full 0")));
    CHECK(recorder.calls() == 0);
}

// The player loads a file's info some time after the file starts, so the columns can be answered
// before the names can.
TEST_CASE("a session's playing track answers its columns where the player could not read names") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    recorder.cannotName(nameOf(rows[2]), PlayerOutcome::done);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);

    const auto response = get(server, playingTrackOf(id, kPhone));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(bodyOf(response) ==
          json{{"path", rows[2].path}, {"subsong", 0}, {"columns", {"?", "?"}}});
    CHECK(recorder.calls() == 0);
}

TEST_CASE(
    "a session's poll answers null names and asks again each poll until the player has them") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    recorder.cannotName(nameOf(rows[2]), PlayerOutcome::done);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    const auto ears = listening(recorder, id, kPhone);
    const auto readsBefore = recorder.trackReads().size();

    for (size_t poll = 1; poll <= 3; ++poll) {
        CAPTURE(poll);
        const auto player = playerPolled(server, id, kPhone);
        CHECK(player["playback"] == "playing");
        for (const char* key : {"title", "artist", "album", "albumArtist"}) {
            CAPTURE(key);
            CHECK(player[key].is_null());
        }
        CHECK(recorder.trackReads().size() == readsBefore + poll);
    }

    recorder.canName(nameOf(rows[2]));

    CHECK(playerPolled(server, id, kPhone)["title"] == nameOf(rows[2]));
    CHECK(playerPolled(server, id, kPhone)["artist"] == "Artist of " + nameOf(rows[2]));
    CHECK(recorder.trackReads().size() == readsBefore + 4);
    CHECK(recorder.calls() == 0);
}

TEST_CASE(
    "a session's track read that times out is the route's failure, and null names asked again on "
    "the poll") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    recorder.cannotName(nameOf(rows[2]), PlayerOutcome::timedOut);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);

    const auto response = get(server, playingTrackOf(id, kPhone));
    REQUIRE(response);
    CHECK(response->status == httpStatusFor(PlayerOutcome::timedOut));
    CHECK(errorOf(*response) == describe(PlayerOutcome::timedOut));

    const auto readsBefore = recorder.trackReads().size();
    for (size_t poll = 1; poll <= 2; ++poll) {
        CAPTURE(poll);
        CHECK(playerPolled(server, id, kPhone)["title"].is_null());
        CHECK(recorder.trackReads().size() == readsBefore + poll);
    }
    CHECK(recorder.calls() == 0);
}

// A request with no deviceId is from no member.
TEST_CASE(
    "a private session's playing track and cover are 404 to a stranger, and nothing is read") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);
    const auto readsBefore = recorder.trackReads().size();
    const auto unknown = unknownSessionAnswer(server);

    for (const char* device : {kLaptop, ""}) {
        CAPTURE(device);
        checkSameAnswer(get(server, playingTrackOf(id, device)), unknown);
        checkSameAnswer(get(server, playingCoverOf(id, device)), unknown);
    }
    checkSameAnswer(get(server, playingTrackOf("Zz00q", kPhone)), unknown);
    checkSameAnswer(get(server, playingCoverOf("Zz00q", kPhone)), unknown);

    CHECK(recorder.trackReads().size() == readsBefore);
    CHECK(recorder.artworkReads().empty());
    CHECK(recorder.calls() == 0);
}

// The server's clock stands still, so once the engine's reads have spent the budget nothing refills
// it. A session spending a budget of its own would be answered.
TEST_CASE("a session's playing track spends the budget the engine's playing track spends") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);
    const auto readsBefore = recorder.trackReads().size();

    const auto engine = askRepeatedly(server, withQuery(kPlayingTrack, kTwoColumns), 120);
    REQUIRE(engine.count > 0);

    const auto session = get(server, playingTrackOf(id, kPhone));
    REQUIRE(session);
    CHECK(session->status == 429);
    CHECK(errorOf(*session) == "too many track reads");
    CHECK(recorder.trackReads().size() == readsBefore);
}

TEST_CASE("a session's playing cover spends the budget the engine's playing cover spends") {
    Recorder recorder;
    NowPlayingArtwork engineHeld;
    engineHeld.hold(engineCover());
    const TestServer server = servingCovers(recorder.player(), &engineHeld);
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);

    const auto session = askRepeatedly(server, playingCoverOf(id, kPhone), 600);
    REQUIRE(session.count > 0);
    CHECK(session.error == "too many artwork requests");

    const auto engine = get(server, kPlayingCover);
    REQUIRE(engine);
    CHECK(engine->status == 429);
    CHECK(errorOf(*engine) == "too many artwork requests");
    CHECK(recorder.artworkReads().size() == 1);
}

namespace {

// A session whose current turn has thrown, from the decoder or from the chain per `from`.
AfterThrow failTheTurn(Session& session, Thrower from) {
    const auto turn = session.turn();
    REQUIRE(turn.has_value());
    return session.threw(turn->serial, from, Session::Clock::time_point{});
}

json reportOf(uint64_t sequence, const char* kind, const SessionTrack& on) {
    return json{{"sequence", sequence},
                {"kind", kind},
                {"path", on.path},
                {"subsong", on.subsong},
                {"libraryPath", on.libraryPath ? json(*on.libraryPath) : json(nullptr)}};
}

}  // namespace

TEST_CASE("a session's document reports each failure with the track it happened on, oldest first") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    auto rows = tracks("Road", kRows);
    rows[0].libraryPath.reset();
    rows[0].subsong = 2;
    rows[1].subsong = 5;
    const auto id = playingSession(server, recorder, kPhone, rows, 0);
    const auto session = recorder.session(id);

    REQUIRE(failTheTurn(*session, Thrower::decoder) == AfterThrow::skipTrack);

    const auto undecodable = documentOf(server, id, kPhone);
    CHECK(undecodable["reports"] == json::array({reportOf(1, "undecodable", rows[0])}));
    CHECK(undecodable["reports"][0]["libraryPath"].is_null());
    CHECK(undecodable["chainDropped"] == false);

    REQUIRE(failTheTurn(*session, Thrower::chain) == AfterThrow::dropChain);

    const auto dropped = documentOf(server, id, kPhone);
    CHECK(dropped["reports"] ==
          json::array({reportOf(1, "undecodable", rows[0]), reportOf(2, "chainDropped", rows[1])}));
    CHECK(dropped["chainDropped"] == true);
    for (const auto& report : dropped["reports"]) {
        CAPTURE(report.dump());
        CHECK(keysOf(report) == Keys{"sequence", "kind", "path", "subsong", "libraryPath"});
    }

    CHECK(sessionsSeenBy(server, kPhone)[1] == dropped);
    checkSameAnswer(read(server, id, kLaptop), unknownSessionAnswer(server));
    CHECK(recorder.calls() == 0);
}

// Twelve rows, so nine failures in a row never stop the session.
TEST_CASE("a session's document holds its last eight reports, the ninth dropping the first") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", 12);
    const auto id = playingSession(server, recorder, kPhone, rows, 0);
    const auto session = recorder.session(id);

    for (int i = 0; i < 9; ++i)
        REQUIRE(failTheTurn(*session, Thrower::decoder) == AfterThrow::skipTrack);

    json expected = json::array();
    for (size_t row = 1; row <= 8; ++row)
        expected.push_back(reportOf(row + 1, "undecodable", rows[row]));

    CHECK(documentOf(server, id, kPhone)["reports"] == expected);
    CHECK(recorder.calls() == 0);
}

// A chain report changes nothing else the poll answers, so the tag moving there is the report's.
TEST_CASE("a session's poll moves sessionRevision and its tag for each report") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 1);
    const auto session = recorder.session(id);

    const auto start = poll(server, id, kPhone);
    const auto startTag = tagOf(start);
    const auto startRevision = bodyOf(start)["player"]["sessionRevision"];

    REQUIRE(failTheTurn(*session, Thrower::chain) == AfterThrow::dropChain);
    const auto dropped = pollHolding(server, id, kPhone, startTag);
    checkMoved(dropped, startTag);
    const auto droppedRevision = bodyOf(dropped)["player"]["sessionRevision"];
    CHECK(droppedRevision > startRevision);

    const auto droppedTag = tagOf(dropped);
    REQUIRE(failTheTurn(*session, Thrower::decoder) == AfterThrow::skipTrack);
    const auto undecodable = pollHolding(server, id, kPhone, droppedTag);
    checkMoved(undecodable, droppedTag);
    CHECK(bodyOf(undecodable)["player"]["sessionRevision"] > droppedRevision);
    CHECK(recorder.calls() == 0);
}

namespace {

TestServer cappedAt(const Player& player, int maxSessions) {
    return serving(player, nullptr, scriptedMint(),
                   parseSettings(R"({"maxSessions": )" + std::to_string(maxSessions) + "}"));
}

}  // namespace

// The engine session exists beside the one detached session the cap of one allows.
TEST_CASE("one past maxSessions is 503 'too many sessions', and leaves the sessions as they were") {
    Recorder recorder;
    const TestServer server = cappedAt(recorder.player(), 1);

    const auto id = createdId(server, kPhone);

    for (const char* device : {kLaptop, kPhone}) {
        CAPTURE(device);
        const auto refused = create(server, json{{"deviceId", device}, {"name", "Kitchen phone"}});
        REQUIRE(refused);
        CHECK(refused->status == 503);
        CHECK(errorOf(*refused) == "too many sessions");
    }

    CHECK(idsSeenBy(server, kPhone) == std::vector<std::string>{kEngineSessionId, id});
    CHECK(idsSeenBy(server, kLaptop) == engineOnly());

    // A capability, not a vacancy: creating is still possible here once a place is free.
    const auto capabilities = capabilitiesOf(server);
    CHECK(capabilities["maxSessions"] == 1);
    CHECK(capabilities["canCreateSessions"] == true);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a session reaped once its grace runs out gives its place under the cap back") {
    Recorder recorder;
    const TestServer server = cappedAt(recorder.player(), 1);
    createdId(server, kPhone);

    server.advanceClock(std::chrono::minutes(14));
    CHECK(statusOf(create(server, json{{"deviceId", kLaptop}})) == 503);

    server.advanceClock(std::chrono::minutes(2));
    const auto laptops = create(server, json{{"deviceId", kLaptop}});
    REQUIRE(laptops);
    CHECK(laptops->status == 200);
    CHECK(idsSeenBy(server, kLaptop) ==
          std::vector<std::string>{kEngineSessionId, bodyOf(laptops)["id"].get<std::string>()});
    CHECK(recorder.calls() == 0);
}

// No route here leaves a session: POST /api/stream/leave is the stream group's. The leave is the
// one that route makes on the session.
TEST_CASE("a session its last member left gives its place under the cap back") {
    Recorder recorder;
    const TestServer server = cappedAt(recorder.player(), 1);
    const auto id = createdId(server, kPhone);

    recorder.session(id)->leave(kPhone);

    CHECK(statusOf(create(server, json{{"deviceId", kLaptop}})) == 200);
    CHECK(recorder.calls() == 0);
}

// The player's routes read no session, so one named there is never looked up: an id nobody issued
// is no 404 on them, and each request reaches the player as one naming none does.
TEST_CASE(
    "POST /api/volume and POST /api/outputs/active answer the same naming any session or none") {
    Recorder recorder;
    auto player = recorder.player();
    player.outputs.list = [] {
        OutputsRead read;
        read.devices = {{kSpeakers, "Speakers (Fictional Audio)"}};
        read.active = std::string(kSpeakers);
        return read;
    };
    const TestServer server = serving(player);
    const auto id = createdId(server, kPhone);

    const std::vector<Route> routes{{"/api/volume", R"({"muted": true})"},
                                    {"/api/outputs/active", json{{"deviceId", kSpeakers}}.dump()}};

    for (const auto& route : routes) {
        CAPTURE(route.path);
        const auto before = recorder.calls();
        const auto unnamed = post(server, route.path, route.body);
        REQUIRE(accepted(unnamed));

        for (const std::string& session :
             {id, std::string("Zz00q"), std::string(kEngineSessionId)}) {
            CAPTURE(session);
            checkSameAnswer(command(server, route, session, kPhone), unnamed);
        }
        CHECK(recorder.calls() == before + 4);
    }
}

// The hold is the player's, so the release reads no session either.
TEST_CASE("DELETE /api/stream/hold answers the same naming any session or none, and releases") {
    Recorder recorder;
    auto player = recorder.player();
    std::atomic<int> releases{0};
    player.stream.releaseOutput = [&releases] { ++releases; };
    const TestServer server = serving(player);
    const auto id = createdId(server, kPhone);
    auto client = server.client();

    const auto unnamed = client.Delete("/api/stream/hold");
    REQUIRE(unnamed);
    CHECK(unnamed->status == 204);

    for (const std::string& session : {id, std::string("Zz00q"), std::string(kEngineSessionId)}) {
        CAPTURE(session);
        checkSameAnswer(client.Delete(scoped("/api/stream/hold", session, kPhone)), unnamed);
    }
    CHECK(releases == 4);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("maxSessions at 0 answers every create 503 'sessions are not available'") {
    Recorder recorder;
    const TestServer server = cappedAt(recorder.player(), 0);

    for (const char* device : {kPhone, kLaptop}) {
        CAPTURE(device);
        const auto refused = create(server, json{{"deviceId", device}});
        REQUIRE(refused);
        CHECK(refused->status == 503);
        CHECK(errorOf(*refused) == "sessions are not available");
    }

    const auto capabilities = capabilitiesOf(server);
    CHECK(capabilities["maxSessions"] == 0);
    CHECK(capabilities["canCreateSessions"] == false);
    CHECK(idsSeenBy(server, kPhone) == engineOnly());
    CHECK(recorder.calls() == 0);
}

// controlPlayback governs the engine session alone, creating included.
TEST_CASE("capabilities publish the session cap, and creating where the player streams") {
    Recorder recorder;

    const TestServer defaults = serving(recorder.player());
    const auto offered = capabilitiesOf(defaults);
    CHECK(offered["maxSessions"] == 4);
    CHECK(offered["canStream"] == true);
    CHECK(offered["canCreateSessions"] == true);

    const TestServer uncontrolled = serving(recorder.player(), nullptr, scriptedMint(),
                                            parseSettings(R"({"controlPlayback": false})"));
    CHECK(capabilitiesOf(uncontrolled)["canCreateSessions"] == true);
}

TEST_CASE("a player with no session stream or no stream format cannot create sessions") {
    Recorder recorder;
    auto formatless = recorder.player();
    formatless.stream.formats.clear();

    const TestServer noSessionStream = serving(recorder.player(false));
    const TestServer noFormat = serving(formatless);

    for (const TestServer* server : {&noSessionStream, &noFormat}) {
        const auto capabilities = capabilitiesOf(*server);
        CHECK(capabilities["maxSessions"] == 4);
        CHECK(capabilities["canCreateSessions"] == false);

        const auto refused = create(*server, json{{"deviceId", kPhone}});
        REQUIRE(refused);
        CHECK(refused->status == 503);
        CHECK(errorOf(*refused) == "sessions are not available");
        CHECK(idsSeenBy(*server, kPhone) == engineOnly());
    }
    CHECK(capabilitiesOf(noFormat)["canStream"] == false);
    CHECK(recorder.calls() == 0);
}

// A detached session is heard through the stream and nowhere else.
TEST_CASE("with streaming off, no session can be created and the list still answers the engine") {
    Recorder recorder;
    const TestServer server = serving(recorder.player(), nullptr, scriptedMint(),
                                      parseSettings(R"({"streamingEnabled": false})"));

    const auto capabilities = capabilitiesOf(server);
    CHECK(capabilities["canStream"] == false);
    CHECK(capabilities["canCreateSessions"] == false);

    const auto refused = create(server, json{{"deviceId", kPhone}});
    REQUIRE(refused);
    CHECK(refused->status == 503);
    CHECK(errorOf(*refused) == "sessions are not available");

    CHECK(idsSeenBy(server, kPhone) == engineOnly());
    CHECK(statusOf(read(server, kEngineSessionId, kPhone)) == 200);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a reload turning streaming off refuses the next create, and turning it on allows one") {
    Recorder recorder;
    TestServer server = serving(recorder.player());
    createdId(server, kPhone);

    server.reload(R"({"streamingEnabled": false})");

    CHECK(capabilitiesOf(server)["canCreateSessions"] == false);
    const auto refused = create(server, json{{"deviceId", kLaptop}});
    REQUIRE(refused);
    CHECK(refused->status == 503);
    CHECK(errorOf(*refused) == "sessions are not available");
    CHECK(idsSeenBy(server, kLaptop) == engineOnly());

    server.reload("{}");

    CHECK(capabilitiesOf(server)["canCreateSessions"] == true);
    CHECK(statusOf(create(server, json{{"deviceId", kLaptop}})) == 200);
    CHECK(recorder.calls() == 0);
}

TEST_CASE("a reload moving maxSessions changes nothing until foobar2000 restarts") {
    Recorder recorder;
    TestServer server = cappedAt(recorder.player(), 1);
    createdId(server, kPhone);

    const auto restart = server.reload(R"({"maxSessions": 3})").restartKeys;
    REQUIRE(std::find(restart.begin(), restart.end(), "maxSessions") != restart.end());

    CHECK(capabilitiesOf(server)["maxSessions"] == 1);
    const auto refused = create(server, json{{"deviceId", kLaptop}});
    REQUIRE(refused);
    CHECK(refused->status == 503);
    CHECK(errorOf(*refused) == "too many sessions");
    CHECK(recorder.calls() == 0);
}

namespace {

std::string playbackRead(const TestServer& server, const std::string& id) {
    const auto document = documentOf(server, id, kPhone)["playback"];
    CHECK(playerPolled(server, id, kPhone)["playback"] == document);
    return document.get<std::string>();
}

}  // namespace

TEST_CASE("play-pause on a session nobody hears leaves it set to play, so it plays once heard") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);
    CHECK(playbackRead(server, id) == "paused");

    checkDone(post(server, scoped(kPlayPause, id, kPhone), ""));
    CHECK(playbackRead(server, id) == "paused");

    const auto ears = listening(recorder, id, kPhone);
    CHECK(playbackRead(server, id) == "playing");
    CHECK(recorder.calls() == 0);
}

TEST_CASE("play-pause on a session its controller paused answers 204, and it plays once heard") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);
    auto ears = listening(recorder, id, kPhone);
    checkDone(post(server, scoped(kPlayPause, id, kPhone), ""));
    REQUIRE(playbackRead(server, id) == "paused");
    ears.reset();

    checkDone(post(server, scoped(kPlayPause, id, kPhone), ""));
    CHECK(playbackRead(server, id) == "paused");

    ears = listening(recorder, id, kPhone);
    CHECK(playbackRead(server, id) == "playing");
    CHECK(recorder.calls() == 0);
}

TEST_CASE("play-pause on a session reading playing pauses it, and a reconnect finds it paused") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 2);
    auto ears = listening(recorder, id, kPhone);
    REQUIRE(playbackRead(server, id) == "playing");

    checkDone(post(server, scoped(kPlayPause, id, kPhone), ""));
    CHECK(playbackRead(server, id) == "paused");

    ears.reset();
    ears = listening(recorder, id, kPhone);
    CHECK(playbackRead(server, id) == "paused");
    CHECK(recorder.calls() == 0);
}

TEST_CASE(
    "a listener arriving and leaving moves a session's poll and its tag, not sessionRevision") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = playingSession(server, recorder, kPhone, tracks("Road", kRows), 1);

    const auto unheard = poll(server, id, kPhone);
    const auto unheardTag = tagOf(unheard);
    const auto revision = bodyOf(unheard)["player"]["sessionRevision"];
    CHECK(bodyOf(unheard)["player"]["playback"] == "paused");

    auto ears = listening(recorder, id, kPhone);
    const auto heard = pollHolding(server, id, kPhone, unheardTag);
    checkMoved(heard, unheardTag);
    CHECK(bodyOf(heard)["player"]["playback"] == "playing");
    CHECK(bodyOf(heard)["player"]["sessionRevision"] == revision);

    const auto heardTag = tagOf(heard);
    ears.reset();
    const auto left = pollHolding(server, id, kPhone, heardTag);
    checkMoved(left, heardTag);
    CHECK(bodyOf(left)["player"]["playback"] == "paused");
    CHECK(bodyOf(left)["player"]["sessionRevision"] == revision);
    CHECK(recorder.calls() == 0);
}

TEST_CASE(
    "previous more than three seconds into a session's track answers 204 and plays it from 0") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto rows = tracks("Road", kRows);
    const auto id = playingSession(server, recorder, kPhone, rows, 2);
    checkDone(post(server, scoped(kSeek, id, kPhone), R"({"seconds": 10})"));
    REQUIRE(playerPolled(server, id, kPhone)["position"]["seconds"] == 10);
    const auto seeked = recorder.session(id)->turn();
    REQUIRE(seeked.has_value());

    checkDone(post(server, scoped(kPrevious, id, kPhone), ""));

    const auto player = playerPolled(server, id, kPhone);
    CHECK(player["path"] == rows[2].path);
    CHECK(player["libraryPath"] == libraryPathOf(rows[2]));
    CHECK(player["position"]["seconds"] == 0);
    const auto restarted = recorder.session(id)->turn();
    REQUIRE(restarted.has_value());
    CHECK(restarted->serial != seeked->serial);
    CHECK(restarted->cut);
    CHECK(recorder.engine().transports.empty());
    CHECK(recorder.calls() == 0);
}

TEST_CASE("next and previous on a session with nothing to play answer 204 and move nothing") {
    Recorder recorder;
    const TestServer server = serving(recorder.player());
    const auto id = createdId(server, kPhone);
    const auto tag = tagOf(poll(server, id, kPhone));

    checkDone(post(server, scoped(kNext, id, kPhone), ""));
    checkDone(post(server, scoped(kPrevious, id, kPhone), ""));

    checkUnchanged(pollHolding(server, id, kPhone, tag), tag);
    const auto session = documentOf(server, id, kPhone);
    CHECK(session["playback"] == "stopped");
    CHECK(session["libraryPath"].is_null());
    CHECK(recorder.engine().transports.empty());
    CHECK(recorder.calls() == 0);
}

TEST_CASE(
    "a library set naming no session or the engine session is 403 while controlPlayback is off") {
    Recorder recorder;
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;
    const TestServer server = servingWith(recorder.player(), &library, nullptr,
                                          parseSettings(R"({"controlPlayback": false})"));
    createdId(server, kPhone);
    const auto body = fromIndex(librarySet(structure, "ordinals", {1, 2}), 0);

    const auto unnamed = playing(server, "", "", body);
    REQUIRE(unnamed);
    CHECK(unnamed->status == 403);
    CHECK(errorOf(*unnamed) == describe(PlayerOutcome::playbackDisabled));
    checkSameAnswer(playing(server, kEngineSessionId, kPhone, body), unnamed);

    CHECK(recorder.libraryTaken().empty());
    CHECK(recorder.calls() == 0);
}
