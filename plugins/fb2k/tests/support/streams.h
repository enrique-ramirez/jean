#pragma once

#include "core/stream.h"

#include <atomic>
#include <condition_variable>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace jean::testing {

// An empty chunk is a call with nothing to send. `beforeEnding` runs on each call past the last
// chunk.
std::unique_ptr<StreamListener> finiteStream(std::vector<std::string> chunks,
                                             std::function<void()> beforeEnding = {});

StreamOpener opensWith(std::vector<std::string> chunks, std::string contentType = "audio/ogg",
                       int* opens = nullptr);

class Gate {
public:
    void awaitRelease();
    void release();

private:
    std::mutex mutex_;
    std::condition_variable released_;
    bool held_ = true;
};

StreamOpener opensHeldBy(std::shared_ptr<Gate> gate);

struct Cut {
    std::atomic<bool> reloaded{false};
    std::atomic<int> callsAfterReload{0};
    std::atomic<bool> overran{false};
};

StreamOpener opensLive(std::shared_ptr<Cut> cut, bool paused);

}  // namespace jean::testing
