#include "core/reload.h"

#include "third_party/json.hpp"

#include <functional>

using nlohmann::json;

namespace jean {

namespace {

using Getter = std::function<json(const Settings&)>;

struct LiveKey {
    const char* name;
    Getter value;
    std::function<void(Settings&, const Settings&)> apply;
};

struct RestartKey {
    const char* name;
    Getter value;
};

const std::vector<LiveKey>& liveKeys() {
    static const std::vector<LiveKey> keys{
        {"allowedFields", [](const Settings& s) { return json(s.allowedFields); },
         [](Settings& to, const Settings& from) { to.allowedFields = from.allowedFields; }},
        {"allowedHosts", [](const Settings& s) { return json(s.allowedHosts); },
         [](Settings& to, const Settings& from) { to.allowedHosts = from.allowedHosts; }},
        {"allowedOrigins", [](const Settings& s) { return json(s.allowedOrigins); },
         [](Settings& to, const Settings& from) { to.allowedOrigins = from.allowedOrigins; }},
        {"changeOutput", [](const Settings& s) { return json(s.changeOutput); },
         [](Settings& to, const Settings& from) { to.changeOutput = from.changeOutput; }},
        {"controlPlayback", [](const Settings& s) { return json(s.controlPlayback); },
         [](Settings& to, const Settings& from) { to.controlPlayback = from.controlPlayback; }},
        {"maxAutoPlaylists", [](const Settings& s) { return json(s.maxAutoPlaylists); },
         [](Settings& to, const Settings& from) { to.maxAutoPlaylists = from.maxAutoPlaylists; }},
        {"streamingEnabled", [](const Settings& s) { return json(s.streamingEnabled); },
         [](Settings& to, const Settings& from) { to.streamingEnabled = from.streamingEnabled; }},
        {"writePlaylists", [](const Settings& s) { return json(s.writePlaylists); },
         [](Settings& to, const Settings& from) { to.writePlaylists = from.writePlaylists; }},
    };
    return keys;
}

const std::vector<RestartKey>& restartKeys() {
    static const std::vector<RestartKey> keys{
        {"aacBitrate", [](const Settings& s) { return json(s.aacBitrate); }},
        {"bindAddress", [](const Settings& s) { return json(s.bindAddress); }},
        {"maxConcurrentStreams", [](const Settings& s) { return json(s.maxConcurrentStreams); }},
        {"maxSessions", [](const Settings& s) { return json(s.maxSessions); }},
        {"muteWhileStreaming", [](const Settings& s) { return json(s.muteWhileStreaming); }},
        {"openBrowserAtStart", [](const Settings& s) { return json(s.openBrowserAtStart); }},
        {"opusBitrate", [](const Settings& s) { return json(s.opusBitrate); }},
        {"port", [](const Settings& s) { return json(s.port); }},
        {"streamTicketTtlSeconds",
         [](const Settings& s) { return json(s.streamTicketTtlSeconds); }},
    };
    return keys;
}

std::string changeSummary(const std::vector<std::pair<std::string, json>>& changed) {
    std::string line = "config: reload changed ";
    for (size_t i = 0; i < changed.size(); ++i)
        line += (i == 0 ? "" : ", ") + changed[i].first + "=" + changed[i].second.dump();
    return line;
}

}  // namespace

ReloadDecision decideReload(const Settings& running, const std::string& fileText) {
    ReloadDecision decision;

    const auto parsed = parseSettingsLogging(fileText);
    if (!parsed.documentValid) {
        decision.next = running;
        decision.documentValid = false;
        decision.logLines.push_back(parsed.logLines.front() + "; keeping the running settings");
        return decision;
    }

    decision.next = running;
    decision.logLines = parsed.logLines;

    std::vector<std::pair<std::string, json>> changed;
    for (const auto& key : liveKeys()) {
        auto value = key.value(parsed.settings);
        if (value != key.value(running)) {
            key.apply(decision.next, parsed.settings);
            decision.changedKeys.emplace_back(key.name);
            changed.emplace_back(key.name, std::move(value));
        }
    }

    for (const auto& key : restartKeys()) {
        if (key.value(parsed.settings) != key.value(running))
            decision.restartKeys.emplace_back(key.name);
    }

    decision.logLines.push_back(changed.empty() ? "config: reload: no settings changed"
                                                : changeSummary(changed));

    return decision;
}

}  // namespace jean
