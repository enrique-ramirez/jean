#include "fb2k/PCH.h"

#include "fb2k/player_outputs.h"

#include "fb2k/ask_player.h"

#include <optional>
#include <string>
#include <utility>

namespace jean {

namespace {

// The pair output_manager_v2 hands back and takes, printed the way foobar2000 prints a GUID
// and joined by ':'. Opaque to every other layer: core/ never parses, splits or builds one.
std::string deviceIdOf(const GUID& module, const GUID& device) {
    return std::string(pfc::print_guid(module).get_ptr()) + ":" +
           std::string(pfc::print_guid(device).get_ptr());
}

struct ParsedDeviceId {
    bool ok = false;
    GUID module{};
    GUID device{};
};

// pfc::GUID_from_text reads unknown characters as zero and never reports failure, the same
// trap core/playlists.h's isPlaylistId works around for a playlist id. A device id is never
// shape-checked in core/, so a garbage half decodes to a GUID that matches no device in
// listDevices() below rather than being caught here.
ParsedDeviceId parseDeviceId(const std::string& id) {
    const auto colon = id.find(':');
    if (colon == std::string::npos || id.find(':', colon + 1) != std::string::npos)
        return {};

    ParsedDeviceId parsed;
    parsed.ok = true;
    parsed.module = pfc::GUID_from_text(id.substr(0, colon).c_str());
    parsed.device = pfc::GUID_from_text(id.substr(colon + 1).c_str());
    return parsed;
}

// nullopt where this foobar2000 has no output_manager_v2. Never held between calls: a service
// call is cheap, and the pair can move at the player between one call and the next.
std::optional<std::string> currentDeviceId() {
    if (output_manager_v2::tryGet().is_empty())
        return std::nullopt;

    outputCoreConfig_t config{};
    output_manager_v2::get()->getCoreConfig(&config, sizeof(config));
    return deviceIdOf(config.m_output, config.m_device);
}

}  // namespace

PlayerOutputs playerOutputsVia(MainThreadQueue& mainThread) {
    PlayerOutputs outputs;

    if (output_manager_v2::tryGet().is_empty())
        return outputs;

    outputs.listOutputs = [&mainThread]() {
        return askPlayer<OutputsRead>(
            mainThread, "listing the output devices",
            [](const AnswerPtr<OutputsRead>& answer) {
                outputCoreConfig_t config{};
                output_manager_v2::get()->getCoreConfig(&config, sizeof(config));

                OutputsRead read;
                output_manager_v2::get()->listDevices(
                    [&read, &config](const char* name, const GUID& module, const GUID& device) {
                        OutputDevice entry;
                        entry.id = deviceIdOf(module, device);
                        entry.name = name;

                        if (module == config.m_output && device == config.m_device)
                            read.active = entry.id;

                        read.devices.push_back(std::move(entry));
                    });

                answer->set(std::move(read));
            },
            OutputsRead{OutputOutcome::timedOut, {}, std::nullopt},
            OutputsRead{OutputOutcome::playerRefused, {}, std::nullopt});
    };

    outputs.setActiveOutput = [&mainThread](const std::string& id) {
        return askPlayer<OutputOutcome>(
            mainThread, "switching the output device",
            [id](const AnswerPtr<OutputOutcome>& answer) {
                const auto parsed = parseDeviceId(id);

                // Comparing the GUIDs themselves, never the printed id, so this never depends on
                // how deviceIdOf spells one.
                bool listed = false;
                if (parsed.ok) {
                    output_manager_v2::get()->listDevices(
                        [&listed, &parsed](const char*, const GUID& module, const GUID& device) {
                            if (module == parsed.module && device == parsed.device)
                                listed = true;
                        });
                }

                if (!listed) {
                    answer->set(OutputOutcome::notListed);
                    return;
                }

                output_manager_v2::get()->setCoreConfigDevice(parsed.module, parsed.device);
                answer->set(OutputOutcome::done);
            },
            OutputOutcome::timedOut, OutputOutcome::playerRefused);
    };

    return outputs;
}

// outputConfigChanged() fires for the buffer length, the bit depth and dither as well as the
// device, so this recomputes the pair on every call and republishes only where it actually
// moved from the one this watch last saw -- core/output_hold.h's rule is the one to copy: a
// write of this component's own comes back as the player's own event, so
// POST /api/outputs/active never writes PlayerState itself.
struct OutputWatch::Callback : public output_config_change_callback {
    Callback(PlayerStateStore& store, output_manager_v2::ptr manager)
        : store(store), manager(std::move(manager)) {}

    void outputConfigChanged() override {
        auto id = currentDeviceId();
        if (id == lastSeen)
            return;

        lastSeen = id;
        store.outputDeviceChanged(id);
    }

    PlayerStateStore& store;

    // Held from construction rather than resolved again at removeCallback: the same instance
    // this registered against, the way fb2k/artwork.h's NowPlayingArtworkWatch holds its own.
    output_manager_v2::ptr manager;

    std::optional<std::string> lastSeen;
};

OutputWatch::OutputWatch(PlayerStateStore& store) {
    auto manager = output_manager_v2::tryGet();
    if (manager.is_empty())
        return;

    callback_ = std::make_unique<Callback>(store, manager);
    callback_->lastSeen = currentDeviceId();
    store.outputDeviceChanged(callback_->lastSeen);

    manager->addCallback(callback_.get());
}

OutputWatch::~OutputWatch() {
    if (callback_)
        callback_->manager->removeCallback(callback_.get());
}

}  // namespace jean
