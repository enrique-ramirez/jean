// settings_test.cpp asserts that a bad config.json never stops the player. This asserts the
// other direction: a bad dialog never becomes a config.json.

#include "third_party/doctest.h"

#include "core/preferences.h"

#include <vector>

using namespace jean;

namespace {

SettingsForm goodForm() {
    SettingsForm form;
    form.port = "8881";
    form.bindAddress = "0.0.0.0";
    form.authToken = std::string(64, 'a');
    form.allowedOrigins = "";
    form.allowedFields = "rating";
    return form;
}

}  // namespace

TEST_CASE("the form shows what the settings say") {
    Settings settings;
    settings.port = 9001;
    settings.bindAddress = "127.0.0.1";
    settings.authToken = std::string(64, 'b');
    settings.allowedOrigins = {"https://jean.example", "http://127.0.0.1:8880"};
    settings.allowedFields = {"rating", "comment"};

    const auto form = toForm(settings);

    CHECK(form.port == "9001");
    CHECK(form.bindAddress == "127.0.0.1");
    CHECK(form.authToken == std::string(64, 'b'));
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
    original.authToken = std::string(64, 'c');
    original.allowedOrigins = {"https://jean.example"};
    original.allowedFields = {"rating", "comment"};

    const auto reading = readForm(toForm(original), Settings());

    REQUIRE(reading.ok());
    CHECK(reading.settings == original);
}

TEST_CASE("the defaults survive a round trip through the form") {
    Settings defaults;
    defaults.authToken = std::string(64, 'a');  // the one default there cannot be

    const auto reading = readForm(toForm(defaults), Settings());

    REQUIRE(reading.ok());
    CHECK(reading.settings == defaults);
}

TEST_CASE("the bare defaults are not a configuration that can be applied") {
    CHECK_FALSE(readForm(toForm(Settings()), Settings()).ok());
}

TEST_CASE("resetting keeps the token, because there is no default one") {
    const auto token = std::string(64, 'd');
    const auto form = defaultForm(token);

    CHECK(form.authToken == token);
    CHECK(form.port == std::to_string(Settings().port));
    CHECK(form.bindAddress == Settings().bindAddress);
    CHECK(form.allowedFields == "rating");

    const auto reading = readForm(form, Settings());
    REQUIRE(reading.ok());
    CHECK(reading.settings.authToken == token);
}

TEST_CASE("surrounding whitespace is a typing accident rather than a value") {
    auto form = goodForm();
    form.port = "  8881 ";
    form.bindAddress = "\t127.0.0.1  ";
    form.authToken = " " + std::string(64, 'a') + "\r\n";

    const auto reading = readForm(form, Settings());

    REQUIRE(reading.ok());
    CHECK(reading.settings.port == 8881);
    CHECK(reading.settings.bindAddress == "127.0.0.1");
    CHECK(reading.settings.authToken == std::string(64, 'a'));
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

// parseSettings tolerates a bad token so that a headless start survives one; the page does
// not, because somebody is standing in front of it.
TEST_CASE("a token that would not serve is refused before it is saved") {
    for (const auto* typed : {"", "hunter2", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}) {
        auto form = goodForm();
        form.authToken = typed;

        const auto reading = readForm(form, Settings());

        CHECK_FALSE(reading.ok());
        CHECK(reading.error.find("token") != std::string::npos);
    }
}

TEST_CASE("a token of exactly the minimum length is accepted") {
    auto form = goodForm();
    form.authToken = std::string(kMinTokenLength, 'a');

    CHECK(readForm(form, Settings()).ok());
}

// The token travels in an HTTP header, where a space cannot be told apart from the scheme.
TEST_CASE("a token carrying whitespace or control characters is refused") {
    const auto half = std::string(32, 'a');

    for (const auto* between : {" ", "\t", "\x01", "\x7f"}) {
        auto form = goodForm();
        form.authToken = half;
        form.authToken.append(between).append(half);

        const auto reading = readForm(form, Settings());

        CHECK_FALSE(reading.ok());
        CHECK(reading.error.find("token") != std::string::npos);
    }
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
            s.authToken = std::string(64, 'a');
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
            f.authToken = std::string(64, 'z');
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
    };

    CHECK(goodForm() == goodForm());

    for (const auto& altered : oneControlChanged)
        CHECK(altered() != goodForm());
}

// The page has five controls and Settings has more fields than that.
TEST_CASE("a setting the page has no control for survives being applied") {
    Settings saved;
    saved.authToken = std::string(64, 'a');
    saved.maxAutoPlaylists = 7;

    auto form = toForm(saved);
    form.port = "9001";

    const auto reading = readForm(form, saved);

    REQUIRE(reading.ok());
    CHECK(reading.settings.port == 9001);
    CHECK(reading.settings.maxAutoPlaylists == 7);
}

// Both arguments can supply this key, and only one of them is the person at the dialog.
TEST_CASE("the checkbox decides whether playlists are writable, rather than what was saved") {
    for (const bool writable : {true, false}) {
        Settings shown;
        shown.authToken = std::string(64, 'a');
        shown.writePlaylists = writable;

        Settings saved = shown;
        saved.writePlaylists = !writable;

        const auto reading = readForm(toForm(shown), saved);

        REQUIRE(reading.ok());
        CHECK(reading.settings.writePlaylists == writable);
    }
}

TEST_CASE("a ticked checkbox and an unticked one are not the same form") {
    Settings writable;
    Settings readOnly = writable;
    readOnly.writePlaylists = false;

    CHECK(toForm(writable) != toForm(readOnly));
}

TEST_CASE("resetting permits playlist writes, because that is what an untouched setting means") {
    Settings readOnly;
    readOnly.writePlaylists = false;

    const auto reading = readForm(defaultForm(std::string(64, 'a')), readOnly);

    REQUIRE(reading.ok());
    CHECK(reading.settings.writePlaylists);
}

// core/preferences.h requires `unshown` rather than defaulting it because forgetting a key
// silently resets one somebody set by hand. This is that promise, over every such key.
TEST_CASE("every setting the page has no control for survives being applied") {
    Settings saved;
    saved.authToken = std::string(64, 'a');
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
