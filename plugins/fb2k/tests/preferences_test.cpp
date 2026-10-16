// settings_test.cpp asserts that a bad config.json never stops the player. This asserts the
// other direction: a bad dialog never becomes a config.json.

#include "third_party/doctest.h"

#include "core/http_server.h"
#include "core/preferences.h"

#include "support/log_capture.h"
#include "support/repository.h"

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <fstream>
#include <functional>
#include <iterator>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;

namespace {

SettingsForm goodForm() {
    SettingsForm form;
    form.port = "8881";
    form.bindAddress = "0.0.0.0";
    form.allowedOrigins = "";
    form.allowedFields = "rating";
    form.maxAutoPlaylists = "100";
    return form;
}

}  // namespace

TEST_CASE("the form shows what the settings say") {
    Settings settings;
    settings.port = 9001;
    settings.bindAddress = "127.0.0.1";
    settings.allowedOrigins = {"https://jean.example", "http://127.0.0.1:8880"};
    settings.allowedFields = {"rating", "comment"};

    const auto form = toForm(settings);

    CHECK(form.port == "9001");
    CHECK(form.bindAddress == "127.0.0.1");
    CHECK(form.allowedFields == "rating\r\ncomment");
}

// A Win32 multiline edit box only breaks a line on CRLF.
TEST_CASE("lists are separated the way an edit box separates them") {
    Settings settings;
    settings.allowedOrigins = {"a", "b", "c"};

    CHECK(toForm(settings).allowedOrigins == "a\r\nb\r\nc");
}

TEST_CASE("an empty list is an empty box rather than a blank line") {
    Settings settings;
    settings.allowedOrigins = {};

    CHECK(toForm(settings).allowedOrigins.empty());
    CHECK(readForm(toForm(settings), Settings()).settings.allowedOrigins.empty());
}

TEST_CASE("a settings round trip through the form is lossless") {
    Settings original;
    original.port = 9001;
    original.bindAddress = "192.168.1.10";
    original.allowedOrigins = {"https://jean.example"};
    original.allowedFields = {"rating", "comment"};

    const auto reading = readForm(toForm(original), Settings());

    REQUIRE(reading.ok());
    CHECK(reading.settings == original);
}

TEST_CASE("the bare defaults round-trip through the form") {
    const auto reading = readForm(toForm(Settings()), Settings());

    REQUIRE(reading.ok());
    CHECK(reading.settings == Settings());
}

TEST_CASE("resetting reaches the same defaults the form starts from") {
    const auto form = defaultForm();

    CHECK(form.port == std::to_string(Settings().port));
    CHECK(form.bindAddress == Settings().bindAddress);
    CHECK(form.allowedFields == "rating\r\nunsynced lyrics");

    const auto reading = readForm(form, Settings());
    REQUIRE(reading.ok());
    CHECK(reading.settings == Settings());
}

TEST_CASE("surrounding whitespace is a typing accident rather than a value") {
    auto form = goodForm();
    form.port = "  8881 ";
    form.bindAddress = "\t127.0.0.1  ";

    const auto reading = readForm(form, Settings());

    REQUIRE(reading.ok());
    CHECK(reading.settings.port == 8881);
    CHECK(reading.settings.bindAddress == "127.0.0.1");
}

TEST_CASE("a port that is not a port is refused, not rounded") {
    for (const auto* typed : {"", "   ", "eight thousand", "88 81", "8881x", "-1", "0", "65536"}) {
        auto form = goodForm();
        form.port = typed;

        const auto reading = readForm(form, Settings());

        CHECK_FALSE(reading.ok());
        CHECK(reading.error.find("port") != std::string::npos);
    }
}

// More digits than an int holds reaches the parser as an exception rather than as a number.
TEST_CASE("a port too long to be a number is still just a refusal") {
    auto form = goodForm();
    form.port = "99999999999999999999";

    CHECK_FALSE(readForm(form, Settings()).ok());
}

TEST_CASE("the edges of the port range are inside it") {
    for (const auto* typed : {"1", "65535"}) {
        auto form = goodForm();
        form.port = typed;

        CHECK(readForm(form, Settings()).ok());
    }
}

TEST_CASE("an empty address is refused, and the message says what to type") {
    auto form = goodForm();
    form.bindAddress = "   ";

    const auto reading = readForm(form, Settings());

    CHECK_FALSE(reading.ok());
    CHECK(reading.error.find("0.0.0.0") != std::string::npos);
}

TEST_CASE("a refused form is never half applied") {
    auto form = goodForm();
    form.port = "not a port";
    form.allowedFields = "rating\r\ncomment";

    const auto reading = readForm(form, Settings());

    REQUIRE_FALSE(reading.ok());
    CHECK(reading.settings.allowedFields == Settings().allowedFields);
}

TEST_CASE("a list is read a line at a time, however the box breaks them") {
    auto form = goodForm();
    form.allowedFields = "rating\r\n  comment  \n\r\n\r\ncomposer\r\n";

    const auto reading = readForm(form, Settings());

    REQUIRE(reading.ok());
    CHECK(reading.settings.allowedFields ==
          std::vector<std::string>{"rating", "comment", "composer"});
}

TEST_CASE("clearing the allowlist means writing nothing, not writing the default") {
    auto form = goodForm();
    form.allowedFields = "   \r\n  ";

    const auto reading = readForm(form, Settings());

    REQUIRE(reading.ok());
    CHECK(reading.settings.allowedFields.empty());
}

