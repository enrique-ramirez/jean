#include "core/preferences.h"

#include "core/http_server.h"
#include "core/log.h"
#include "core/reload.h"

#include <algorithm>
#include <cctype>
#include <numeric>
#include <sstream>
#include <string>
#include <vector>

namespace jean {

namespace {

constexpr char kBlank[] = " \t\r\n\f\v";

std::string trimmed(const std::string& text) {
    const auto first = text.find_first_not_of(kBlank);
    if (first == std::string::npos)
        return std::string();

    return text.substr(first, text.find_last_not_of(kBlank) - first + 1);
}

// The one raw loop in the tree. std::getline is the line reader, and wrapping it in an
// iterator to reach std::accumulate would be more code saying less.
std::vector<std::string> splitLines(const std::string& text) {
    std::istringstream stream(text);
    std::vector<std::string> kept;

    for (std::string line; std::getline(stream, line);) {
        if (auto entry = trimmed(line); !entry.empty())
            kept.push_back(std::move(entry));
    }

    return kept;
}

std::string joinLines(const std::vector<std::string>& entries) {
    return std::accumulate(entries.begin(), entries.end(), std::string(),
                           [](std::string out, const std::string& entry) {
                               if (!out.empty())
                                   out += kListLineBreak;
                               out += entry;
                               return out;
                           });
}

bool isDigit(char c) {
    return std::isdigit(static_cast<unsigned char>(c)) != 0;
}

FormReading refusing(std::string error) {
    FormReading reading;
    reading.error = std::move(error);
    return reading;
}

bool couldMatchARequest(const std::string& host) {
    return host.find_first_of(":/ \t") == std::string::npos;
}

std::string withoutTrailingDot(std::string host) {
    if (!host.empty() && host.back() == '.')
        host.pop_back();
    return host;
}

}  // namespace

bool operator==(const SettingsForm& a, const SettingsForm& b) {
    return a.port == b.port && a.bindAddress == b.bindAddress &&
           a.allowedOrigins == b.allowedOrigins && a.allowedFields == b.allowedFields &&
           a.writePlaylists == b.writePlaylists && a.controlPlayback == b.controlPlayback &&
           a.changeOutput == b.changeOutput && a.streamingEnabled == b.streamingEnabled &&
           a.maxAutoPlaylists == b.maxAutoPlaylists && a.allowedHosts == b.allowedHosts &&
           a.openBrowserAtStart == b.openBrowserAtStart;
}

SettingsForm toForm(const Settings& settings) {
    SettingsForm form;
    form.port = std::to_string(settings.port);
    form.bindAddress = settings.bindAddress;
    form.allowedOrigins = joinLines(settings.allowedOrigins);
    form.allowedFields = joinLines(settings.allowedFields);
    form.writePlaylists = settings.writePlaylists;
    form.controlPlayback = settings.controlPlayback;
    form.changeOutput = settings.changeOutput;
    form.streamingEnabled = settings.streamingEnabled;
    form.maxAutoPlaylists = std::to_string(settings.maxAutoPlaylists);
    form.allowedHosts = joinLines(settings.allowedHosts);
    form.openBrowserAtStart = settings.openBrowserAtStart;
    return form;
}

SettingsForm defaultForm() {
    return toForm(Settings());
}

FormReading readForm(const SettingsForm& form, const Settings& unshown) {
    const auto port = trimmed(form.port);
    if (port.empty())
        return refusing("A port is required.");
    if (!std::all_of(port.begin(), port.end(), isDigit))
        return refusing("The port must be a whole number.");

    // Digits only by now, so out of range is the one thing left that can go wrong -- and a
    // number too long for an int arrives here as an exception rather than a value.
    int portValue = 0;
    try {
        portValue = std::stoi(port);
    } catch (const std::exception&) {
        portValue = 0;
    }
    if (portValue < kMinPort || portValue > kMaxPort)
        return refusing("The port must be between " + std::to_string(kMinPort) + " and " +
                        std::to_string(kMaxPort) + ".");

    const auto bindAddress = trimmed(form.bindAddress);
    if (bindAddress.empty())
        return refusing("An address is required. Use 0.0.0.0 for every local interface.");

    const auto maxAutoPlaylistsText = trimmed(form.maxAutoPlaylists);
    if (maxAutoPlaylistsText.empty() ||
        !std::all_of(maxAutoPlaylistsText.begin(), maxAutoPlaylistsText.end(), isDigit))
        return refusing("The autoplaylist limit must be a whole number of 0 or more.");

    int maxAutoPlaylistsValue = 0;
    try {
        maxAutoPlaylistsValue = std::stoi(maxAutoPlaylistsText);
    } catch (const std::exception&) {
        return refusing("The autoplaylist limit must be a whole number of 0 or more.");
    }

    auto allowedHosts = splitLines(form.allowedHosts);
    std::transform(allowedHosts.begin(), allowedHosts.end(), allowedHosts.begin(),
                   withoutTrailingDot);

    for (const auto& host : allowedHosts) {
        if (!couldMatchARequest(host)) {
            return refusing("'" + host +
                            "' could not match a request's Host, so it would never admit "
                            "anyone.");
        }
    }

    Settings settings = unshown;
    settings.port = portValue;
    settings.bindAddress = bindAddress;
    settings.allowedOrigins = splitLines(form.allowedOrigins);
    settings.allowedFields = splitLines(form.allowedFields);
    settings.writePlaylists = form.writePlaylists;
    settings.controlPlayback = form.controlPlayback;
    settings.changeOutput = form.changeOutput;
    settings.streamingEnabled = form.streamingEnabled;
    settings.maxAutoPlaylists = maxAutoPlaylistsValue;
    settings.allowedHosts = std::move(allowedHosts);
    settings.openBrowserAtStart = form.openBrowserAtStart;

    FormReading reading;
    reading.settings = std::move(settings);
    return reading;
}

bool restartNeeded(const Settings& running, const Settings& saved) {
    return !decideReload(running, serialiseSettings(saved)).restartKeys.empty();
}

SettingsEditor::SettingsEditor(std::function<Settings()> load,
                               std::function<void(const Settings&)> save,
                               std::function<bool(const Settings&)> restartNeeded)
    : load_(std::move(load)),
      save_(std::move(save)),
      restartNeeded_(std::move(restartNeeded)),
      saved_(load_()) {}

SettingsForm SettingsEditor::shown() const {
    return toForm(saved_);
}

bool SettingsEditor::differs(const SettingsForm& onScreen) const {
    return onScreen != shown();
}

const Settings& SettingsEditor::saved() const {
    return saved_;
}

ApplyOutcome SettingsEditor::apply(PageId page, const SettingsForm& onScreen) {
    saved_ = load_();

    SettingsForm form = toForm(saved_);
    for (const SettingEntry& entry : kSettingEntries) {
        if (entry.page != page)
            continue;
        if (entry.text != nullptr)
            form.*entry.text = onScreen.*entry.text;
        if (entry.toggle != nullptr)
            form.*entry.toggle = onScreen.*entry.toggle;
    }

    ApplyOutcome outcome;
    const auto reading = readForm(form, saved_);
    if (!reading.ok()) {
        outcome.refusal = reading.error;
        return outcome;
    }

    try {
        save_(reading.settings);
    } catch (const std::exception& e) {
        logError(std::string("could not save the configuration: ") + e.what());
        outcome.saveFailure = e.what()[0] != '\0' ? e.what() : "the save gave no reason";
        return outcome;
    }

    outcome.saved = true;
    outcome.restartNeeded = restartNeeded_(reading.settings);
    logInfo(outcome.restartNeeded
                ? "configuration saved from the preferences page; a restart is needed for some "
                  "changes to take effect"
                : "configuration saved from the preferences page");

    saved_ = reading.settings;
    outcome.form = toForm(saved_);
    return outcome;
}

// NOLINTNEXTLINE(readability-convert-member-functions-to-static)
SettingsForm SettingsEditor::reset() const {
    return defaultForm();
}

const char* pageName(PageId page) {
    for (const PageName& entry : kPageNames) {
        if (entry.page == page)
            return entry.name;
    }
    return "";
}

std::string pageNote(const ListenerStatus& status, int port, const std::string& configPathShown,
                     bool restartNeeded) {
    if (!status.listening && !status.error.empty())
        return status.error;

    if (!status.heldAddresses.empty())
        return heldAddressError(status.heldAddresses, port);

    return "Saved to " + configPathShown + "." +
           (restartNeeded ? " A restart is needed for some changes to take effect." : "");
}

}  // namespace jean
