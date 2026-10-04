#include "fb2k/PCH.h"

#include "fb2k/player_audio_settings.h"

#include "core/log.h"

#include <exception>
#include <string>
#include <utility>

namespace jean {

PlayerAudioSettings::PlayerAudioSettings() {
    try {
        Latest read;
        dsp_config_manager::get()->get_core_settings(read.chain);
        replaygain_manager::get()->get_core_settings(read.replayGain);
        latest_ = std::move(read);
    } catch (const std::exception& e) {
        logError(std::string("could not read foobar2000's DSP chain and ReplayGain settings: ") +
                 e.what());
    }
}

void PlayerAudioSettings::chainChanged(const dsp_chain_config& chain) {
    const std::lock_guard<std::mutex> held(mutex_);
    latest_.chain = chain;
    generation_ = ++latest_.generation;
}

void PlayerAudioSettings::replayGainChanged(const t_replaygain_config& replayGain) {
    const std::lock_guard<std::mutex> held(mutex_);
    latest_.replayGain = replayGain;
    generation_ = ++latest_.generation;
}

uint64_t PlayerAudioSettings::generation() const {
    return generation_.load();
}

PlayerAudioSettings::Latest PlayerAudioSettings::latest() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return latest_;
}

}  // namespace jean
