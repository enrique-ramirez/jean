#pragma once

#include "core/http_server.h"

namespace jean {

void publishRunningServer(HttpServer* server);
void forgetRunningServer();

bool isServing();

void openPairingWindow();
void closePairingWindow();
HttpServer::PairingState pairingState();

}  // namespace jean
