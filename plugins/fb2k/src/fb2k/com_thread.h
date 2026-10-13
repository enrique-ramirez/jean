#pragma once

#ifdef _WIN32
#include <objbase.h>
#endif

namespace jean {

// Media Foundation needs COM initialised on the encoder thread itself, and a session's decoder
// thread holds it too for whatever an input component reaches through COM. COM pairs
// CoUninitialize only with a CoInitializeEx that succeeded, S_FALSE included.
struct ComOnThisThread {
#ifdef _WIN32
    ComOnThisThread() : initialised(SUCCEEDED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) {}

    ~ComOnThisThread() {
        if (initialised)
            CoUninitialize();
    }
#else
    // User-provided, so clang does not call a `const ComOnThisThread com;` an unused variable.
    ComOnThisThread() {}
#endif

    ComOnThisThread(const ComOnThisThread&) = delete;
    ComOnThisThread& operator=(const ComOnThisThread&) = delete;

#ifdef _WIN32
    const bool initialised;
#endif
};

}  // namespace jean
