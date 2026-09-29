#include "core/settings.h"

#include "core/json.h"
#include "core/log.h"

#include <algorithm>
#include <numeric>
#include <optional>

using nlohmann::json;

namespace jean {

namespace {

void ignoring(std::vector<std::string>& log, const std::string& key, const std::string& why) {
    log.push_back("config: ignoring '" + key + "': " + why);
}

class ConfigDocument {
public:
    ConfigDocument(const json& root, std::vector<std::string>& log) : root_(root), log_(log) {}

    template <typename T>
    void read(const char* key, T& out) {
        const auto* value = find(key);
        if (!value)
            return;

        try {
            out = value->get<T>();
        } catch (const std::exception&) {
            ignoring(log_, key, value->dump() + " is not valid; using " + json(out).dump());
        }
    }

    void readList(const char* key, std::vector<std::string>& out) {
        const auto* value = find(key);
        if (!value)
            return;

        if (!value->is_array()) {
            ignoring(log_, key, value->dump() + " -- expected an array; using " + json(out).dump());
            return;
        }

        out = std::accumulate(value->begin(), value->end(), std::vector<std::string>{},
                              [this, key](std::vector<std::string> kept, const json& entry) {
                                  if (!entry.is_string())
                                      ignoring(log_, key, "an entry is not a string");
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
                log_.push_back("config: '" + entry.key() +
                               "' is not a setting this component reads");
        });
    }

private:
    const json* find(const char* key) {
        read_.emplace_back(key);
        const auto it = root_.find(key);
        return it == root_.end() ? nullptr : &*it;
    }

    const json& root_;
    std::vector<std::string>& log_;
    std::vector<std::string> read_;
};

template <size_t N>
std::string join(const int (&values)[N]) {
    std::string text;
    for (const int value : values)
        text += (text.empty() ? "" : ", ") + std::to_string(value);
    return text;
}

int inRange(std::vector<std::string>& log, const char* key, int value, int low,
            std::optional<int> high, int fallback) {
    if (value >= low && (!high || value <= *high))
        return value;

    const auto bounds = high ? std::to_string(low) + " to " + std::to_string(*high)
                             : std::to_string(low) + " or more";

    ignoring(log, key,
             std::to_string(value) + " is out of range (" + bounds + "); using " +
                 std::to_string(fallback));
    return fallback;
}

Settings validated(Settings settings, std::vector<std::string>& log) {
    const Settings defaults;

    settings.port = inRange(log, "port", settings.port, kMinPort, kMaxPort, defaults.port);

    if (settings.bindAddress.empty()) {
        ignoring(log, "bindAddress", "empty; using " + defaults.bindAddress);
        settings.bindAddress = defaults.bindAddress;
    }

    settings.maxAutoPlaylists = inRange(log, "maxAutoPlaylists", settings.maxAutoPlaylists, 0,
                                        std::nullopt, defaults.maxAutoPlaylists);

    settings.opusBitrate = inRange(log, "opusBitrate", settings.opusBitrate, kMinOpusBitrate,
                                   kMaxOpusBitrate, defaults.opusBitrate);

    if (std::find(std::begin(kAacBitrates), std::end(kAacBitrates), settings.aacBitrate) ==
        std::end(kAacBitrates)) {
        ignoring(log, "aacBitrate",
                 std::to_string(settings.aacBitrate) + " is not one of " + join(kAacBitrates) +
                     "; using " + std::to_string(defaults.aacBitrate));
        settings.aacBitrate = defaults.aacBitrate;
    }

    settings.maxConcurrentStreams =
        inRange(log, "maxConcurrentStreams", settings.maxConcurrentStreams, 0, std::nullopt,
                defaults.maxConcurrentStreams);

    settings.streamTicketTtlSeconds =
        inRange(log, "streamTicketTtlSeconds", settings.streamTicketTtlSeconds,
                kMinTicketTtlSeconds, kMaxTicketTtlSeconds, defaults.streamTicketTtlSeconds);

    return settings;
}

}  // namespace

SettingsParse parseSettingsLogging(const std::string& text) {
    SettingsParse parse;

    const auto document = parseJsonObject(text);
    if (!document.ok()) {
        parse.documentValid = false;
        parse.logLines.push_back("config: " + document.error);
        return parse;
    }

    Settings settings;
    ConfigDocument keys(document.value, parse.logLines);

    keys.read("port", settings.port);
    keys.read("bindAddress", settings.bindAddress);
    keys.readList("allowedOrigins", settings.allowedOrigins);
    keys.readList("allowedHosts", settings.allowedHosts);
    keys.readList("allowedFields", settings.allowedFields);
    keys.read("maxAutoPlaylists", settings.maxAutoPlaylists);
    keys.read("writePlaylists", settings.writePlaylists);
    keys.read("controlPlayback", settings.controlPlayback);
    keys.read("changeOutput", settings.changeOutput);
    keys.read("opusBitrate", settings.opusBitrate);
    keys.read("aacBitrate", settings.aacBitrate);
    keys.read("streamingEnabled", settings.streamingEnabled);
    keys.read("maxConcurrentStreams", settings.maxConcurrentStreams);
    keys.read("streamTicketTtlSeconds", settings.streamTicketTtlSeconds);
    keys.read("muteWhileStreaming", settings.muteWhileStreaming);

    keys.warnAboutLeftovers();

    parse.settings = validated(std::move(settings), parse.logLines);
    return parse;
}

Settings parseSettings(const std::string& text) {
    const auto parse = parseSettingsLogging(text);

    for (const auto& line : parse.logLines)
        logError(line);
    if (!parse.documentValid)
        logError("config: falling back to defaults");

    return parse.settings;
}

bool operator==(const Settings& a, const Settings& b) {
    return serialiseSettings(a) == serialiseSettings(b);
}

std::string serialiseSettings(const Settings& settings) {
    const json root{{"port", settings.port},
                    {"bindAddress", settings.bindAddress},
                    {"allowedOrigins", settings.allowedOrigins},
                    {"allowedHosts", settings.allowedHosts},
                    {"allowedFields", settings.allowedFields},
                    {"maxAutoPlaylists", settings.maxAutoPlaylists},
                    {"writePlaylists", settings.writePlaylists},
                    {"controlPlayback", settings.controlPlayback},
                    {"changeOutput", settings.changeOutput},
                    {"opusBitrate", settings.opusBitrate},
                    {"aacBitrate", settings.aacBitrate},
                    {"streamingEnabled", settings.streamingEnabled},
                    {"maxConcurrentStreams", settings.maxConcurrentStreams},
                    {"streamTicketTtlSeconds", settings.streamTicketTtlSeconds},
                    {"muteWhileStreaming", settings.muteWhileStreaming}};

    return root.dump(2) + "\n";
}

}  // namespace jean
