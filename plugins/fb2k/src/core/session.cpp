#include "core/session.h"

#include "core/refusal_order.h"

#include <algorithm>
#include <iterator>
#include <utility>

namespace jean {

namespace {

std::optional<std::string> unlessEmpty(const std::string& name) {
    return name.empty() ? std::nullopt : std::optional<std::string>(name);
}

}  // namespace

Session::Session(std::string id, const DeviceIdentity& creator, const Audience& engine,
                 SessionRandom random, Clock::time_point now)
    : id_(std::move(id)),
      createdBy_(sanitised(creator)),
      random_(std::move(random)),
      audience_(engine.sibling()) {
    if (!creator.id.empty())
        lastSeen_[creator.id] = now;
}

// Swallowed unlogged: a throw leaving a destructor ends the process, and building the log line
// can throw too.
Session::~Session() {
    try {
        close();
    } catch (...) {
        return;
    }
}

const std::string& Session::id() const {
    return id_;
}

const DeviceIdentity& Session::createdBy() const {
    return createdBy_;
}

bool Session::runningLocked() const {
    return playback_ == PlaybackState::playing && playingLocked() != nullptr && listeners_ > 0;
}

const SessionTrack* Session::playingLocked() const {
    if (playback_ == PlaybackState::stopped)
        return nullptr;
    if (queued_)
        return &*queued_;
    if (cursor_.at)
        return &snapshot_[*cursor_.at];
    return nullptr;
}

double Session::durationLocked() const {
    if (duration_ > 0)
        return duration_;

    return names_ && names_->serial == serial_ ? names_->duration : 0;
}

double Session::positionLocked(Clock::time_point now) const {
    if (!runningLocked() || now <= position_.taken)
        return position_.seconds;

    return position_.seconds + std::chrono::duration<double>(now - position_.taken).count();
}

void Session::markLocked(Clock::time_point now) {
    position_ = {positionLocked(now), std::max(now, position_.taken)};
}

void Session::heldWithinLocked(double duration) {
    if (duration <= 0)
        return;

    from_ = std::min(from_, duration);
    position_.seconds = std::min(position_.seconds, duration);
}

PlayerState Session::state(Clock::time_point now) const {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState answer;
    answer.playback =
        playback_ == PlaybackState::playing && listeners_ == 0 ? PlaybackState::paused : playback_;
    answer.playbackMode = modeNameOf(order_);

    if (const SessionTrack* const track = playingLocked()) {
        answer.path = track->path;
        answer.subsong = track->subsong;
        answer.libraryPath = track->libraryPath;
        answer.duration = durationLocked();

        if (names_ && names_->serial == serial_) {
            answer.title = names_->title;
            answer.artist = unlessEmpty(names_->artist);
            answer.album = unlessEmpty(names_->album);
            answer.albumArtist = unlessEmpty(names_->albumArtist);
        }
    }

    answer.position = {positionLocked(now), now};

    return answer;
}

SessionRevisions Session::revisions() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return revisions_;
}

void Session::named(uint64_t serial, std::string title, std::string artist, std::string album,
                    std::string albumArtist, double duration) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (serial != serial_ || playingLocked() == nullptr)
        return;

    names_ = TurnNames{serial,           std::move(title),       std::move(artist),
                       std::move(album), std::move(albumArtist), duration};
    heldWithinLocked(durationLocked());
}

ArtworkSource Session::cover(const std::function<ArtworkSource(const SessionTrack&)>& read) {
    uint64_t serial = 0;
    SessionTrack track;

    {
        const std::lock_guard<std::mutex> held(mutex_);

        const SessionTrack* const playing = playingLocked();
        if (playing == nullptr)
            return {};

        if (cover_ && cover_->serial == serial_)
            return cover_->source;

        serial = serial_;
        track = *playing;
    }

    auto source = read(track);
    if (source.picture && source.picture->size() > kMaxArtworkBytes)
        source.picture.reset();

    const std::lock_guard<std::mutex> held(mutex_);
    if (serial == serial_)
        cover_ = TurnCover{serial, source};

    return source;
}

