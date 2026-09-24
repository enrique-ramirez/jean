#include "fb2k/PCH.h"

#include "fb2k/running_server.h"

#include <mutex>

namespace jean {

namespace {

std::mutex g_mutex;
HttpServer* g_server = nullptr;
ListenerStatus g_status;

}  // namespace

void publishRunningServer(HttpServer* server) {
    const std::lock_guard<std::mutex> lock(g_mutex);
    g_server = server;
}

void forgetRunningServer() {
    const std::lock_guard<std::mutex> lock(g_mutex);
    g_server = nullptr;
}

bool isServing() {
    const std::lock_guard<std::mutex> lock(g_mutex);
    return g_server != nullptr;
}

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

void openPairingWindow() {
    const std::lock_guard<std::mutex> lock(g_mutex);
    if (g_server != nullptr)
        g_server->openPairingWindow();
}

void closePairingWindow() {
    const std::lock_guard<std::mutex> lock(g_mutex);
    if (g_server != nullptr)
        g_server->closePairingWindow();
}

HttpServer::PairingState pairingState() {
    const std::lock_guard<std::mutex> lock(g_mutex);
    return g_server != nullptr ? g_server->pairingState() : HttpServer::PairingState{};
}

}  // namespace jean
