#pragma once

#include "core/api.h"
#include "core/settings.h"

// The discovery record, written into beefweb's clientconfig directory so a client finds this
// component in one same-origin request. Anyone who can reach beefweb can read and overwrite
// it, which is why it never carries the token.
namespace jean {

void writeAdvertisement(const Settings& settings, const ListenerStatus& status);
void removeAdvertisement();

}  // namespace jean