// The page enables Apply by comparing what is on screen with what was last saved.
TEST_CASE("two settings differ if any one field does") {
    const std::vector<Settings (*)()> oneFieldChanged{
        [] {
            auto s = Settings();
            s.port = 1;
            return s;
        },
        [] {
            auto s = Settings();
            s.bindAddress = "127.0.0.1";
            return s;
        },
        [] {
            auto s = Settings();
            s.allowedOrigins = {"https://jean.example"};
            return s;
        },
        [] {
            auto s = Settings();
            s.allowedFields = {};
            return s;
        },
    };

    CHECK(Settings() == Settings());

    for (const auto& altered : oneFieldChanged)
        CHECK(altered() != Settings());
}

TEST_CASE("two forms differ if any one control does") {
    const std::vector<SettingsForm (*)()> oneControlChanged{
        [] {
            auto f = goodForm();
            f.port = "8882";
            return f;
        },
        [] {
            auto f = goodForm();
            f.bindAddress = "127.0.0.1";
            return f;
        },
        [] {
            auto f = goodForm();
            f.allowedOrigins = "https://jean.example";
            return f;
        },
        [] {
            auto f = goodForm();
            f.allowedFields = "";
            return f;
        },
        [] {
            auto f = goodForm();
            f.openBrowserAtStart = true;
            return f;
        },
    };

    CHECK(goodForm() == goodForm());

    for (const auto& altered : oneControlChanged)
        CHECK(altered() != goodForm());
}

// The page has four controls and Settings has more fields than that.
TEST_CASE("a setting the page has no control for survives being applied") {
    Settings saved;
    saved.maxAutoPlaylists = 7;

    auto form = toForm(saved);
    form.port = "9001";

    const auto reading = readForm(form, saved);

    REQUIRE(reading.ok());
    CHECK(reading.settings.port == 9001);
    CHECK(reading.settings.maxAutoPlaylists == 7);
}

TEST_CASE("the checkbox decides whether playlists are writable, rather than what was saved") {
    for (const bool writable : {true, false}) {
        Settings shown;
        shown.writePlaylists = writable;

        Settings saved = shown;
        saved.writePlaylists = !writable;

        const auto reading = readForm(toForm(shown), saved);

        REQUIRE(reading.ok());
        CHECK(reading.settings.writePlaylists == writable);
    }
}

TEST_CASE("a ticked checkbox and an unticked one are not the same form") {
    const Settings writable;
    Settings readOnly = writable;
    readOnly.writePlaylists = false;

    CHECK(toForm(writable) != toForm(readOnly));
}

TEST_CASE("resetting permits playlist writes, because that is what an untouched setting means") {
    Settings readOnly;
    readOnly.writePlaylists = false;

    const auto reading = readForm(defaultForm(), readOnly);

    REQUIRE(reading.ok());
    CHECK(reading.settings.writePlaylists);
}

// core/preferences.h requires `unshown` rather than defaulting it because forgetting a key
// silently resets one somebody set by hand. This is that promise, over every such key.
TEST_CASE("every setting the page has no control for survives being applied") {
    Settings saved;
    saved.maxAutoPlaylists = 7;
    saved.opusBitrate = 64000;
    saved.aacBitrate = 96000;
    saved.streamingEnabled = false;
    saved.maxConcurrentStreams = 2;
    saved.streamTicketTtlSeconds = 30;
    saved.muteWhileStreaming = false;

    auto form = toForm(saved);
    form.port = "9001";

    const auto reading = readForm(form, saved);

    REQUIRE(reading.ok());
    CHECK(reading.settings.port == 9001);
    CHECK(reading.settings.maxAutoPlaylists == 7);
    CHECK(reading.settings.opusBitrate == 64000);
    CHECK(reading.settings.aacBitrate == 96000);
    CHECK_FALSE(reading.settings.streamingEnabled);
    CHECK(reading.settings.maxConcurrentStreams == 2);
    CHECK(reading.settings.streamTicketTtlSeconds == 30);
    CHECK_FALSE(reading.settings.muteWhileStreaming);
}

