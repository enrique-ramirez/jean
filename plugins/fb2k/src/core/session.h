#pragma once

#include "core/artwork.h"
#include "core/audience.h"
#include "core/device.h"
#include "core/player_outcome.h"
#include "core/player_state.h"
#include "core/session_order.h"
#include "core/stream.h"

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

// One detached playback session. A detached session decodes for itself and is heard through its
// own stream; the engine session is foobar2000's playback_control and is not one of these.
namespace jean {

constexpr char kEngineSessionId[] = "engine";
constexpr auto kControllingGrace = std::chrono::minutes(15);
constexpr auto kPreviousRestartsAfter = std::chrono::seconds(3);
constexpr size_t kMaxSessionControllers = 64;
constexpr size_t kMaxSessionQueue = 10000;
constexpr size_t kSessionReportsKept = 8;

// `path` is the display form and `libraryPath` the address GET /api/artwork?track= takes, both
// spelled by fb2k/ when the track was taken. `handle` is fb2k/'s own, a metadb_handle_ptr behind
// a pointer core/ never looks through.
struct SessionTrack {
    std::string path;
    uint32_t subsong = 0;
    std::optional<std::string> libraryPath;
    std::shared_ptr<const void> handle;
};

// `cut` is false only where the track before ran out into this one.
struct Turn {
    uint64_t serial = 0;
    SessionTrack track;
    double from = 0;
    bool cut = true;
};

struct SessionRevisions {
    uint64_t version = 0;  // anything GET /api/state?session= publishes; its ETag
    uint64_t queue = 0;
    uint64_t timeline = 0;
    uint64_t session = 0;
};

enum class SessionReportKind { undecodable, chainDropped };

struct SessionReport {
    uint64_t sequence = 0;
    SessionReportKind kind = SessionReportKind::undecodable;
    std::string path;
    uint32_t subsong = 0;
    std::optional<std::string> libraryPath;
};

enum class Thrower { decoder, chain };
enum class AfterThrow { nothing, skipTrack, dropChain };

// A detached session's pipeline as fb2k/ built it. `stop` unblocks every listener and joins the
// decoder and the encoder threads; it MUST NOT need the player's main thread, which is the thread
// calling it at quit.
struct SessionStream {
    PlayerOutcome outcome = PlayerOutcome::done;
    StreamOpener open;
    std::function<std::string()> readTimeline;
    std::function<void()> stop;
};

class Session;
using SessionStreamStarter = std::function<SessionStream(Session&)>;

class Session : public std::enable_shared_from_this<Session> {
public:
    using Clock = std::chrono::steady_clock;

    // `engine` lends its cap, its linger and its clock and nothing else.
    Session(std::string id, const DeviceIdentity& creator, const Audience& engine,
            SessionRandom random, Clock::time_point now);
    ~Session();

    const std::string& id() const;

    const DeviceIdentity& createdBy() const;

    // The rest of the state is left at its defaults for the route to fill from the player.
    PlayerState state(Clock::time_point now) const;
    SessionRevisions revisions() const;

    // The names and length read for the turn `serial`, ignored where that turn is over. A seek
    // keeps them. They move no revision: the poll that read them is the one answering them. A
    // length of 0 is none; any other brings a position and a turn's start past it back to it, as
    // began() does.
    void named(uint64_t serial, std::string title, std::string artist, std::string album,
               std::string albumArtist, double duration = 0);

    // The cover of the track it is on, and none while stopped. Read through `read` on the calling
    // thread with no lock held, once for each turn, a seek keeping it unless the seek lands during
    // the read, and held, an answer of no cover included, until the turn moves on. A picture
    // larger than kMaxArtworkBytes is held and answered as its tag alone, with no picture.
    ArtworkSource cover(const std::function<ArtworkSource(const SessionTrack&)>& read);

    PlayerOutcome play(std::vector<SessionTrack> tracks, size_t index, Clock::time_point now);
    void playPause(Clock::time_point now);

    void next(Clock::time_point now);
    void previous(Clock::time_point now);

    void stop(Clock::time_point now);
    void seek(double seconds, bool relative, Clock::time_point now);
    void setOrder(SessionOrder order);
    SessionOrder order() const;

    struct Queue {
        uint64_t revision = 0;
        std::vector<SessionTrack> entries;
    };

    Queue queue() const;
    PlayerOutcome enqueue(std::vector<SessionTrack> tracks);

    // queueMoved, changing nothing, where `revision` is not the queue's own; positionPastEnd for
    // an index the queue does not hold; then tooMany. The check and the edit are one lock.
    PlayerOutcome enqueueAt(std::vector<SessionTrack> tracks, uint32_t index, uint64_t revision);
    PlayerOutcome moveQueued(uint32_t from, uint32_t to, uint64_t revision);
    PlayerOutcome removeQueued(uint32_t index, uint64_t revision);
    void clearQueue();