void Session::startLocked(double from, bool cut, Clock::time_point now) {
    ++serial_;
    turnBefore_ = std::move(turnNow_);
    turnNow_.serial = serial_;
    const SessionTrack* const track = playingLocked();
    turnNow_.track = track ? *track : SessionTrack{};
    from_ = from;
    cut_ = cut;
    position_ = {from, now};
    cover_.reset();
    ++revisions_.version;
    woken_.notify_all();
}

void Session::stopLocked(Clock::time_point now) {
    // The cursor stays where it was, so play after a stop with nothing queued starts that row again
    // from its start; a queued track is taken first.
    queued_.reset();
    playback_ = PlaybackState::stopped;
    duration_ = 0;
    failedRows_ = 0;
    startLocked(0, true, now);
}

PlayerOutcome Session::play(std::vector<SessionTrack> tracks, size_t index, Clock::time_point now) {
    if (index >= tracks.size())
        return PlayerOutcome::positionPastEnd;

    const std::lock_guard<std::mutex> held(mutex_);

    snapshot_ = std::move(tracks);
    cursor_ = startedAt(order_, snapshot_.size(), index, random_);
    queued_.reset();
    playback_ = PlaybackState::playing;
    duration_ = 0;
    failedRows_ = 0;
    startLocked(0, true, now);

    return PlayerOutcome::done;
}

void Session::playPause(Clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    switch (playback_) {
        case PlaybackState::stopped:
            if (queue_.empty() && snapshot_.empty())
                return;

            playback_ = PlaybackState::playing;
            if (takeQueuedLocked(true, now))
                return;

            // With no row, inOrder has run off the end, and play starts again at the first row.
            if (!cursor_.at)
                cursor_ = startedAt(order_, snapshot_.size(), 0, random_);

            startLocked(0, true, now);
            return;
        case PlaybackState::playing:
            if (listeners_ == 0)
                return;

            markLocked(now);
            playback_ = PlaybackState::paused;
            break;
        case PlaybackState::paused:
            markLocked(now);
            playback_ = PlaybackState::playing;
            break;
    }

    ++revisions_.version;
    woken_.notify_all();
}

void Session::next(Clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (queue_.empty() && snapshot_.empty())
        return;

    playback_ = PlaybackState::playing;
    failedRows_ = 0;
    if (takeQueuedLocked(true, now))
        return;

    skipLocked(Advance::next, now);
}

void Session::previous(Clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    const bool restarts =
        playingLocked() != nullptr &&
        positionLocked(now) > std::chrono::duration<double>(kPreviousRestartsAfter).count();
    if (!restarts && snapshot_.empty())
        return;

    playback_ = PlaybackState::playing;
    failedRows_ = 0;

    if (restarts) {
        duration_ = 0;
        startLocked(0, true, now);
        return;
    }

    if (queued_ && cursor_.at) {
        queued_.reset();
        duration_ = 0;
        startLocked(0, true, now);
        return;
    }

    skipLocked(Advance::previous, now);
}

// With no row, inOrder has run off the end, and a skip starts again at the first row as play does.
void Session::skipLocked(Advance why, Clock::time_point now) {
    queued_.reset();
    cursor_ = cursor_.at ? advanced(order_, snapshot_.size(), std::move(cursor_), why, random_)
                         : startedAt(order_, snapshot_.size(), 0, random_);
    duration_ = 0;
    startLocked(0, true, now);
}

void Session::stop(Clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (playback_ != PlaybackState::stopped)
        stopLocked(now);
}

void Session::seek(double seconds, bool relative, Clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (playback_ == PlaybackState::stopped)
        return;

    double to = std::max(0.0, relative ? positionLocked(now) + seconds : seconds);
    if (const double duration = durationLocked(); duration > 0)
        to = std::min(to, duration);

    const uint64_t turn = serial_;
    auto cover = std::exchange(cover_, std::nullopt);
    startLocked(to, true, now);
    if (names_ && names_->serial == turn)
        names_->serial = serial_;
    if (cover && cover->serial == turn) {
        cover->serial = serial_;
        cover_ = std::move(cover);
    }
}

