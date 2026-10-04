#pragma once

#include <objbase.h>

namespace jean {

// Media Foundation needs COM initialised on the encoder thread itself, and a session's decoder
// thread holds it too for whatever an input component reaches through COM. COM pairs
// CoUninitialize only with a CoInitializeEx that succeeded, S_FALSE included.
struct ComOnThisThread {
    ComOnThisThread() : initialised(SUCCEEDED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) {}

    ~ComOnThisThread() {
        if (initialised)
            CoUninitialize();
    }

    ComOnThisThread(const ComOnThisThread&) = delete;
    ComOnThisThread& operator=(const ComOnThisThread&) = delete;

    const bool initialised;
};

}  // namespace jean