    bool shared() const;
    void share(bool shared);

    // A device is a member while its last-seen is inside kControllingGrace or it is connected
    // here or inside its linger.
    bool member(const std::string& deviceId, Clock::time_point now) const;
    void seen(const std::string& deviceId, Clock::time_point now);

    // Ends this device's controlling grace and its linger. A device still connected stays.
    void leave(const std::string& deviceId);

    // No listener, no linger and no controller inside the grace.
    bool expired(Clock::time_point now) const;

    bool closeIfExpired(Clock::time_point now);

    // Refuses listen() and ends both decoder waits as close() does, and leaves the stream running
    // for a later close() to stop: for a caller holding a lock no stop may run under.
    void closeWithoutStopping();

    // Joins this session's audience; null at the stream cap and once closed. The connection holds
    // what this returns for as long as it streams, and that may be the last thing holding the
    // session after a reap.
    std::shared_ptr<Audience::Membership> listen(const DeviceIdentity& device,
                                                 const std::string& format, Clock::time_point now);
    const Audience& audience() const;

    std::optional<Turn> turn() const;

    std::optional<Turn> unnamedTurn() const;

    // A linger is not listening.
    bool running() const;

    bool stopped() const;

    // Decoder thread.
    bool awaitDue(Clock::time_point due);

    // Decoder thread.
    bool awaitRunning(Turn& turn);

    size_t waitingDecoders() const;

    // Decoder thread.
    void began(uint64_t serial, double duration, Clock::time_point now);

    bool ended(uint64_t serial, Clock::time_point now);

    // A chain's throw, from any turn, reports `chainDropped` once and drops the chain for the rest
    // of the session's life, skipping nothing: the chain runs a track's end and a cut's flush
    // after the turn has moved on.
    AfterThrow threw(uint64_t serial, Thrower from, Clock::time_point now);

    std::vector<SessionReport> reports() const;
    bool chainDropped() const;

    // Once per session, by whatever created it: a second stream replaces the first, and the
    // first's `stop`, which joins its threads, is dropped uncalled, so close() never stops it.
    void attach(SessionStream stream);

    // The attached stream's, called with no lock held. Nothing opened, and an empty timeline,
    // where no stream is attached.
    OpenedStream open(const std::string& format);
    std::string timeline() const;

    // Encoder thread.
    void timelineMarked();

    void close();

    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;

private:
    bool runningLocked() const;
    bool expiredLocked(Clock::time_point now) const;
    const SessionTrack* playingLocked() const;
    double durationLocked() const;
    bool takeQueuedLocked(bool cut, Clock::time_point now);
    void queueChangedLocked();
    void reportLocked(SessionReportKind kind, const SessionTrack& on);
    bool advanceLocked(Advance why, Clock::time_point now);
    void skipLocked(Advance why, Clock::time_point now);
    double positionLocked(Clock::time_point now) const;
    void markLocked(Clock::time_point now);
    void heldWithinLocked(double duration);
    void startLocked(double from, bool cut, Clock::time_point now);
    void stopLocked(Clock::time_point now);
    void closeLocked();
    void released();

    const std::string id_;
    const DeviceIdentity createdBy_;
    const SessionRandom random_;
    const std::unique_ptr<Audience> audience_;

    mutable std::mutex mutex_;

    std::condition_variable woken_;
    size_t waiting_ = 0;

    SessionStream stream_;

    std::vector<SessionTrack> snapshot_;
    SessionOrder order_ = SessionOrder::inOrder;
    SessionCursor cursor_;
    std::vector<SessionTrack> queue_;

    // The queued track playing, taken off queue_ as it started; the cursor stays on the row the
    // snapshot resumes after.
    std::optional<SessionTrack> queued_;
    PlaybackState playback_ = PlaybackState::stopped;
    uint64_t serial_ = 0;
    double from_ = 0;
    bool cut_ = true;
    PositionMark position_;

    double duration_ = 0;
    int listeners_ = 0;
    bool shared_ = false;
    bool closed_ = false;
    std::map<std::string, Clock::time_point> lastSeen_;
    SessionRevisions revisions_;
    std::vector<SessionReport> reports_;
    bool chainDropped_ = false;

    struct StartedTurn {
        uint64_t serial = 0;
        SessionTrack track;
    };
    StartedTurn turnNow_;
    StartedTurn turnBefore_;

    struct TurnNames {
        uint64_t serial = 0;
        std::string title;
        std::string artist;
        std::string album;
        std::string albumArtist;
        double duration = 0;
    };
    std::optional<TurnNames> names_;

    struct TurnCover {
        uint64_t serial = 0;
        ArtworkSource source;
    };
    std::optional<TurnCover> cover_;

    size_t failedRows_ = 0;
};

}  // namespace jean
