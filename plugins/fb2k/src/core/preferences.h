#pragma once

#include "core/settings.h"

#include <cstddef>
#include <functional>
#include <iterator>
#include <string>

namespace jean {

struct ListenerStatus;

// What a Win32 multiline edit box hands back, and therefore what it must be given.
inline constexpr char kListLineBreak[] = "\r\n";

struct SettingsForm {
    std::string port;
    std::string bindAddress;
    std::string allowedOrigins;
    std::string allowedFields;
    bool writePlaylists = true;
    bool controlPlayback = true;
    bool changeOutput = true;
    bool streamingEnabled = true;
    std::string maxAutoPlaylists;
    std::string allowedHosts;
    bool openBrowserAtStart = false;
};

bool operator==(const SettingsForm& a, const SettingsForm& b);
inline bool operator!=(const SettingsForm& a, const SettingsForm& b) {
    return !(a == b);
}

SettingsForm toForm(const Settings& settings);

SettingsForm defaultForm();

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

bool restartNeeded(const Settings& running, const Settings& saved);

enum class PageId { jean, permissions };
enum class ControlKind { text, number, lines, toggle };

struct PageName {
    PageId page;
    const char* name;
};

struct SettingGroup {
    PageId page;
    const char* caption;
};

constexpr int kNoGroup = -1;

struct SettingEntry {
    PageId page;
    int group;
    ControlKind kind;
    std::string SettingsForm::* text;
    bool SettingsForm::* toggle;
    const char* label;
    const char* hint;
};

inline constexpr PageName kPageNames[] = {{PageId::jean, "Jean"},
                                          {PageId::permissions, "Permissions"}};

inline constexpr char kApplyLabel[] = "Apply";
inline constexpr char kResetLabel[] = "Reset";

const char* pageName(PageId page);

inline constexpr SettingGroup kSettingGroups[] = {
    {PageId::jean, "Networking"},
    {PageId::jean, "Startup"},
    {PageId::permissions, "Permissions"},
};

inline constexpr SettingEntry kSettingEntries[] = {
    {PageId::jean, 0, ControlKind::number, &SettingsForm::port, nullptr, "Port:", ""},
    {PageId::jean, 0, ControlKind::text, &SettingsForm::bindAddress, nullptr,
     "Address:", "0.0.0.0 is every local interface. 127.0.0.1 is this machine only."},
    {PageId::jean, kNoGroup, ControlKind::lines, &SettingsForm::allowedOrigins, nullptr,
     "Allowed origins", "One per line. An empty list reflects no origin."},
    {PageId::jean, 1, ControlKind::toggle, nullptr, &SettingsForm::openBrowserAtStart,
     "Open Jean in the default browser when foobar2000 starts", ""},
    {PageId::permissions, 2, ControlKind::toggle, nullptr, &SettingsForm::controlPlayback,
     "Allow Jean to control playback", ""},
    {PageId::permissions, 2, ControlKind::toggle, nullptr, &SettingsForm::writePlaylists,
     "Allow Jean to change playlists", ""},
    {PageId::permissions, 2, ControlKind::toggle, nullptr, &SettingsForm::changeOutput,
     "Allow Jean to change the output device", ""},
    {PageId::permissions, 2, ControlKind::toggle, nullptr, &SettingsForm::streamingEnabled,
     "Allow Jean to stream audio", ""},
    {PageId::permissions, kNoGroup, ControlKind::lines, &SettingsForm::allowedFields, nullptr,
     "Fields this may write", "One per line. Nothing outside this list is ever written."},
    {PageId::permissions, kNoGroup, ControlKind::number, &SettingsForm::maxAutoPlaylists, nullptr,
     "Autoplaylist limit:", ""},
    {PageId::permissions, kNoGroup, ControlKind::lines, &SettingsForm::allowedHosts, nullptr,
     "Allowed hosts",
     "One per line. *.lan, *.local, *.home.arpa, an IP address, localhost and a name with no "
     "dot are always admitted."},
};

inline constexpr size_t kSettingEntryCount = std::size(kSettingEntries);

struct ApplyOutcome {
    std::string refusal;
    std::string saveFailure;
    SettingsForm form;
    bool restartNeeded = false;
    bool saved = false;

    bool ok() const { return saved; }
};

class SettingsEditor {
public:
    SettingsEditor(std::function<Settings()> load, std::function<void(const Settings&)> save,
                   std::function<bool(const Settings&)> restartNeeded);

    SettingsForm shown() const;
    bool differs(const SettingsForm& onScreen) const;
    const Settings& saved() const;

    ApplyOutcome apply(PageId page, const SettingsForm& onScreen);

    SettingsForm reset() const;

private:
    std::function<Settings()> load_;
    std::function<void(const Settings&)> save_;
    std::function<bool(const Settings&)> restartNeeded_;
    Settings saved_;
};

std::string pageNote(const ListenerStatus& status, int port, const std::string& configPathShown,
                     bool restartNeeded);

}  // namespace jean
