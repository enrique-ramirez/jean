#pragma once

#include <foobar2000/SDK/foobar2000.h>

#include <atomic>
#include <cstdint>
#include <mutex>

namespace jean {

class PlayerAudioSettings {
public:
    PlayerAudioSettings();

    struct Latest {
        uint64_t generation = 0;
        dsp_chain_config_impl chain;
        t_replaygain_config replayGain;
    };

    void chainChanged(const dsp_chain_config& chain);
    void replayGainChanged(const t_replaygain_config& replayGain);

    uint64_t generation() const;
    Latest latest() const;

    PlayerAudioSettings(const PlayerAudioSettings&) = delete;
    PlayerAudioSettings& operator=(const PlayerAudioSettings&) = delete;

private:
    mutable std::mutex mutex_;
    Latest latest_;
    std::atomic<uint64_t> generation_{0};
};

}  // namespace jean