void Session::setOrder(SessionOrder order) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (order == order_)
        return;

    order_ = order;

    if (cursor_.at)
        cursor_ = startedAt(order_, snapshot_.size(), *cursor_.at, random_);

    ++revisions_.version;
}

SessionOrder Session::order() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return order_;
}

bool Session::shared() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return shared_;
}

void Session::share(bool shared) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (shared == shared_)
        return;

    shared_ = shared;
    ++revisions_.session;
    ++revisions_.version;
}

bool Session::member(const std::string& deviceId, Clock::time_point now) const {
    if (deviceId.empty())
        return false;

    const std::lock_guard<std::mutex> held(mutex_);

    const auto seen = lastSeen_.find(deviceId);
    if (seen != lastSeen_.end() && now < seen->second + kControllingGrace)
        return true;

    return audience_->holds(deviceId, now);
}

void Session::seen(const std::string& deviceId, Clock::time_point now) {
    if (deviceId.empty())
        return;

    const std::lock_guard<std::mutex> held(mutex_);

    const auto known = lastSeen_.find(deviceId);
    if (known != lastSeen_.end()) {
        known->second = std::max(known->second, now);
        return;
    }

    for (auto stale = lastSeen_.begin(); stale != lastSeen_.end();) {
        if (now < stale->second + kControllingGrace)
            ++stale;
        else
            stale = lastSeen_.erase(stale);
    }

    if (lastSeen_.size() >= kMaxSessionControllers) {
        lastSeen_.erase(
            std::min_element(lastSeen_.begin(), lastSeen_.end(),
                             [](const auto& a, const auto& b) { return a.second < b.second; }));
    }

    lastSeen_.emplace(deviceId, now);
}

void Session::leave(const std::string& deviceId) {
    if (deviceId.empty())
        return;

    const std::lock_guard<std::mutex> held(mutex_);

    lastSeen_.erase(deviceId);
    audience_->leave(deviceId);
}

bool Session::expired(Clock::time_point now) const {
    const std::lock_guard<std::mutex> held(mutex_);
    return expiredLocked(now);
}

bool Session::closeIfExpired(Clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (!expiredLocked(now))
        return false;

    closeLocked();
    return true;
}

void Session::closeWithoutStopping() {
    const std::lock_guard<std::mutex> held(mutex_);
    closeLocked();
}

void Session::closeLocked() {
    closed_ = true;
    woken_.notify_all();
}

bool Session::expiredLocked(Clock::time_point now) const {
    const bool controlled =
        std::any_of(lastSeen_.begin(), lastSeen_.end(),
                    [now](const auto& seen) { return now < seen.second + kControllingGrace; });

    return !controlled && !audience_->anyListening(now);
}

std::shared_ptr<Audience::Membership> Session::listen(const DeviceIdentity& device,
                                                      const std::string& format,
                                                      Clock::time_point now) {
    auto self = shared_from_this();
    std::shared_ptr<Audience::Membership> joined;

    {
        const std::lock_guard<std::mutex> held(mutex_);

        if (closed_)
            return nullptr;

        joined = audience_->join(device, format, now);
        if (!joined)
            return nullptr;

        markLocked(now);
        ++listeners_;
        ++revisions_.version;
        woken_.notify_all();
    }

    Audience::Membership* const membership = joined.get();
    return std::shared_ptr<Audience::Membership>(
        membership, [joined = std::move(joined),
                     self = std::move(self)](Audience::Membership* /*membership*/) mutable {
            joined.reset();
            self->released();
        });
}

void Session::released() {
    const auto now = audience_->now();
    const std::lock_guard<std::mutex> held(mutex_);

    markLocked(now);
    --listeners_;
    ++revisions_.version;
}

const Audience& Session::audience() const {
    return *audience_;
}

std::optional<Turn> Session::turn() const {
    const std::lock_guard<std::mutex> held(mutex_);

    const SessionTrack* const track = playingLocked();
    if (!track)
        return std::nullopt;

    return Turn{serial_, *track, from_, cut_};
}

