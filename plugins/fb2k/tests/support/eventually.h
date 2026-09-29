#pragma once

#include <atomic>
#include <chrono>
#include <functional>
#include <thread>

namespace jean::testing {

// Long enough that only a thread which is never going to get there runs it out, on a loaded
// machine or under a sanitizer, and short enough that such a thread fails a case rather than
// holding up the suite.
constexpr std::chrono::seconds kWatchdog{10};

bool eventually(const std::function<bool()>& settled,
                std::chrono::steady_clock::duration watchdog = kWatchdog);

void joinOnceFinished(std::thread& thread, const std::atomic<bool>& finished,
                      const char* waitingFor);

}  // namespace jean::testing
