#include "core/format_feed.h"

#include "core/log.h"

#include <algorithm>
#include <utility>

namespace jean {

class FormatFeed::Listener final : public StreamListener {
public:
    Listener(FormatFeed& feed, std::shared_ptr<const void> owner)
        : owner_(std::move(owner)), feed_(feed), cursor_(joined(feed)) {}

    ~Listener() override {
        const std::lock_guard<std::mutex> held(feed_.mutex_);
        if (--feed_.listeners_ == 0)
            feed_.unheard_ = true;
    }

    bool next(std::vector<std::uint8_t>& out) override {
        if (!sentPreamble_) {
            out = feed_.preamble_;
            sentPreamble_ = true;
            return true;
        }

        out.clear();

        switch (feed_.ring_.read(cursor_, out, feed_.idlePatience_)) {
            case BroadcastRing::Read::ok:
            case BroadcastRing::Read::idle:
                return true;
            default:
                return false;
        }
    }

private:
    static BroadcastRing::Cursor joined(FormatFeed& feed) {
        const std::lock_guard<std::mutex> held(feed.mutex_);
        ++feed.listeners_;
        return feed.ring_.subscribe();
    }

    std::shared_ptr<const void> owner_;
    FormatFeed& feed_;
    BroadcastRing::Cursor cursor_;
    bool sentPreamble_ = false;
};

FormatFeed::FormatFeed(std::string name, std::string contentType, size_t ringBytes,
                       std::chrono::milliseconds idlePatience, StreamEncoder& encoder,
                       std::vector<std::uint8_t> preamble)
    : name_(std::move(name)),
      contentType_(std::move(contentType)),
      idlePatience_(idlePatience),
      encoder_(encoder),
      preamble_(std::move(preamble)),
      ring_(ringBytes),
      working_(encoder.ok()) {}

const std::string& FormatFeed::name() const {
    return name_;
}

const std::string& FormatFeed::contentType() const {
    return contentType_;
}

bool FormatFeed::working() const {
    return working_.load();
}

bool FormatFeed::hasListeners() const {
    return listeners_.load() > 0;
}

std::unique_ptr<StreamListener> FormatFeed::listen(std::shared_ptr<const void> owner) {
    return std::make_unique<Listener>(*this, std::move(owner));
}

bool FormatFeed::heardThrough() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return listeners_.load() > 0 && !unheard_;
}

void FormatFeed::settleArrivals() {
    const std::lock_guard<std::mutex> held(mutex_);
    if (listeners_.load() > 0)
        settleArrivalsLocked();
}

void FormatFeed::settleArrivalsLocked() {
    if (!unheard_)
        return;

    encoder_.dropHeld();
    unheard_ = false;
}

void FormatFeed::feed(const float* samples, size_t frames) {
    if (!working_.load())
        return;

    {
        const std::lock_guard<std::mutex> held(mutex_);
        if (listeners_.load() == 0) {
            unheard_ = true;
            return;
        }

        settleArrivalsLocked();

        encoded_.clear();
        encoder_.write(samples, frames, encoded_);

        if (publishLocked())
            return;
    }

    reportFailure();
}

void FormatFeed::silenceHeld() {
    if (!working_.load())
        return;

    {
        const std::lock_guard<std::mutex> held(mutex_);
        if (listeners_.load() == 0)
            unheard_ = true;

        if (unheard_)
            return;

        const size_t frames = encoder_.heldFrames();
        encoder_.dropHeld();

        encoded_.clear();
        if (frames > 0) {
            silence_.assign(frames * encoder_.channels(), 0.0F);
            encoder_.write(silence_.data(), frames, encoded_);
        }

        if (publishLocked())
            return;
    }

    reportFailure();
}

bool FormatFeed::publishLocked() {
    if (!encoded_.empty())
        ring_.write(encoded_.data(), encoded_.size());

    if (encoder_.ok())
        return true;

    working_.store(false);
    ring_.close();
    return false;
}

void FormatFeed::reportFailure() const {
    logError(name_ + " streaming stopped: " + encoder_.error());
}

void FormatFeed::close() {
    ring_.close();
}

HeldAudio heldAudioBefore(const std::vector<FormatFeed*>& feeds, bool cut) {
    if (std::none_of(feeds.begin(), feeds.end(),
                     [](const FormatFeed* feed) { return feed->hasListeners(); }))
        return HeldAudio::nobodyListening;

    const bool heardThrough = std::any_of(
        feeds.begin(), feeds.end(), [](const FormatFeed* feed) { return feed->heardThrough(); });

    // Settled on the decision rather than on the block reaching the encoders: the foobar2000
    // SDK's dsp::flush returns a DSP to the state before any audio, so the player's resampler
    // gives nothing back from the first block after a drop, and a decision that waited for that
    // block would drop every block for ever.
    for (FormatFeed* feed : feeds)
        feed->settleArrivals();

    if (!heardThrough)
        return HeldAudio::drop;

    return cut ? HeldAudio::silence : HeldAudio::keep;
}

}  // namespace jean
