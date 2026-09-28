#pragma once

#include "core/main_thread_queue.h"

namespace jean {

// foobar2000's main thread as a MainThreadQueue reaches it: fb2k::inMainThread, which always
// defers, and core_api::is_main_thread.
MainThreadCalls foobarMainThread();

}  // namespace jean
