#include "fb2k/PCH.h"

#include "core/log.h"
#include "core/preferences.h"
#include "fb2k/config_file.h"
#include "fb2k/paths.h"
#include "fb2k/resource.h"
#include "fb2k/running_server.h"
#include "fb2k/running_settings.h"
#include "fb2k/strings.h"

#include <foobar2000/SDK/coreDarkMode.h>

#include <cstddef>
#include <string>

namespace {

using namespace jean;

constexpr char kPageName[] = "Jean";

constexpr char kPermissionsName[] = "Permissions";

constexpr GUID kPageGuid = {
    0x833e5a93, 0x92ba, 0x4dfe, {0x95, 0x93, 0xd5, 0x02, 0x90, 0xd8, 0xdd, 0x4c}};

constexpr GUID kPermissionsGuid = {
    0x7e78cbe3, 0xc7ac, 0x4484, {0xae, 0x0d, 0x59, 0xe1, 0x06, 0x5a, 0xae, 0xcf}};

struct Control {
    int id;
    std::string SettingsForm::* field;
};

struct BoolControl {
    int id;
    bool SettingsForm::* field;
};

template <typename Entry>
class ControlList {
public:
    constexpr ControlList() : first_(nullptr), last_(nullptr) {}

    template <size_t N>
    constexpr ControlList(const Entry (&table)[N]) : first_(table), last_(table + N) {}

    constexpr const Entry* begin() const { return first_; }
    constexpr const Entry* end() const { return last_; }

private:
    const Entry* first_;
    const Entry* last_;
};

using Controls = ControlList<Control>;
using BoolControls = ControlList<BoolControl>;

constexpr Control kMainControls[] = {{IDC_PORT, &SettingsForm::port},
                                     {IDC_BIND, &SettingsForm::bindAddress},
                                     {IDC_ORIGINS, &SettingsForm::allowedOrigins}};

constexpr Control kPermissionsControls[] = {
    {IDC_FIELDS, &SettingsForm::allowedFields},
    {IDC_MAX_AUTOPLAYLISTS, &SettingsForm::maxAutoPlaylists},
    {IDC_HOSTS, &SettingsForm::allowedHosts}};

constexpr BoolControl kPermissionsBoolControls[] = {
    {IDC_CONTROL_PLAYBACK, &SettingsForm::controlPlayback},
    {IDC_WRITE_PLAYLISTS, &SettingsForm::writePlaylists},
    {IDC_CHANGE_OUTPUT, &SettingsForm::changeOutput},
    {IDC_STREAMING_ENABLED, &SettingsForm::streamingEnabled}};

struct Page {
    const char* name;
    int templateId;
    Controls controls;
    BoolControls boolControls;

    bool configPath;
};

constexpr Page kMainPage{kPageName, IDD_PREFERENCES, kMainControls, BoolControls(), true};
constexpr Page kPermissionsPage{kPermissionsName, IDD_PERMISSIONS, kPermissionsControls,
                                kPermissionsBoolControls, false};

std::string readControl(HWND dialog, int id) {
    const auto control = GetDlgItem(dialog, id);
    const auto length = GetWindowTextLengthW(control);

    std::wstring buffer(static_cast<size_t>(length) + 1, L'\0');
    buffer.resize(static_cast<size_t>(GetWindowTextW(control, buffer.data(), length + 1)));

    return toUtf8(buffer);
}

void writeControl(HWND dialog, int id, const std::string& text) {
    SetDlgItemTextW(dialog, id, toWide(text).c_str());
}

bool readCheckbox(HWND dialog, int id) {
    return IsDlgButtonChecked(dialog, id) == BST_CHECKED;
}

void writeCheckbox(HWND dialog, int id, bool checked) {
    CheckDlgButton(dialog, id, checked ? BST_CHECKED : BST_UNCHECKED);
}

std::string displayConfigPath() {
    pfc::string8 display;
    filesystem::g_get_display_path(configPath().c_str(), display);
    return toStd(display);
}

class PreferencesInstance : public preferences_page_instance {
public:
    PreferencesInstance(const Page& page, fb2k::hwnd_t parent,
                        preferences_page_callback::ptr callback)
        : page_(page), callback_(callback), saved_(loadSettings()) {
        if (!CreateDialogParamW(core_api::get_my_instance(), MAKEINTRESOURCEW(page.templateId),
                                parent, proc, reinterpret_cast<LPARAM>(this))) {
            throw exception_win32(GetLastError());
        }
    }

    fb2k::hwnd_t get_wnd() override { return dialog_; }

    t_uint32 get_state() override {
        t_uint32 state = preferences_state::resettable | preferences_state::dark_mode_supported;

        if (currentForm() != toForm(saved_))
            state |= preferences_state::changed;

        if (restartNeeded(saved_))
            state |= preferences_state::needs_restart;

        return state;
    }

