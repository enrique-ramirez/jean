#include "fb2k/PCH.h"

#include <windows.h>

#include "core/preferences.h"
#include "fb2k/config_file.h"
#include "fb2k/paths.h"
#include "fb2k/preferences_ids.h"
#include "fb2k/resource.h"
#include "fb2k/running_server.h"
#include "fb2k/running_settings.h"
#include "fb2k/strings.h"

#include <foobar2000/SDK/coreDarkMode.h>

#include <cstddef>
#include <iterator>
#include <optional>
#include <string>

namespace {

using namespace jean;

constexpr int kNoControl = 0;

struct EntryControls {
    int value;
    int label;
    int hint;
};

constexpr EntryControls kEntryControls[] = {
    {IDC_PORT, IDC_PORT_LABEL, kNoControl},
    {IDC_BIND, IDC_BIND_LABEL, IDC_BIND_HINT},
    {IDC_ORIGINS, IDC_ORIGINS_GROUP, IDC_ORIGINS_HINT},
    {IDC_OPEN_BROWSER, IDC_OPEN_BROWSER, kNoControl},
    {IDC_CONTROL_PLAYBACK, IDC_CONTROL_PLAYBACK, kNoControl},
    {IDC_WRITE_PLAYLISTS, IDC_WRITE_PLAYLISTS, kNoControl},
    {IDC_CHANGE_OUTPUT, IDC_CHANGE_OUTPUT, kNoControl},
    {IDC_STREAMING_ENABLED, IDC_STREAMING_ENABLED, kNoControl},
    {IDC_FIELDS, IDC_FIELDS_GROUP, IDC_FIELDS_HINT},
    {IDC_MAX_AUTOPLAYLISTS, IDC_MAX_AUTOPLAYLISTS_LABEL, kNoControl},
    {IDC_HOSTS, IDC_HOSTS_GROUP, IDC_HOSTS_HINT},
};
static_assert(std::size(kEntryControls) == kSettingEntryCount);

constexpr int kGroupControls[] = {IDC_NETWORKING_GROUP, IDC_STARTUP_GROUP, IDC_PERMISSIONS_GROUP};
static_assert(std::size(kGroupControls) == std::size(kSettingGroups));

struct Page {
    PageId id;
    int templateId;
};

constexpr Page kMainPage{PageId::jean, IDD_PREFERENCES};
constexpr Page kPermissionsPage{PageId::permissions, IDD_PERMISSIONS};

std::string readControl(HWND dialog, int id) {
    auto* const control = GetDlgItem(dialog, id);
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

class PreferencesInstance : public preferences_page_instance {
public:
    PreferencesInstance(const Page& page, fb2k::hwnd_t parent,
                        preferences_page_callback::ptr callback)
        : page_(page),
          callback_(std::move(callback)),
          editor_(loadSettings, saveSettings,
                  [](const Settings& saved) { return restartNeeded(saved); }) {
        if (!CreateDialogParamW(core_api::get_my_instance(), MAKEINTRESOURCEW(page.templateId),
                                parent, proc, reinterpret_cast<LPARAM>(this))) {
            throw exception_win32(GetLastError());
        }
    }

    fb2k::hwnd_t get_wnd() override { return dialog_; }

    t_uint32 get_state() override {
        t_uint32 state = preferences_state::resettable | preferences_state::dark_mode_supported;

        if (editor_.differs(currentForm()))
            state |= preferences_state::changed;

        if (restartNeeded(editor_.saved()))
            state |= preferences_state::needs_restart;

        return state;
    }

    void reset() override {
        show(editor_.reset());
        callback_->on_state_changed();
    }

    void apply() override {
        const auto outcome = editor_.apply(page_.id, currentForm());
        if (!outcome.refusal.empty()) {
            popup_message::g_show(outcome.refusal.c_str(), pageName(page_.id));
            return;
        }
        if (!outcome.saveFailure.empty()) {
            popup_message::g_complain("Saving the Jean configuration", outcome.saveFailure.c_str());
            return;
        }

        show(outcome.form);
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

        writeWording();

        // foobar2000's own copy of the hooks, so libPPUI is not needed.
        dark_.AddDialogWithControls(dialog);

        show(editor_.shown());
        updateConfigNote();

        live_ = true;
    }

    INT_PTR onCommand(int notification, int id) {
        for (size_t i = 0; i < kSettingEntryCount; ++i) {
            const SettingEntry& entry = kSettingEntries[i];
            if (entry.page == page_.id && entry.kind == ControlKind::toggle &&
                kEntryControls[i].value == id && notification == BN_CLICKED) {
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

    void writeWording() {
        for (size_t i = 0; i < std::size(kSettingGroups); ++i) {
            if (kSettingGroups[i].page == page_.id)
                writeControl(dialog_, kGroupControls[i], kSettingGroups[i].caption);
        }

        for (size_t i = 0; i < kSettingEntryCount; ++i) {
            const SettingEntry& entry = kSettingEntries[i];
            if (entry.page != page_.id)
                continue;

            const EntryControls& controls = kEntryControls[i];
            writeControl(dialog_, controls.label, entry.label);
            if (controls.hint != kNoControl)
                writeControl(dialog_, controls.hint, entry.hint);
        }
    }

    void updateConfigNote() {
        if (page_.id != PageId::jean)
            return;

        const auto& saved = editor_.saved();
        writeControl(dialog_, IDC_CONFIG_PATH,
                     pageNote(listenerStatus(), runningPort().value_or(saved.port),
                              displayConfigPath(), restartNeeded(saved)));
    }

    void show(const SettingsForm& form) {
        for (size_t i = 0; i < kSettingEntryCount; ++i) {
            const SettingEntry& entry = kSettingEntries[i];
            if (entry.page != page_.id)
                continue;

            const int id = kEntryControls[i].value;
            if (entry.kind == ControlKind::toggle)
                writeCheckbox(dialog_, id, form.*entry.toggle);
            else
                writeControl(dialog_, id, form.*entry.text);
        }
    }

    SettingsForm currentForm() const {
        auto form = editor_.shown();
        if (!live_)
            return form;

        for (size_t i = 0; i < kSettingEntryCount; ++i) {
            const SettingEntry& entry = kSettingEntries[i];
            if (entry.page != page_.id)
                continue;

            const int id = kEntryControls[i].value;
            if (entry.kind == ControlKind::toggle)
                form.*entry.toggle = readCheckbox(dialog_, id);
            else
                form.*entry.text = readControl(dialog_, id);
        }
        return form;
    }

    const Page page_;
    const preferences_page_callback::ptr callback_;
    SettingsEditor editor_;
    HWND dialog_ = nullptr;
    bool live_ = false;
    fb2k::CCoreDarkModeHooks dark_;
};

class PreferencesPage : public preferences_page_v3 {
public:
    const char* get_name() override { return pageName(PageId::jean); }
    GUID get_guid() override { return kJeanPageGuid; }
    GUID get_parent_guid() override { return guid_tools; }

    preferences_page_instance::ptr instantiate(fb2k::hwnd_t parent,
                                               preferences_page_callback::ptr callback) override {
        return fb2k::service_new<PreferencesInstance>(kMainPage, parent, callback);
    }
};

class PermissionsPage : public preferences_page_v3 {
public:
    const char* get_name() override { return pageName(PageId::permissions); }
    GUID get_guid() override { return kPermissionsPageGuid; }
    GUID get_parent_guid() override { return kJeanPageGuid; }

    preferences_page_instance::ptr instantiate(fb2k::hwnd_t parent,
                                               preferences_page_callback::ptr callback) override {
        return fb2k::service_new<PreferencesInstance>(kPermissionsPage, parent, callback);
    }
};

preferences_page_factory_t<PreferencesPage> g_preferences_page;
preferences_page_factory_t<PermissionsPage> g_permissions_page;

}  // namespace
