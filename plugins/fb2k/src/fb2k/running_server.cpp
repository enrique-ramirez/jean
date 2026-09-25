#include "fb2k/PCH.h"

#include "fb2k/running_server.h"

#include <mutex>

namespace jean {

namespace {

std::mutex g_mutex;
ListenerStatus g_status;

}  // namespace

void publishListenerStatus(const ListenerStatus& status) {
    const std::lock_guard<std::mutex> lock(g_mutex);
    g_status = status;
}

void forgetListenerStatus() {
    const std::lock_guard<std::mutex> lock(g_mutex);
    g_status = ListenerStatus{};
}

ListenerStatus listenerStatus() {
    const std::lock_guard<std::mutex> lock(g_mutex);
    return g_status;
}

}  // namespace jean
