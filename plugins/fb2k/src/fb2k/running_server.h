#pragma once

#include "core/http_server.h"

namespace jean {

void publishListenerStatus(const ListenerStatus& status);
void forgetListenerStatus();

ListenerStatus listenerStatus();

}  // namespace jean
