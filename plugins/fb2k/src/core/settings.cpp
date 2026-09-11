#include "core/settings.h"

#include "core/json.h"
#include "core/log.h"

#include <algorithm>
#include <numeric>
#include <optional>

using nlohmann::json;

namespace jean {

namespace {

void ignoring(const std::string& key, const std::string& why) {
    logError("config: ignoring '" + key + "': " + why);
}

class ConfigDocument {
public:
    explicit ConfigDocument(const json& root) : root_(root) {}

    template <typename T>
    void read(const char* key, T& out) {
        const auto* value = find(key);
        if (!value)
            return;

        try {
            out = value->get<T>();
        } catch (const std::exception& e) {
            ignoring(key, e.what());
        }
    }

    void readList(const char* key, std::vector<std::string>& out) {
        const auto* value = find(key);
        if (!value)
            return;

        if (!value->is_array()) {
            ignoring(key, "expected an array");
            return;
        }

        out = std::accumulate(value->begin(), value->end(), std::vector<std::string>{},
                              [key](std::vector<std::string> kept, const json& entry) {
                                  if (!entry.is_string())
                                      ignoring(key, "an entry is not a string");
                                  else if (auto text = entry.get<std::string>(); !text.empty())
                                      kept.push_back(std::move(text));
                                  return kept;
                              });
    }

    void warnAboutLeftovers() const {
        // Bound to a local because items() returns a proxy: begin() and end() from two
        // temporaries are not a valid range.
        const auto entries = root_.items();

        std::for_each(entries.begin(), entries.end(), [this](const auto& entry) {
            if (std::find(read_.begin(), read_.end(), entry.key()) == read_.end())
                logError("config: '" + entry.key() + "' is not a setting this component reads");
        });
    }

private:
    const json* find(const char* key) {
        read_.emplace_back(key);
        const auto it = root_.find(key);
        return it == root_.end() ? nullptr : &*it;
    }

    const json& root_;
    std::vector<std::string> read_;
};

template <size_t N>
std::string join(const int (&values)[N]) {
    std::string text;
    for (const int value : values)
        text += (text.empty() ? "" : ", ") + std::to_string(value);
    return text;
}

int inRange(const char* key, int value, int low, std::optional<int> high, int fallback) {
    if (value >= low && (!high || value <= *high))
        return value;

    const auto bounds = high ? std::to_string(low) + " to " + std::to_string(*high)
                             : std::to_string(low) + " or more";

    ignoring(key, std::to_string(value) + " is out of range (" + bounds + "); using " +
                      std::to_string(fallback));
    return fallback;
}

Settings validated(Settings settings) {
    const Settings defaults;

    settings.port = inRange("port", settings.port, kMinPort, kMaxPort, defaults.port);

    if (settings.bindAddress.empty()) {
        ignoring("bindAddress", "empty; using " + defaults.bindAddress);
        settings.bindAddress = defaults.bindAddress;
    }

    settings.maxAutoPlaylists = inRange("maxAutoPlaylists", settings.maxAutoPlaylists, 0,
                                        std::nullopt, defaults.maxAutoPlaylists);

    settings.opusBitrate = inRange("opusBitrate", settings.opusBitrate, kMinOpusBitrate,
                                   kMaxOpusBitrate, defaults.opusBitrate);

    if (std::find(std::begin(kAacBitrates), std::end(kAacBitrates), settings.aacBitrate) ==
        std::end(kAacBitrates)) {
        ignoring("aacBitrate", std::to_string(settings.aacBitrate) + " is not one of " +
                                   join(kAacBitrates) + "; using " +
                                   std::to_string(defaults.aacBitrate));
        settings.aacBitrate = defaults.aacBitrate;
    }

    settings.maxConcurrentStreams = inRange("maxConcurrentStreams", settings.maxConcurrentStreams,
                                            0, std::nullopt, defaults.maxConcurrentStreams);

    settings.streamTicketTtlSeconds =
        inRange("streamTicketTtlSeconds", settings.streamTicketTtlSeconds, kMinTicketTtlSeconds,
                kMaxTicketTtlSeconds, defaults.streamTicketTtlSeconds);

    if (!settings.authToken.empty() && settings.authToken.size() < kMinTokenLength) {
        ignoring("authToken", "shorter than " + std::to_string(kMinTokenLength) +
                                  " characters; refusing to serve with it");
        settings.authToken.clear();
    }

    return settings;
}

}  // namespace

Settings parseSettings(const std::string& text) {
    const auto document = parseJsonObject(text);
    if (!document.ok()) {
        logError("config: " + document.error);
        logError("config: falling back to defaults, which serve nothing until a token is set");
        return Settings();
    }

    Settings settings;
    ConfigDocument keys(document.value);

    keys.read("port", settings.port);
    keys.read("bindAddress", settings.bindAddress);
    keys.read("authToken", settings.authToken);
    keys.readList("allowedOrigins", settings.allowedOrigins);
    keys.readList("allowedFields", settings.allowedFields);
    keys.read("maxAutoPlaylists", settings.maxAutoPlaylists);
    keys.read("writePlaylists", settings.writePlaylists);
    keys.read("opusBitrate", settings.opusBitrate);
    keys.read("aacBitrate", settings.aacBitrate);
    keys.read("streamingEnabled", settings.streamingEnabled);
    keys.read("maxConcurrentStreams", settings.maxConcurrentStreams);
    keys.read("streamTicketTtlSeconds", settings.streamTicketTtlSeconds);
    keys.read("muteWhileStreaming", settings.muteWhileStreaming);

    keys.warnAboutLeftovers();

    return validated(std::move(settings));
}

bool operator==(const Settings& a, const Settings& b) {
    return serialiseSettings(a) == serialiseSettings(b);
}

std::string serialiseSettings(const Settings& settings) {
    const json root{{"port", settings.port},
                    {"bindAddress", settings.bindAddress},
                    {"authToken", settings.authToken},
                    {"allowedOrigins", settings.allowedOrigins},
                    {"allowedFields", settings.allowedFields},
                    {"maxAutoPlaylists", settings.maxAutoPlaylists},
                    {"writePlaylists", settings.writePlaylists},
                    {"opusBitrate", settings.opusBitrate},
                    {"aacBitrate", settings.aacBitrate},
                    {"streamingEnabled", settings.streamingEnabled},
                    {"maxConcurrentStreams", settings.maxConcurrentStreams},
                    {"streamTicketTtlSeconds", settings.streamTicketTtlSeconds},
                    {"muteWhileStreaming", settings.muteWhileStreaming}};

    return root.dump(2) + "\n";
}

}  // namespace jean