std::optional<Turn> Session::unnamedTurn() const {
    const std::lock_guard<std::mutex> held(mutex_);

    const SessionTrack* const track = playingLocked();
    if (!track || (names_ && names_->serial == serial_))
        return std::nullopt;

    return Turn{serial_, *track, from_, cut_};
}

bool Session::running() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return runningLocked();
}

bool Session::stopped() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return playback_ == PlaybackState::stopped;
}

bool Session::awaitDue(Clock::time_point due) {
    std::unique_lock<std::mutex> held(mutex_);
    ++waiting_;
    woken_.wait_until(held, due, [this] { return closed_; });
    --waiting_;
    return !closed_;
}

bool Session::awaitRunning(Turn& turn) {
    std::unique_lock<std::mutex> held(mutex_);
    ++waiting_;
    woken_.wait(held, [this] { return closed_ || runningLocked(); });
    --waiting_;

    if (closed_)
        return false;

    if (turn.serial != serial_)
        turn = Turn{serial_, *playingLocked(), from_, cut_};

    return true;
}

size_t Session::waitingDecoders() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return waiting_;
}

void Session::began(uint64_t serial, double duration, Clock::time_point /*now*/) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (serial != serial_ || playback_ == PlaybackState::stopped)
        return;

    duration_ = duration;
    heldWithinLocked(duration);
    ++revisions_.version;
}

bool Session::ended(uint64_t serial, Clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (serial != serial_ || playback_ == PlaybackState::stopped)
        return false;

    failedRows_ = 0;
    return advanceLocked(Advance::ended, now);
}

AfterThrow Session::threw(uint64_t serial, Thrower from, Clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (closed_)
        return AfterThrow::nothing;

    if (from == Thrower::chain) {
        if (chainDropped_)
            return AfterThrow::nothing;

        chainDropped_ = true;
        reportLocked(SessionReportKind::chainDropped,
                     serial == turnBefore_.serial ? turnBefore_.track : turnNow_.track);
        return AfterThrow::dropChain;
    }

    if (serial != serial_ || playback_ == PlaybackState::stopped)
        return AfterThrow::nothing;

    reportLocked(SessionReportKind::undecodable, turnNow_.track);

    if (!queued_)
        ++failedRows_;

    // Decided before the advance, which under a repeat order would go round to a failed row.
    if (failedRows_ >= snapshot_.size() && queue_.empty()) {
        stopLocked(now);
        return AfterThrow::skipTrack;
    }

    advanceLocked(Advance::failed, now);
    return AfterThrow::skipTrack;
}

std::vector<SessionReport> Session::reports() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return reports_;
}

bool Session::chainDropped() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return chainDropped_;
}

void Session::reportLocked(SessionReportKind kind, const SessionTrack& on) {
    SessionReport report;
    report.sequence = (reports_.empty() ? 0 : reports_.back().sequence) + 1;
    report.kind = kind;
    report.path = on.path;
    report.subsong = on.subsong;
    report.libraryPath = on.libraryPath;

    if (reports_.size() >= kSessionReportsKept)
        reports_.erase(reports_.begin());

    reports_.push_back(std::move(report));
    ++revisions_.session;
    ++revisions_.version;
}

bool Session::advanceLocked(Advance why, Clock::time_point now) {
    const bool cut = why == Advance::failed;

    // Before the cursor moves, so it stays on the row the snapshot resumes after.
    if (takeQueuedLocked(cut, now))
        return true;

    const Advance rowWhy = queued_ ? Advance::ended : why;
    queued_.reset();
    cursor_ = advanced(order_, snapshot_.size(), std::move(cursor_), rowWhy, random_);

    if (!cursor_.at) {
        stopLocked(now);
        return false;
    }

    duration_ = 0;
    startLocked(0, cut, now);
    return true;
}

void Session::attach(SessionStream stream) {
    SessionStream replaced;
    {
        const std::lock_guard<std::mutex> held(mutex_);
        replaced = std::exchange(stream_, std::move(stream));
    }
}

OpenedStream Session::open(const std::string& format) {
    StreamOpener opener;
    {
        const std::lock_guard<std::mutex> held(mutex_);
        opener = stream_.open;
    }

    return opener ? opener(format) : OpenedStream{};
}

