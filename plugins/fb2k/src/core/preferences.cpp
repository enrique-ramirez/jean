#include "core/preferences.h"

#include <algorithm>
#include <cctype>
#include <numeric>
#include <sstream>
#include <string>
#include <vector>

namespace jean {

namespace {

// What a Win32 multiline edit box hands back, and therefore what it must be given.
constexpr char kLineBreak[] = "\r\n";
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
                                   out += kLineBreak;
                               return out += entry;
                           });
}

bool isDigit(char c) {
    return std::isdigit(static_cast<unsigned char>(c)) != 0;
}

// Printable ASCII with no space. The token travels in an HTTP header, where anything else
// is either unsendable or a paste that brought its surroundings along.
bool isTokenCharacter(char c) {
    const auto value = static_cast<unsigned char>(c);
    return value > 0x20 && value < 0x7f;
}

FormReading refusing(std::string error) {
    FormReading reading;
    reading.error = std::move(error);
    return reading;
}

}  // namespace

bool operator==(const SettingsForm& a, const SettingsForm& b) {
    return a.port == b.port && a.bindAddress == b.bindAddress && a.authToken == b.authToken &&
           a.allowedOrigins == b.allowedOrigins && a.allowedFields == b.allowedFields &&
           a.writePlaylists == b.writePlaylists;
}

SettingsForm toForm(const Settings& settings) {
    SettingsForm form;
    form.port = std::to_string(settings.port);
    form.bindAddress = settings.bindAddress;
    form.authToken = settings.authToken;
    form.allowedOrigins = joinLines(settings.allowedOrigins);
    form.allowedFields = joinLines(settings.allowedFields);
    form.writePlaylists = settings.writePlaylists;
    return form;
}

SettingsForm defaultForm(std::string keepToken) {
    auto form = toForm(Settings());
    form.authToken = std::move(keepToken);
    return form;
}

FormReading readForm(const SettingsForm& form, const Settings& unshown) {
    Settings settings = unshown;

    const auto port = trimmed(form.port);
    if (port.empty())
        return refusing("A port is required.");
    if (!std::all_of(port.begin(), port.end(), isDigit))
        return refusing("The port must be a whole number.");

    // Digits only by now, so out of range is the one thing left that can go wrong -- and a
    // number too long for an int arrives here as an exception rather than a value.
    try {
        settings.port = std::stoi(port);
    } catch (const std::exception&) {
        settings.port = 0;
    }
    if (settings.port < kMinPort || settings.port > kMaxPort)
        return refusing("The port must be between " + std::to_string(kMinPort) + " and " +
                        std::to_string(kMaxPort) + ".");

    settings.bindAddress = trimmed(form.bindAddress);
    if (settings.bindAddress.empty())
        return refusing("An address is required. Use 0.0.0.0 for every local interface.");

    settings.authToken = trimmed(form.authToken);
    if (settings.authToken.size() < kMinTokenLength) {
        return refusing("The token must be at least " + std::to_string(kMinTokenLength) +
                        " characters. There is no unauthenticated mode to fall back to.");
    }
    if (!std::all_of(settings.authToken.begin(), settings.authToken.end(), isTokenCharacter))
        return refusing("The token must not contain spaces or control characters.");

    settings.allowedOrigins = splitLines(form.allowedOrigins);
    settings.allowedFields = splitLines(form.allowedFields);
    settings.writePlaylists = form.writePlaylists;

    FormReading reading;
    reading.settings = std::move(settings);
    return reading;
}

}  // namespace jean