    void reset() override {
        show(defaultForm());
        callback_->on_state_changed();
    }

    void apply() override {
        saved_ = loadSettings();

        const auto reading = readForm(currentForm(), saved_);
        if (!reading.ok()) {
            popup_message::g_show(reading.error.c_str(), page_.name);
            return;
        }

        try {
            saveSettings(reading.settings);
        } catch (const std::exception& e) {
            logError(std::string("could not save the configuration: ") + e.what());
            popup_message::g_complain("Saving the Jean configuration", e);
            return;
        }

        logInfo(restartNeeded(reading.settings)
                    ? "configuration saved from the preferences page; a restart is needed "
                      "for some changes to take effect"
                    : "configuration saved from the preferences page");

        saved_ = reading.settings;
        show(toForm(saved_));
        if (page_.configPath)
            updateConfigNote();
        callback_->on_state_changed();
    }

private:
    static INT_PTR CALLBACK proc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam) {
        if (message == WM_INITDIALOG) {
            SetWindowLongPtrW(dialog, GWLP_USERDATA, static_cast<LONG_PTR>(lParam));
            reinterpret_cast<PreferencesInstance*>(lParam)->onInitDialog(dialog);
            return FALSE;
        }

        auto* self =
            reinterpret_cast<PreferencesInstance*>(GetWindowLongPtrW(dialog, GWLP_USERDATA));
        if (!self)
            return FALSE;

        if (message == WM_DESTROY) {
            self->live_ = false;
            SetWindowLongPtrW(dialog, GWLP_USERDATA, 0);
            return FALSE;
        }

        return message == WM_COMMAND ? self->onCommand(HIWORD(wParam), LOWORD(wParam)) : FALSE;
    }

    void onInitDialog(HWND dialog) {
        dialog_ = dialog;

        // foobar2000's own copy of the hooks, so libPPUI is not needed.
        dark_.AddDialogWithControls(dialog);

        show(toForm(saved_));

        if (page_.configPath)
            updateConfigNote();

        live_ = true;
    }

    INT_PTR onCommand(int notification, int id) {
        for (const BoolControl& control : page_.boolControls) {
            if (control.id == id && notification == BN_CLICKED) {
                if (live_)
                    callback_->on_state_changed();
                return TRUE;
            }
        }

        if (notification != EN_CHANGE || !live_)
            return FALSE;

        callback_->on_state_changed();
        return TRUE;
    }

    void updateConfigNote() {
        const auto status = listenerStatus();
        if (!status.listening && !status.error.empty()) {
            writeControl(dialog_, IDC_CONFIG_PATH, status.error);
            return;
        }

        auto note = "Saved to " + displayConfigPath() + ".";
        if (restartNeeded(saved_))
            note += " A restart is needed for some changes to take effect.";
        writeControl(dialog_, IDC_CONFIG_PATH, note);
    }

    void show(const SettingsForm& form) {
        for (const Control& control : page_.controls)
            writeControl(dialog_, control.id, form.*control.field);
        for (const BoolControl& control : page_.boolControls)
            writeCheckbox(dialog_, control.id, form.*control.field);
    }

    SettingsForm currentForm() const {
        if (!live_)
            return toForm(saved_);

        auto form = toForm(saved_);
        for (const Control& control : page_.controls)
            form.*control.field = readControl(dialog_, control.id);
        for (const BoolControl& control : page_.boolControls)
            form.*control.field = readCheckbox(dialog_, control.id);
        return form;
    }

    const Page page_;
    const preferences_page_callback::ptr callback_;
    Settings saved_;
    HWND dialog_ = nullptr;
    bool live_ = false;
    fb2k::CCoreDarkModeHooks dark_;
};

class PreferencesPage : public preferences_page_v3 {
public:
    const char* get_name() override { return kPageName; }
    GUID get_guid() override { return kPageGuid; }
    GUID get_parent_guid() override { return guid_tools; }

    preferences_page_instance::ptr instantiate(fb2k::hwnd_t parent,
                                               preferences_page_callback::ptr callback) override {
        return fb2k::service_new<PreferencesInstance>(kMainPage, parent, callback);
    }
};

class PermissionsPage : public preferences_page_v3 {
public:
    const char* get_name() override { return kPermissionsName; }
    GUID get_guid() override { return kPermissionsGuid; }
    GUID get_parent_guid() override { return kPageGuid; }

    preferences_page_instance::ptr instantiate(fb2k::hwnd_t parent,
                                               preferences_page_callback::ptr callback) override {
        return fb2k::service_new<PreferencesInstance>(kPermissionsPage, parent, callback);
    }
};

preferences_page_factory_t<PreferencesPage> g_preferences_page;
preferences_page_factory_t<PermissionsPage> g_permissions_page;

}  // namespace
