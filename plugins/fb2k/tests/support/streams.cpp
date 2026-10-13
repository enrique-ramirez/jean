#include "support/streams.h"

#include <cstddef>
#include <cstdint>
#include <utility>

namespace jean::testing {

namespace {

constexpr int kCallsAllowedAfterReload = 4;

class FiniteStream : public StreamListener {
public:
    FiniteStream(std::vector<std::string> chunks, std::function<void()> beforeEnding)
        : chunks_(std::move(chunks)), beforeEnding_(std::move(beforeEnding)) {}

    bool next(std::vector<std::uint8_t>& out) override {
        if (sent_ >= chunks_.size()) {
            if (beforeEnding_)
                beforeEnding_();
            return false;
        }

        const auto& chunk = chunks_[sent_++];
        out.assign(chunk.begin(), chunk.end());
        return true;
    }

private:
    std::vector<std::string> chunks_;
    std::function<void()> beforeEnding_;
    size_t sent_ = 0;
};

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

std::unique_ptr<StreamListener> finiteStream(std::vector<std::string> chunks,
                                             std::function<void()> beforeEnding) {
    return std::make_unique<FiniteStream>(std::move(chunks), std::move(beforeEnding));
}

StreamOpener opensWith(std::vector<std::string> chunks, std::string contentType, int* opens) {
    return [chunks = std::move(chunks), contentType = std::move(contentType),
            opens](const std::string&) -> OpenedStream {
        if (opens != nullptr)
            ++*opens;
        return {contentType, finiteStream(chunks)};
    };
}

void Gate::awaitRelease() {
    std::unique_lock<std::mutex> lock(mutex_);
    released_.wait(lock, [this] { return !held_; });
}

void Gate::release() {
    {
        const std::lock_guard<std::mutex> lock(mutex_);
        held_ = false;
    }
    released_.notify_all();
}

StreamOpener opensHeldBy(std::shared_ptr<Gate> gate) {
    return [gate = std::move(gate)](const std::string&) -> OpenedStream {
        return {"audio/ogg", finiteStream({"ogg"}, [gate] { gate->awaitRelease(); })};
    };
}

StreamOpener opensLive(std::shared_ptr<Cut> cut, bool paused) {
    return [cut = std::move(cut), paused](const std::string&) -> OpenedStream {
        return {"audio/ogg", std::make_unique<LiveStream>(cut, paused)};
    };
}

}  // namespace jean::testing
