#include "fb2k/PCH.h"

#include "fb2k/main_thread.h"

#include <utility>

namespace jean {

MainThreadCalls foobarMainThread() {
    MainThreadCalls calls;
    calls.post = [](std::function<void()> callback) { fb2k::inMainThread(std::move(callback)); };
    calls.isCurrent = [] { return core_api::is_main_thread(); };
    return calls;
}

}  // namespace jean