namespace {

template <typename T, typename = void>
struct HasAuthToken : std::false_type {};

template <typename T>
struct HasAuthToken<T, std::void_t<decltype(std::declval<T>().authToken)>> : std::true_type {};

// Every key the Permissions page shows, away from its default.
Settings permissionsAwayFromDefaults() {
    Settings settings;
    settings.controlPlayback = false;
    settings.writePlaylists = false;
    settings.changeOutput = false;
    settings.streamingEnabled = false;
    settings.allowedFields = {"rating", "comment"};
    settings.maxAutoPlaylists = 7;
    settings.allowedHosts = {"music.example", "jukebox.example"};
    return settings;
}

std::string lowered(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

}  // namespace

TEST_CASE("the startup checkbox is read from the form rather than from what was saved") {
    Settings opening;
    opening.openBrowserAtStart = true;
    CHECK(toForm(opening).openBrowserAtStart);

    const auto ticked = readForm(toForm(opening), Settings());
    REQUIRE(ticked.ok());
    CHECK(ticked.settings.openBrowserAtStart);

    const auto cleared = readForm(toForm(Settings()), opening);
    REQUIRE(cleared.ok());
    CHECK_FALSE(cleared.settings.openBrowserAtStart);
}

TEST_CASE("the form carries no token") {
    CHECK_FALSE(HasAuthToken<SettingsForm>::value);
}

TEST_CASE("the form shows every switch the Permissions page holds") {
    const auto form = toForm(permissionsAwayFromDefaults());

    CHECK_FALSE(form.controlPlayback);
    CHECK_FALSE(form.writePlaylists);
    CHECK_FALSE(form.changeOutput);
    CHECK_FALSE(form.streamingEnabled);
    CHECK(form.allowedFields == "rating\r\ncomment");
    CHECK(form.maxAutoPlaylists == "7");
    CHECK(form.allowedHosts == "music.example\r\njukebox.example");
}

// Read against defaults, so a switch the form forgot to read comes back at its default and the
// round trip catches it.
TEST_CASE("every switch round-trips from settings to form to settings and back to the same form") {
    const auto original = permissionsAwayFromDefaults();
    const auto form = toForm(original);

    const auto reading = readForm(form, Settings());

    REQUIRE(reading.ok());
    CHECK(reading.settings == original);
    CHECK(toForm(reading.settings) == form);
}

TEST_CASE("each switch is read from the form rather than from what was saved") {
    const auto shown = permissionsAwayFromDefaults();

    const auto reading = readForm(toForm(shown), Settings());
    REQUIRE(reading.ok());

    CHECK(reading.settings.controlPlayback == shown.controlPlayback);
    CHECK(reading.settings.writePlaylists == shown.writePlaylists);
    CHECK(reading.settings.changeOutput == shown.changeOutput);
    CHECK(reading.settings.streamingEnabled == shown.streamingEnabled);
    CHECK(reading.settings.allowedFields == shown.allowedFields);
    CHECK(reading.settings.maxAutoPlaylists == shown.maxAutoPlaylists);
    CHECK(reading.settings.allowedHosts == shown.allowedHosts);

    const auto back = readForm(toForm(Settings()), shown);
    REQUIRE(back.ok());
    CHECK(back.settings.controlPlayback);
    CHECK(back.settings.changeOutput);
    CHECK(back.settings.streamingEnabled);
    CHECK(back.settings.maxAutoPlaylists == Settings().maxAutoPlaylists);
    CHECK(back.settings.allowedHosts.empty());
}

// The page enables Apply by comparing what is on screen with what was last saved.
TEST_CASE("two forms differ if any one Permissions control does") {
    const auto base = toForm(Settings());

    const std::vector<std::pair<const char*, SettingsForm>> oneControlChanged{
        {"controlPlayback",
         [&] {
             auto f = base;
             f.controlPlayback = false;
             return f;
         }()},
        {"changeOutput",
         [&] {
             auto f = base;
             f.changeOutput = false;
             return f;
         }()},
        {"streamingEnabled",
         [&] {
             auto f = base;
             f.streamingEnabled = false;
             return f;
         }()},
        {"maxAutoPlaylists",
         [&] {
             auto f = base;
             f.maxAutoPlaylists = "7";
             return f;
         }()},
        {"allowedHosts",
         [&] {
             auto f = base;
             f.allowedHosts = "music.example";
             return f;
         }()},
    };

    for (const auto& [control, altered] : oneControlChanged) {
        const std::string name(control);
        INFO("control: ", name);
        CHECK(altered != base);
    }
}

TEST_CASE("an autoplaylist limit that is not a count is refused, and the sentence names it") {
    for (const auto* typed : {"seven", "-1", "7.5", "7 7", "99999999999999999999"}) {
        INFO("typed: ", std::string(typed));
        auto form = toForm(Settings());
        form.maxAutoPlaylists = typed;

        const auto reading = readForm(form, Settings());

        CHECK_FALSE(reading.ok());
        CHECK(lowered(reading.error).find("autoplaylist") != std::string::npos);
    }
}

TEST_CASE("an autoplaylist limit of zero is accepted, because zero is how creation is turned off") {
    auto form = toForm(Settings());
    form.maxAutoPlaylists = " 0 ";

    const auto reading = readForm(form, Settings());

    REQUIRE(reading.ok());
    CHECK(reading.settings.maxAutoPlaylists == 0);
}

// A listed name is compared whole against the Host a browser sends, with its port already gone,
// so an entry carrying a scheme, a port, a path or a space admits nobody, and the person who
// typed it would be left wondering why the page still refuses them.
TEST_CASE("a host that could never match a request is refused, and the sentence names it") {
    for (const auto* typed :
         {"http://music.example", "music.example:8881", "music.example/jean", "music example"}) {
        INFO("typed: ", std::string(typed));
        auto form = toForm(Settings());
        form.allowedHosts = std::string("jukebox.example\r\n") + typed;

        const auto reading = readForm(form, Settings());

        CHECK_FALSE(reading.ok());
        CHECK(reading.error.find(typed) != std::string::npos);
    }
}

TEST_CASE("a refused host list is never half applied") {
    auto form = toForm(Settings());
    form.allowedHosts = "jukebox.example\r\nhttp://music.example";
    form.controlPlayback = false;

    const auto reading = readForm(form, Settings());

    REQUIRE_FALSE(reading.ok());
    CHECK(reading.settings.allowedHosts.empty());
    CHECK(reading.settings.controlPlayback);
}

TEST_CASE("nothing needs a restart while what was saved is what is running") {
    const auto running = permissionsAwayFromDefaults();

    CHECK_FALSE(restartNeeded(running, running));
}

TEST_CASE("each restart-only key that differs from what is running needs a restart") {
    const Settings running;

    const std::vector<std::pair<const char*, Settings>> oneKeyChanged{
        {"port",
         [&] {
             auto s = running;
             s.port = 9001;
             return s;
         }()},
        {"bindAddress",
         [&] {
             auto s = running;
             s.bindAddress = "127.0.0.1";
             return s;
         }()},
        {"opusBitrate",
         [&] {
             auto s = running;
             s.opusBitrate = 128000;
             return s;
         }()},
        {"aacBitrate",
         [&] {
             auto s = running;
             s.aacBitrate = 96000;
             return s;
         }()},
        {"maxConcurrentStreams",
         [&] {
             auto s = running;
             s.maxConcurrentStreams = 2;
             return s;
         }()},
        {"streamTicketTtlSeconds",
         [&] {
             auto s = running;
             s.streamTicketTtlSeconds = 60;
             return s;
         }()},
        {"muteWhileStreaming",
         [&] {
             auto s = running;
             s.muteWhileStreaming = false;
             return s;
         }()},
        {"maxSessions",
         [&] {
             auto s = running;
             s.maxSessions = 2;
             return s;
         }()},
        {"openBrowserAtStart",
         [&] {
             auto s = running;
             s.openBrowserAtStart = true;
             return s;
         }()},
    };

    for (const auto& [key, saved] : oneKeyChanged) {
        const std::string name(key);
        INFO("key: ", name);
        CHECK(restartNeeded(running, saved));
    }
}

// A switch reloads live, so asking for a restart over one would teach an owner to restart
// foobar2000 for nothing, and to stop reading the notice.
TEST_CASE("a live key that differs from what is running needs no restart") {
    const Settings running;

    const std::vector<std::pair<const char*, Settings>> oneKeyChanged{
        {"controlPlayback",
         [&] {
             auto s = running;
             s.controlPlayback = false;
             return s;
         }()},
        {"writePlaylists",
         [&] {
             auto s = running;
             s.writePlaylists = false;
             return s;
         }()},
        {"changeOutput",
         [&] {
             auto s = running;
             s.changeOutput = false;
             return s;
         }()},
        {"streamingEnabled",
         [&] {
             auto s = running;
             s.streamingEnabled = false;
             return s;
         }()},
        {"allowedFields",
         [&] {
             auto s = running;
             s.allowedFields = {};
             return s;
         }()},
        {"maxAutoPlaylists",
         [&] {
             auto s = running;
             s.maxAutoPlaylists = 7;
             return s;
         }()},
        {"allowedHosts",
         [&] {
             auto s = running;
             s.allowedHosts = {"music.example"};
             return s;
         }()},
        {"allowedOrigins",
         [&] {
             auto s = running;
             s.allowedOrigins = {"https://jean.example"};
             return s;
         }()},
    };

    for (const auto& [key, saved] : oneKeyChanged) {
        const std::string name(key);
        INFO("key: ", name);
        CHECK_FALSE(restartNeeded(running, saved));
    }

    CHECK_FALSE(restartNeeded(running, permissionsAwayFromDefaults()));
}

// The structured binding is what stops the suite compiling when SettingsForm gains or loses a
// member, so the declaration cannot be left behind by one.
TEST_CASE(
    "every member of the form is reached by exactly one entry, through the pointer its kind "
    "calls for") {
    SettingsForm form;
    auto& [port, bindAddress, allowedOrigins, allowedFields, writePlaylists, controlPlayback,
           changeOutput, streamingEnabled, maxAutoPlaylists, allowedHosts, openBrowserAtStart] =
        form;

    const std::vector<std::pair<const char*, const void*>> members{
        {"port", &port},
        {"bindAddress", &bindAddress},
        {"allowedOrigins", &allowedOrigins},
        {"allowedFields", &allowedFields},
        {"writePlaylists", &writePlaylists},
        {"controlPlayback", &controlPlayback},
        {"changeOutput", &changeOutput},
        {"streamingEnabled", &streamingEnabled},
        {"maxAutoPlaylists", &maxAutoPlaylists},
        {"allowedHosts", &allowedHosts},
        {"openBrowserAtStart", &openBrowserAtStart},
    };

    std::vector<const void*> reached;
    for (size_t index = 0; index < kSettingEntryCount; ++index) {
        const auto& entry = kSettingEntries[index];
        INFO("entry: ", index);

        CHECK((entry.text == nullptr) != (entry.toggle == nullptr));
        CHECK((entry.kind == ControlKind::toggle) == (entry.toggle != nullptr));

        if (entry.text != nullptr)
            reached.push_back(&(form.*entry.text));
        if (entry.toggle != nullptr)
            reached.push_back(&(form.*entry.toggle));
    }

    for (const auto& [name, address] : members) {
        INFO("member: ", std::string(name));
        CHECK(std::count(reached.begin(), reached.end(), address) == 1);
    }

    CHECK(reached.size() == members.size());
}

namespace {

struct ShownSetting {
    PageId page;
    const char* group;
    ControlKind kind;
    std::string SettingsForm::* text;
    bool SettingsForm::* toggle;
    const char* label;
    const char* hint;
};

std::string captionOf(int group) {
    if (group == kNoGroup)
        return "(no group)";

    REQUIRE(group >= 0);
    REQUIRE(static_cast<size_t>(group) < std::size(kSettingGroups));
    return kSettingGroups[group].caption;
}

PageId pageOfGroup(int group, PageId otherwise) {
    return group == kNoGroup ? otherwise : kSettingGroups[group].page;
}

}  // namespace

TEST_CASE("the declaration words each setting, top to bottom") {
    const std::vector<ShownSetting> expected{
        {PageId::jean, "Networking", ControlKind::number, &SettingsForm::port, nullptr,
         "Port:", ""},
        {PageId::jean, "Networking", ControlKind::text, &SettingsForm::bindAddress, nullptr,
         "Address:", "0.0.0.0 is every local interface. 127.0.0.1 is this machine only."},
        {PageId::jean, "(no group)", ControlKind::lines, &SettingsForm::allowedOrigins, nullptr,
         "Allowed origins", "One per line. An empty list reflects no origin."},
        {PageId::jean, "Startup", ControlKind::toggle, nullptr, &SettingsForm::openBrowserAtStart,
         "Open Jean in the default browser when foobar2000 starts", ""},
        {PageId::permissions, "Permissions", ControlKind::toggle, nullptr,
         &SettingsForm::controlPlayback, "Allow Jean to control playback", ""},
        {PageId::permissions, "Permissions", ControlKind::toggle, nullptr,
         &SettingsForm::writePlaylists, "Allow Jean to change playlists", ""},
        {PageId::permissions, "Permissions", ControlKind::toggle, nullptr,
         &SettingsForm::changeOutput, "Allow Jean to change the output device", ""},
        {PageId::permissions, "Permissions", ControlKind::toggle, nullptr,
         &SettingsForm::streamingEnabled, "Allow Jean to stream audio", ""},
        {PageId::permissions, "(no group)", ControlKind::lines, &SettingsForm::allowedFields,
         nullptr, "Fields this may write",
         "One per line. Nothing outside this list is ever written."},
        {PageId::permissions, "(no group)", ControlKind::number, &SettingsForm::maxAutoPlaylists,
         nullptr, "Autoplaylist limit:", ""},
        {PageId::permissions, "(no group)", ControlKind::lines, &SettingsForm::allowedHosts,
         nullptr, "Allowed hosts",
         "One per line. *.lan, *.local, *.home.arpa, an IP address, localhost and a name with no "
         "dot are always admitted."},
    };

    REQUIRE(kSettingEntryCount == expected.size());

    for (size_t index = 0; index < expected.size(); ++index) {
        const auto& entry = kSettingEntries[index];
        const auto& row = expected[index];
        INFO("entry: ", index, ", labelled ", std::string(row.label));

        CHECK(entry.page == row.page);
        CHECK(captionOf(entry.group) == row.group);
        CHECK(pageOfGroup(entry.group, entry.page) == entry.page);
        CHECK(entry.kind == row.kind);
        CHECK(entry.text == row.text);
        CHECK(entry.toggle == row.toggle);
        CHECK(std::string(entry.label) == row.label);
        CHECK(std::string(entry.hint) == row.hint);
    }
}

TEST_CASE(
    "the pages are named Jean and Permissions, their groups Networking, Startup and Permissions, "
    "and their buttons Apply and Reset") {
    std::vector<std::pair<PageId, std::string>> pages;
    for (const auto& page : kPageNames)
        pages.emplace_back(page.page, page.name);

    std::vector<std::pair<PageId, std::string>> groups;
    for (const auto& group : kSettingGroups)
        groups.emplace_back(group.page, group.caption);

    CHECK(pages == std::vector<std::pair<PageId, std::string>>{
                       {PageId::jean, "Jean"}, {PageId::permissions, "Permissions"}});
    CHECK(std::string(pageName(PageId::jean)) == "Jean");
    CHECK(std::string(pageName(PageId::permissions)) == "Permissions");
    CHECK(groups ==
          std::vector<std::pair<PageId, std::string>>{{PageId::jean, "Networking"},
                                                      {PageId::jean, "Startup"},
                                                      {PageId::permissions, "Permissions"}});
    CHECK(std::string(kApplyLabel) == "Apply");
    CHECK(std::string(kResetLabel) == "Reset");
}

namespace {

struct ConfigFile {
    Settings onDisk;
    std::vector<Settings> writes;
    std::optional<std::string> saveThrows;

