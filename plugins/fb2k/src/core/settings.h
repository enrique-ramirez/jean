#pragma once

#include <string>
#include <vector>

namespace jean {

struct Settings {
    int port = 8881;

    // Narrowing this to 127.0.0.1 is the hardening step for a single-machine deployment.
    std::string bindAddress = "0.0.0.0";

    std::string authToken;

    // Empty reflects any origin. Entries are matched whole and case insensitively.
    std::vector<std::string> allowedOrigins;

    std::vector<std::string> allowedFields{"rating"};

    // Zero turns creation off, the same shape as an empty allowedFields turning writes off.
    int maxAutoPlaylists = 100;

    bool writePlaylists = true;

    bool changeOutput = true;

    int opusBitrate = 256000;
    int aacBitrate = 192000;

    bool streamingEnabled = true;

    // Zero switches streaming off.
    int maxConcurrentStreams = 8;

    int streamTicketTtlSeconds = 120;

    // Off makes the player one more speaker alongside every listener, rather than one that
    // steps aside for them.
    bool muteWhileStreaming = true;
};

constexpr int kMuteLingerSeconds = 8;

// Named here rather than in core/preferences.h, which refuses the same numbers from a
// person at the dialog and would otherwise carry its own copy of the range.
constexpr int kMinPort = 1;
constexpr int kMaxPort = 65535;

constexpr int kMinOpusBitrate = 32000;
constexpr int kMaxOpusBitrate = 510000;

// The only values `MF_MT_AUDIO_AVG_BYTES_PER_SECOND` is documented to accept for AAC-LC.
// Anything else and `SetOutputType` refuses, which drops the ADTS format silently.
constexpr int kAacBitrates[] = {96000, 128000, 160000, 192000};
constexpr int kMinTicketTtlSeconds = 10;
constexpr int kMaxTicketTtlSeconds = 3600;

// Generated tokens are 64 hex characters; anything near hand-typed length is a mistake.
constexpr size_t kMinTokenLength = 32;

bool operator==(const Settings& a, const Settings& b);
inline bool operator!=(const Settings& a, const Settings& b) {
    return !(a == b);
}

// Never throws.
Settings parseSettings(const std::string& text);

std::string serialiseSettings(const Settings& settings);

}  // namespace jean
