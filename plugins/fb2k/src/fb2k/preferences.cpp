#include "fb2k/PCH.h"

#include "core/log.h"
#include "core/preferences.h"
#include "fb2k/config_file.h"
#include "fb2k/paths.h"
#include "fb2k/resource.h"
#include "fb2k/running_server.h"
#include "fb2k/running_settings.h"
#include "fb2k/strings.h"
#include "fb2k/token.h"

#include <foobar2000/SDK/coreDarkMode.h>

#include <cstddef>
#include <ctime>
#include <string>

namespace {

using namespace jean;

constexpr char kPageName[] = "Jean";

constexpr char kDevicesName[] = "Devices";

constexpr GUID kPageGuid = {
    0x833e5a93, 0x92ba, 0x4dfe, {0x95, 0x93, 0xd5, 0x02, 0x90, 0xd8, 0xdd, 0x4c}};

constexpr GUID kDevicesGuid = {
    0x0f1c2b64, 0x5d7a, 0x4e18, {0xa2, 0x6b, 0x71, 0x14, 0x9c, 0x3f, 0x8e, 0x05}};

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
                                     {IDC_ORIGINS, &SettingsForm::allowedOrigins},
                                     {IDC_FIELDS, &SettingsForm::allowedFields}};

constexpr Control kDevicesControls[] = {{IDC_TOKEN, &SettingsForm::authToken}};

constexpr BoolControl kMainBoolControls[] = {{IDC_WRITE_PLAYLISTS, &SettingsForm::writePlaylists}};

struct Page {
    const char* name;
    int templateId;
    Controls controls;
    BoolControls boolControls;

    bool pairing;
    bool configPath;
};

constexpr Page kMainPage{kPageName, IDD_PREFERENCES, kMainControls, kMainBoolControls, false, true};
constexpr Page kDevicesPage{kDevicesName,   IDD_DEVICES, kDevicesControls,
                            BoolControls(), true,        false};

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

constexpr UINT_PTR kPairTimer = 1;

std::string minutesAndSeconds(int seconds) {
    return std::to_string(seconds / 60) + ":" + (seconds % 60 < 10 ? "0" : "") +
           std::to_string(seconds % 60);
}

std::string whenPaired(std::chrono::system_clock::time_point at) {
    const auto stamp = std::chrono::system_clock::to_time_t(at);
    std::tm parts{};
    if (localtime_s(&parts, &stamp) != 0)
        return "at an unknown time";

    char buffer[32];
    if (std::strftime(buffer, sizeof buffer, "%Y-%m-%d %H:%M", &parts) == 0)
        return "at an unknown time";

    return buffer;
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
        show(defaultForm(currentForm().authToken));
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

        logInfo("configuration saved from the preferences page; restart to apply it");

        saved_ = reading.settings;
        show(toForm(saved_));
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

            // The pairing window outlives this dialog on purpose, so closing preferences
            // mid-pair does not strand a device about to press Pair. The timer must not.
            KillTimer(dialog, kPairTimer);

            SetWindowLongPtrW(dialog, GWLP_USERDATA, 0);
            return FALSE;
        }

        if (message == WM_TIMER && wParam == kPairTimer) {
            self->showPairing();
            return TRUE;
        }

        return message == WM_COMMAND ? self->onCommand(HIWORD(wParam), LOWORD(wParam)) : FALSE;
    }

    void onInitDialog(HWND dialog) {
        dialog_ = dialog;

        // foobar2000's own copy of the hooks, so libPPUI is not needed.
        dark_.AddDialogWithControls(dialog);

        show(toForm(saved_));

        if (page_.configPath) {
            const auto status = listenerStatus();
            if (!status.listening && !status.error.empty()) {
                writeControl(dialog, IDC_CONFIG_PATH, status.error);
            } else {
                writeControl(dialog, IDC_CONFIG_PATH,
                             "Saved to " + displayConfigPath() +
                                 ". Changes take effect when foobar2000 restarts.");
            }
        }

        if (page_.pairing)
            showPairing();

        live_ = true;
    }

    INT_PTR onCommand(int notification, int id) {
        if (id == IDC_REGENERATE && notification == BN_CLICKED) {
            regenerateToken();
            return TRUE;
        }

        if (id == IDC_PAIR && notification == BN_CLICKED) {
            togglePairing();
            return TRUE;
        }

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

    void togglePairing() {
        if (!isServing()) {
            popup_message::g_show(
                "foo_jean is not listening, so there is nothing to pair with. Check the port "
                "and the log, then restart foobar2000.",
                page_.name);
            return;
        }

        if (pairingState().open)
            closePairingWindow();
        else
            openPairingWindow();

        showPairing();
    }

    void showPairing() {
        const auto state = pairingState();

        writeControl(dialog_, IDC_PAIR, state.open ? "Stop pairing" : "Pair a device");

        if (!isServing()) {
            writeControl(dialog_, IDC_PAIR_STATUS, "Not listening, so pairing is unavailable.");
        } else if (state.open) {
            writeControl(dialog_, IDC_PAIR_STATUS,
                         "Open for " + minutesAndSeconds(state.remainingSeconds) +
                             " — press Pair in Jean on the device now.");
        } else {
            writeControl(dialog_, IDC_PAIR_STATUS, "Closed. One device may pair per press.");
        }

        if (state.history.empty()) {
            writeControl(dialog_, IDC_PAIR_HISTORY, "Nothing has paired with this install.");
        } else {
            const auto& last = state.history.back();
            writeControl(
                dialog_, IDC_PAIR_HISTORY,
                "Last paired: " +
                    (last.name.empty() ? last.address : last.name + " (" + last.address + ")") +
                    ", " + whenPaired(last.at) + ".");
        }

        if (state.open)
            SetTimer(dialog_, kPairTimer, 1000, nullptr);
        else
            KillTimer(dialog_, kPairTimer);
    }

    void regenerateToken() {
        const auto token = generateToken();

        if (token.empty()) {
            popup_message::g_show("The operating system would not supply a random token.",
                                  page_.name);
            return;
        }

        writeControl(dialog_, IDC_TOKEN, token);
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

class DevicesPage : public preferences_page_v3 {
public:
    const char* get_name() override { return kDevicesName; }
    GUID get_guid() override { return kDevicesGuid; }
    GUID get_parent_guid() override { return kPageGuid; }

    preferences_page_instance::ptr instantiate(fb2k::hwnd_t parent,
                                               preferences_page_callback::ptr callback) override {
        return fb2k::service_new<PreferencesInstance>(kDevicesPage, parent, callback);
    }
};

preferences_page_factory_t<PreferencesPage> g_preferences_page;
preferences_page_factory_t<DevicesPage> g_devices_page;

}  // namespace
