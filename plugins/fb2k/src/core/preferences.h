#pragma once

#include "core/settings.h"

#include <string>

// Everything the preferences page decides. The page itself is Windows and lives in
// fb2k/preferences.cpp, which does nothing but move text between controls and these
// functions. config.json remains the source of truth.
namespace jean {

struct SettingsForm {
    std::string port;
    std::string bindAddress;
    std::string authToken;
    std::string allowedOrigins;
    std::string allowedFields;
    bool writePlaylists = true;
};

bool operator==(const SettingsForm& a, const SettingsForm& b);
inline bool operator!=(const SettingsForm& a, const SettingsForm& b) {
    return !(a == b);
}

SettingsForm toForm(const Settings& settings);

// The defaults, except the token: blanking the one already in the file would leave the
// component refusing to serve.
SettingsForm defaultForm(std::string keepToken);

struct FormReading {
    std::string error;

    Settings settings;

    bool ok() const { return error.empty(); }
};

// Stricter than parseSettings on purpose: a headless player must still come up on a bad
// hand-edited key, but here there is a person at the dialog, so this refuses and applies
// nothing until every field is right.
//
// `unshown` carries through the settings this page has no control for, and is required
// rather than defaulted because forgetting it would silently reset a key somebody set by
// hand.
FormReading readForm(const SettingsForm& form, const Settings& unshown);

}  // namespace jean