    std::function<Settings()> load() {
        return [this] { return onDisk; };
    }

    std::function<void(const Settings&)> save() {
        return [this](const Settings& settings) {
            if (saveThrows)
                throw std::runtime_error(*saveThrows);
            writes.push_back(settings);
            onDisk = settings;
        };
    }
};

std::function<bool(const Settings&)> runningOnPort(int port) {
    return [port](const Settings& saved) { return saved.port != port; };
}

Settings savedByHand() {
    Settings settings;
    settings.port = 9001;
    settings.allowedHosts = {"music.example"};
    settings.controlPlayback = false;
    return settings;
}

const char kSavedLine[] = "[info] configuration saved from the preferences page";

const char kSavedNeedingRestartLine[] =
    "[info] configuration saved from the preferences page; a restart is needed for some changes "
    "to take effect";

}  // namespace

TEST_CASE(
    "a page opens showing what is saved, and a form differs from it only where a control "
    "does") {
    ConfigFile config;
    config.onDisk = savedByHand();
    const SettingsEditor editor(config.load(), config.save(), runningOnPort(9001));

    CHECK(editor.shown() == toForm(savedByHand()));
    CHECK(editor.saved() == savedByHand());
    CHECK_FALSE(editor.differs(toForm(savedByHand())));

    auto ticked = toForm(savedByHand());
    ticked.controlPlayback = true;
    CHECK(editor.differs(ticked));

    auto typed = toForm(savedByHand());
    typed.allowedHosts = "jukebox.example";
    CHECK(editor.differs(typed));

    CHECK(config.writes.empty());
}

// A key with no control on either page, edited in config.json while the page was open, would be
// put back to what the page first read if Apply carried that copy through readForm.
TEST_CASE(
    "apply reads what is saved again first, so a key edited by hand since the page opened "
    "survives") {
    ConfigFile config;
    config.onDisk = savedByHand();
    SettingsEditor editor(config.load(), config.save(), runningOnPort(9001));

    config.onDisk.opusBitrate = 64000;
    config.onDisk.maxConcurrentStreams = 2;

    auto onScreen = editor.shown();
    onScreen.allowedHosts = "jukebox.example";

    const auto outcome = editor.apply(PageId::permissions, onScreen);

    REQUIRE(outcome.ok());
    REQUIRE(config.writes.size() == 1);
    CHECK(config.writes[0].opusBitrate == 64000);
    CHECK(config.writes[0].maxConcurrentStreams == 2);
    CHECK(config.writes[0].allowedHosts == std::vector<std::string>{"jukebox.example"});
}

// Each page builds its form from what it read when it opened. A key the other page shows, edited
// in config.json since, would be put back by this page's Apply if the whole form were taken.
TEST_CASE(
    "apply takes only the applying page's controls, so a key the other page shows, edited by "
    "hand since the page opened, survives") {
    ConfigFile config;
    config.onDisk = savedByHand();
    SettingsEditor editor(config.load(), config.save(), runningOnPort(9001));

    SUBCASE("the Jean page keeps a switch and a list edited by hand") {
        config.onDisk.controlPlayback = true;
        config.onDisk.allowedHosts = {"jukebox.example"};

        auto onScreen = editor.shown();
        onScreen.bindAddress = "127.0.0.1";
        onScreen.writePlaylists = false;

        REQUIRE(editor.apply(PageId::jean, onScreen).ok());
        REQUIRE(config.writes.size() == 1);
        CHECK(config.writes[0].bindAddress == "127.0.0.1");
        CHECK(config.writes[0].controlPlayback);
        CHECK(config.writes[0].allowedHosts == std::vector<std::string>{"jukebox.example"});
        CHECK(config.writes[0].writePlaylists);
    }

    SUBCASE("the Permissions page keeps a port and an address edited by hand") {
        config.onDisk.port = 9002;
        config.onDisk.bindAddress = "127.0.0.1";

        auto onScreen = editor.shown();
        onScreen.allowedHosts = "jukebox.example";
        onScreen.openBrowserAtStart = true;

        REQUIRE(editor.apply(PageId::permissions, onScreen).ok());
        REQUIRE(config.writes.size() == 1);
        CHECK(config.writes[0].allowedHosts == std::vector<std::string>{"jukebox.example"});
        CHECK(config.writes[0].port == 9002);
        CHECK(config.writes[0].bindAddress == "127.0.0.1");
        CHECK_FALSE(config.writes[0].openBrowserAtStart);
    }
}

TEST_CASE("a refused form saves nothing and answers readForm's sentence") {
    clearLog();
    ConfigFile config;
    config.onDisk = savedByHand();
    SettingsEditor editor(config.load(), config.save(), runningOnPort(9001));

    auto onScreen = editor.shown();
    onScreen.port = "0";

    const auto outcome = editor.apply(PageId::jean, onScreen);

    CHECK_FALSE(outcome.ok());
    CHECK(outcome.refusal == readForm(onScreen, savedByHand()).error);
    CHECK_FALSE(outcome.refusal.empty());
    CHECK(outcome.saveFailure.empty());
    CHECK(config.writes.empty());
    CHECK(editor.saved() == savedByHand());
    CHECK_FALSE(logged("configuration saved"));
}

TEST_CASE(
    "a save that throws answers what it threw, logs it as an error and leaves what is saved "
    "as it was") {
    clearLog();
    ConfigFile config;
    config.onDisk = savedByHand();
    config.saveThrows = "the disk is full";
    SettingsEditor editor(config.load(), config.save(), runningOnPort(9001));

    auto onScreen = editor.shown();
    onScreen.allowedHosts = "jukebox.example";

    const auto outcome = editor.apply(PageId::permissions, onScreen);

    CHECK_FALSE(outcome.ok());
    CHECK(outcome.refusal.empty());
    CHECK(outcome.saveFailure == "the disk is full");
    CHECK(editor.saved() == savedByHand());
    CHECK(editor.shown() == toForm(savedByHand()));
    CHECK(editor.differs(onScreen));
    CHECK(loggedLines() ==
          std::vector<std::string>{"[error] could not save the configuration: the disk is full"});
}

TEST_CASE(
    "a save that throws with no reason is still not ok, still answers a failure to show, and "
    "what is saved is as it was") {
    ConfigFile config;
    config.onDisk = savedByHand();
    config.saveThrows = "";
    SettingsEditor editor(config.load(), config.save(), runningOnPort(9001));

    auto onScreen = editor.shown();
    onScreen.allowedHosts = "jukebox.example";

    const auto outcome = editor.apply(PageId::permissions, onScreen);

    CHECK_FALSE(outcome.ok());
    CHECK_FALSE(outcome.saveFailure.empty());
    CHECK(config.writes.empty());
    CHECK(editor.saved() == savedByHand());
    CHECK(editor.shown() == toForm(savedByHand()));
}

// The form as saved is what the page shows after Apply, so a padded number or a blank line in a
// list comes back the way readForm settled it.
TEST_CASE("an accepted form is saved once and answers the form as saved, with the log line") {
    clearLog();
    ConfigFile config;
    config.onDisk = savedByHand();
    SettingsEditor editor(config.load(), config.save(), runningOnPort(9001));

    auto onScreen = editor.shown();
    onScreen.maxAutoPlaylists = " 7 ";
    onScreen.allowedHosts = "jukebox.example\r\n\r\nmusic.example\n";
    onScreen.controlPlayback = true;

    const auto outcome = editor.apply(PageId::permissions, onScreen);

    REQUIRE(outcome.ok());
    REQUIRE(config.writes.size() == 1);
    CHECK(config.writes[0] == readForm(onScreen, savedByHand()).settings);
    CHECK(outcome.form.maxAutoPlaylists == "7");
    CHECK(outcome.form.allowedHosts == "jukebox.example\r\nmusic.example");
    CHECK(outcome.form.controlPlayback);
    CHECK(outcome.form == toForm(config.writes[0]));
    CHECK_FALSE(outcome.restartNeeded);
    CHECK(editor.saved() == config.writes[0]);
    CHECK(editor.shown() == outcome.form);
    CHECK_FALSE(editor.differs(outcome.form));
    CHECK(loggedLines() == std::vector<std::string>{kSavedLine});
}

TEST_CASE("an accepted form needing a restart says so in the outcome and in the log line") {
    clearLog();
    ConfigFile config;
    config.onDisk = savedByHand();
    SettingsEditor editor(config.load(), config.save(), runningOnPort(9001));

    auto onScreen = editor.shown();
    onScreen.port = "9002";

    const auto outcome = editor.apply(PageId::jean, onScreen);

    REQUIRE(outcome.ok());
    CHECK(outcome.restartNeeded);
    CHECK(outcome.form.port == "9002");
    CHECK(loggedLines() == std::vector<std::string>{kSavedNeedingRestartLine});
}

TEST_CASE("reset answers the defaults and saves nothing") {
    clearLog();
    ConfigFile config;
    config.onDisk = savedByHand();
    const SettingsEditor editor(config.load(), config.save(), runningOnPort(9001));

    const auto reset = editor.reset();

    CHECK(reset == defaultForm());
    CHECK(editor.differs(reset));
    CHECK(config.writes.empty());
    CHECK(editor.saved() == savedByHand());
    CHECK(editor.shown() == toForm(savedByHand()));
    CHECK(loggedLines().empty());
}

namespace {

const char kConfigShown[] = "/profile/foo_jean/config.json";

ListenerStatus listening() {
    ListenerStatus status;
    status.listening = true;
    return status;
}

ListenerStatus failedToBind() {
    ListenerStatus status;
    status.error = "port 8881 is already in use by another program";
    status.portInUse = true;
    return status;
}

ListenerStatus beside(const std::vector<std::string>& heldAddresses) {
    auto status = listening();
    status.portIsShared = true;
    status.heldAddresses = heldAddresses;
    return status;
}

}  // namespace

TEST_CASE("the note says where config.json is saved, whether or not the listener has started") {
    for (const auto& status : {listening(), ListenerStatus()}) {
        INFO("listening: ", status.listening);
        CHECK(pageNote(status, 8881, kConfigShown, false) ==
              "Saved to /profile/foo_jean/config.json.");
    }
}

TEST_CASE("the note adds that a restart is needed where one is") {
    CHECK(pageNote(listening(), 8881, kConfigShown, true) ==
          "Saved to /profile/foo_jean/config.json. A restart is needed for some changes to take "
          "effect.");
}

TEST_CASE("a failed bind's error takes the place of the saved line and the restart sentence") {
    CHECK(pageNote(failedToBind(), 8881, kConfigShown, true) == failedToBind().error);
}

TEST_CASE(
    "a held address's sentence, at the port given, takes the place of the saved line and the "
    "restart sentence") {
    const std::vector<std::string> held{"127.0.0.1"};

    const auto note = pageNote(beside(held), 9001, kConfigShown, true);

    CHECK(note == heldAddressError(held, 9001));
}

namespace {

const char kTemplatePath[] = "plugins/fb2k/src/fb2k/preferences.rc";
const char kResourceHeaderPath[] = "plugins/fb2k/src/fb2k/resource.h";

// rc.exe escapes a quote inside a string by doubling it.
std::vector<std::string> linesWithoutComments(const std::string& relativePath) {
    std::ifstream file(repositoryRoot() + relativePath, std::ios::binary);
    REQUIRE_MESSAGE(file.is_open(), "cannot read ", relativePath);
    std::string text{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
    text.erase(std::remove(text.begin(), text.end(), '\r'), text.end());

    enum class In { code, string, lineComment, blockComment };
    In in = In::code;
    std::string kept;
    for (size_t at = 0; at < text.size(); ++at) {
        const char c = text[at];
        const char next = at + 1 < text.size() ? text[at + 1] : '\0';

        if (c == '\n') {
            kept += c;
            if (in != In::blockComment)
                in = In::code;
        } else if (in == In::lineComment) {
        } else if (in == In::blockComment) {
            if (c == '*' && next == '/') {
                in = In::code;
                ++at;
            }
        } else if (in == In::string) {
            kept += c;
            if (c == '"' && next == '"') {
                kept += next;
                ++at;
            } else if (c == '"') {
                in = In::code;
            }
        } else if (c == '/' && (next == '/' || next == '*')) {
            in = next == '/' ? In::lineComment : In::blockComment;
            ++at;
        } else {
            kept += c;
            if (c == '"')
                in = In::string;
        }
    }

    std::vector<std::string> lines;
    std::istringstream stream(kept);
    for (std::string line; std::getline(stream, line);)
        lines.push_back(line);
    return lines;
}

std::string trimmedOf(const std::string& text) {
    const auto first = text.find_first_not_of(" \t");
    if (first == std::string::npos)
        return {};
    return text.substr(first, text.find_last_not_of(" \t") - first + 1);
}

bool startsAnIdentifier(char c) {
    return std::isalpha(static_cast<unsigned char>(c)) != 0 || c == '_';
}

bool insideAnIdentifier(char c) {
    return startsAnIdentifier(c) || std::isdigit(static_cast<unsigned char>(c)) != 0;
}

std::vector<std::string> argumentsOf(const std::string& text) {
    std::vector<std::string> arguments(1);
    bool inString = false;
    for (const char c : text) {
        if (c == '"')
            inString = !inString;
        if (c == ',' && !inString)
            arguments.emplace_back();
        else
            arguments.back() += c;
    }
    std::transform(arguments.begin(), arguments.end(), arguments.begin(), trimmedOf);
    return arguments;
}

struct TemplateStatement {
    int line;
    bool insideDialog;
    std::string keyword;
    std::vector<std::string> arguments;
};

std::vector<TemplateStatement> templateStatements(const std::vector<std::string>& lines) {
    std::vector<TemplateStatement> statements;
    std::string pending;
    int pendingLine = 0;
    int depth = 0;

    const auto finish = [&] {
        if (pending.empty())
            return;
        const auto keywordEnd =
            std::find_if_not(pending.begin(), pending.end(), insideAnIdentifier);
        TemplateStatement statement{pendingLine, depth > 0,
                                    std::string(pending.begin(), keywordEnd),
                                    argumentsOf(std::string(keywordEnd, pending.end()))};
        statements.push_back(std::move(statement));
        pending.clear();
    };

    for (size_t index = 0; index < lines.size(); ++index) {
        const auto line = trimmedOf(lines[index]);
        if (line.empty() || line[0] == '#')
            continue;

        const bool continues =
            !pending.empty() &&
            (pending.back() == ',' || pending.back() == '|' || !startsAnIdentifier(line[0]));
        if (continues) {
            pending += " " + line;
            continue;
        }

        finish();
        if (line == "BEGIN" || line == "{") {
            ++depth;
        } else if (line == "END" || line == "}") {
            --depth;
        } else {
            pending = line;
            pendingLine = static_cast<int>(index) + 1;
        }
    }
    finish();
    return statements;
}

// Inside a dialog, every control statement but these four takes its text as the first argument;
// CONTROL's window class comes later. Above it, CAPTION is the dialog's title.
std::optional<std::string> captionOf(const TemplateStatement& statement) {
    static const std::vector<std::string> textless{"EDITTEXT", "COMBOBOX", "LISTBOX", "SCROLLBAR"};

    const auto& first = statement.arguments.front();
    const bool takesText = statement.insideDialog ? std::find(textless.begin(), textless.end(),
                                                              statement.keyword) == textless.end()
                                                  : statement.keyword == "CAPTION";
    if (!takesText || first.empty() || first.front() != '"')
        return std::nullopt;
    return first;
}

bool usesIdentifier(const std::vector<std::string>& lines, const std::string& name) {
    return std::any_of(lines.begin(), lines.end(), [&name](const std::string& line) {
        for (auto at = line.find(name); at != std::string::npos; at = line.find(name, at + 1)) {
            const auto end = at + name.size();
            const bool wholeWord = (at == 0 || !insideAnIdentifier(line[at - 1])) &&
                                   (end == line.size() || !insideAnIdentifier(line[end]));
            if (wholeWord)
                return true;
        }
        return false;
    });
}

std::vector<std::string> controlIdsDefined(const std::vector<std::string>& lines) {
    std::vector<std::string> ids;
    for (const auto& line : lines) {
        std::istringstream words(line);
        std::string directive;
        std::string name;
        words >> directive >> name;
        if (directive == "#define" && (name.rfind("IDC_", 0) == 0 || name.rfind("IDD_", 0) == 0))
            ids.push_back(name);
    }
    return ids;
}

}  // namespace

// The Windows page writes every label, hint, caption and page name from the declaration when it
// opens, so a word left in the template is a second copy that drifts from the Mac page's.
TEST_CASE("the Windows page's template holds positions and no wording") {
    const auto statements = templateStatements(linesWithoutComments(kTemplatePath));

    const auto controls = std::count_if(statements.begin(), statements.end(),
                                        [](const TemplateStatement& s) { return s.insideDialog; });
    REQUIRE(controls > 0);

    for (const auto& statement : statements) {
        const auto caption = captionOf(statement);
        if (caption && *caption != "\"\"")
            FAIL_CHECK("preferences.rc:" << statement.line << " " << statement.keyword << " "
                                         << *caption);
    }
}

// After the captions leave the template, an id the page no longer draws would otherwise stay
// defined, and nothing would say so.
TEST_CASE("every control id resource.h defines is used by the Windows page's template") {
    const auto ids = controlIdsDefined(linesWithoutComments(kResourceHeaderPath));
    const auto templateLines = linesWithoutComments(kTemplatePath);
    REQUIRE_FALSE(ids.empty());

    for (const auto& id : ids) {
        INFO("resource.h defines ", id);
        CHECK(usesIdentifier(templateLines, id));
    }
}