std::string Session::timeline() const {
    std::function<std::string()> read;
    {
        const std::lock_guard<std::mutex> held(mutex_);
        read = stream_.readTimeline;
    }

    return read ? read() : std::string();
}

void Session::timelineMarked() {
    const std::lock_guard<std::mutex> held(mutex_);
    ++revisions_.timeline;
    ++revisions_.version;
}

void Session::close() {
    std::function<void()> stop;

    {
        const std::lock_guard<std::mutex> held(mutex_);
        closed_ = true;
        stop = std::exchange(stream_.stop, nullptr);
    }

    // The stop joins the decoder thread, which can only leave either wait once it is woken.
    woken_.notify_all();

    if (stop)
        stop();
}

bool Session::takeQueuedLocked(bool cut, Clock::time_point now) {
    if (queue_.empty())
        return false;

    queued_ = std::move(queue_.front());
    queue_.erase(queue_.begin());
    queueChangedLocked();

    duration_ = 0;
    startLocked(0, cut, now);
    return true;
}

void Session::queueChangedLocked() {
    ++revisions_.queue;
    ++revisions_.version;
}

Session::Queue Session::queue() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return {revisions_.queue, queue_};
}

PlayerOutcome Session::enqueue(std::vector<SessionTrack> tracks) {
    if (tracks.empty())
        return PlayerOutcome::done;

    const std::lock_guard<std::mutex> held(mutex_);

    if (tracks.size() > kMaxSessionQueue - queue_.size())
        return PlayerOutcome::tooMany;

    queue_.insert(queue_.end(), std::make_move_iterator(tracks.begin()),
                  std::make_move_iterator(tracks.end()));
    queueChangedLocked();
    return PlayerOutcome::done;
}

PlayerOutcome Session::enqueueAt(std::vector<SessionTrack> tracks, uint32_t index,
                                 uint64_t revision) {
    const std::lock_guard<std::mutex> held(mutex_);

    QueueEditFacts facts;
    facts.queueMoved = revision != revisions_.queue;
    facts.positionPastEnd = index > queue_.size();
    facts.tooMany = tracks.size() > kMaxSessionQueue - queue_.size();
    if (const auto refused = queueEditRefusal(facts); refused != PlayerOutcome::done)
        return refused;

    if (tracks.empty())
        return PlayerOutcome::done;

    queue_.insert(queue_.begin() + index, std::make_move_iterator(tracks.begin()),
                  std::make_move_iterator(tracks.end()));
    queueChangedLocked();
    return PlayerOutcome::done;
}

PlayerOutcome Session::moveQueued(uint32_t from, uint32_t to, uint64_t revision) {
    const std::lock_guard<std::mutex> held(mutex_);

    QueueEditFacts facts;
    facts.queueMoved = revision != revisions_.queue;
    facts.positionPastEnd = from >= queue_.size() || to >= queue_.size();
    if (const auto refused = queueEditRefusal(facts); refused != PlayerOutcome::done)
        return refused;

    if (from == to)
        return PlayerOutcome::done;

    SessionTrack moving = std::move(queue_[from]);
    queue_.erase(queue_.begin() + from);
    queue_.insert(queue_.begin() + to, std::move(moving));
    queueChangedLocked();
    return PlayerOutcome::done;
}

PlayerOutcome Session::removeQueued(uint32_t index, uint64_t revision) {
    const std::lock_guard<std::mutex> held(mutex_);

    QueueEditFacts facts;
    facts.queueMoved = revision != revisions_.queue;
    facts.positionPastEnd = index >= queue_.size();
    if (const auto refused = queueEditRefusal(facts); refused != PlayerOutcome::done)
        return refused;

    queue_.erase(queue_.begin() + index);
    queueChangedLocked();
    return PlayerOutcome::done;
}

void Session::clearQueue() {
    const std::lock_guard<std::mutex> held(mutex_);

    if (queue_.empty())
        return;

    queue_.clear();
    queueChangedLocked();
}

}  // namespace jean
