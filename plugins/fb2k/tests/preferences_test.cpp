// settings_test.cpp asserts that a bad config.json never stops the player. This asserts the
// other direction: a bad dialog never becomes a config.json.

#include "third_party/doctest.h"

#include "core/preferences.h"

#include <algorithm>
#include <cctype>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

using namespace jean;

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
