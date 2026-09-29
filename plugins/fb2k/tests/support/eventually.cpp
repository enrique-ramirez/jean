#include "support/eventually.h"

#include <cstdio>
#include <cstdlib>

namespace jean::testing {

bool eventually(const std::function<bool()>& settled,
                std::chrono::steady_clock::duration watchdog) {
    constexpr auto kPoll = std::chrono::milliseconds(1);
    const auto deadline = std::chrono::steady_clock::now() + watchdog;

    while (!settled()) {
        if (std::chrono::steady_clock::now() >= deadline)
            return false;
        std::this_thread::sleep_for(kPoll);
    }
    return true;
}

void joinOnceFinished(std::thread& thread, const std::atomic<bool>& finished,
                      const char* waitingFor) {
    if (!eventually([&finished] { return finished.load(); })) {
        static_cast<void>(std::fprintf(
            stderr, "a thread was still waiting for %s when the watchdog ran out\n", waitingFor));
        static_cast<void>(std::fflush(stderr));
        std::abort();
    }

    thread.join();
}

}  // namespace jean::testing
