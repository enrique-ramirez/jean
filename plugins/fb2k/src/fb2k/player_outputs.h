#pragma once

#include "core/http_server.h"
#include "core/player_state.h"
#include "fb2k/main_thread.h"

#include <memory>

// output_manager_v2's half of Player: listing the devices foobar2000 offers and switching
// between them. Whether a request is acceptable was decided in core/http_server.cpp before any
// of this runs; what is left is the SDK call and the id it turns into.
namespace jean {

// Both null where this foobar2000 has no output_manager_v2, checked once here rather than on
// every request: ARCHITECTURE.md, *No second copy of anything the player answers cheaply*, and
// GET /api/capabilities is not the place for it either, since a device list is not a switch.
struct PlayerOutputs {
    OutputLister listOutputs;
    OutputSetter setActiveOutput;
};

PlayerOutputs playerOutputsVia(MainThreadQueue& mainThread);

// Registering a callback touches the player, so this is constructed and destroyed on the main
// thread. Construction also seeds the store with the device the player is already set to, since
// the callback it registers fires only on the next change.
class OutputWatch {
public:
    explicit OutputWatch(PlayerStateStore& store);
    ~OutputWatch();

    OutputWatch(const OutputWatch&) = delete;
    OutputWatch& operator=(const OutputWatch&) = delete;

private:
    struct Callback;
    std::unique_ptr<Callback> callback_;
};

}  // namespace jean
