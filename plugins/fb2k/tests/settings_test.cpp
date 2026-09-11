// config.json is edited by hand on a machine with nobody at the keyboard. One bad line must
// never stop the player coming up, and must always name itself. Both halves are asserted here.

#include "third_party/doctest.h"

#include "core/settings.h"

#include <string>
#include "support/log_capture.h"

using namespace jean;
using namespace jean::testing;

namespace {

Settings parseFresh(const std::string& text) {
    clearLog();
    return parseSettings(text);
}

}  // namespace

TEST_CASE("an empty object leaves every default in place") {
    const auto settings = parseFresh("{}");
    const Settings defaults;

    CHECK(settings.port == defaults.port);
    CHECK(settings.bindAddress == defaults.bindAddress);
    CHECK(settings.allowedFields == defaults.allowedFields);
    CHECK(settings.authToken.empty());
}

TEST_CASE("the defaults are reachable, and closed where it counts") {
    const Settings defaults;

    CHECK(defaults.bindAddress == "0.0.0.0");
    CHECK(defaults.authToken.empty());
    CHECK(defaults.allowedFields == std::vector<std::string>{"rating"});
}

TEST_CASE("a well-formed file is read as written") {
    const auto settings = parseFresh(R"({
        "port": 9000,
        "bindAddress": "0.0.0.0",
        "authToken": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "allowedOrigins": ["https://jean.example"],
        "allowedFields": ["rating", "comment"]
    })");

    CHECK(settings.port == 9000);
    CHECK(settings.bindAddress == "0.0.0.0");
    CHECK(settings.allowedOrigins == std::vector<std::string>{"https://jean.example"});
    CHECK(settings.allowedFields == std::vector<std::string>{"rating", "comment"});
}

TEST_CASE("a settings round trip through the file format is lossless") {
    Settings original;
    original.port = 9001;
    original.bindAddress = "192.168.1.10";
    original.authToken = std::string(64, 'a');
    original.allowedOrigins = {"https://jean.example"};
    original.allowedFields = {"rating", "comment"};

    const auto restored = parseFresh(serialiseSettings(original));

    CHECK(restored.port == original.port);
    CHECK(restored.bindAddress == original.bindAddress);
    CHECK(restored.authToken == original.authToken);
    CHECK(restored.allowedOrigins == original.allowedOrigins);
    CHECK(restored.allowedFields == original.allowedFields);
}

TEST_CASE("a file that is not JSON at all still starts the player, serving nothing") {
    const auto settings = parseFresh("this is not json {{{");

    CHECK(settings.authToken.empty());
    CHECK(settings.port == Settings().port);
    CHECK(logged("could not parse"));
}

TEST_CASE("a JSON array where an object belongs is refused rather than misread") {
    const auto settings = parseFresh(R"(["port", 9000])");

    CHECK(settings.authToken.empty());
    CHECK(logged("expected a JSON object"));
}

TEST_CASE("a key of the wrong type keeps its default, names itself, and spoils no other key") {
    const auto settings = parseFresh(R"({"port": "eight thousand", "bindAddress": "0.0.0.0"})");

    CHECK(settings.port == Settings().port);
    CHECK(logged("'port'"));
    CHECK(settings.bindAddress == "0.0.0.0");
}

TEST_CASE("a port outside the legal range falls back and says so") {
    for (const auto* text : {R"({"port": 0})", R"({"port": -1})", R"({"port": 70000})"}) {
        const auto settings = parseFresh(text);

        CHECK(settings.port == Settings().port);
        CHECK(logged("out of range"));
    }
}

TEST_CASE("an empty bindAddress takes the default and reports itself") {
    const auto settings = parseFresh(R"({"bindAddress": ""})");

    CHECK(settings.bindAddress == Settings().bindAddress);
    CHECK(logged("'bindAddress'"));
}

TEST_CASE("a token too short to be worth anything is refused outright") {
    const auto settings = parseFresh(R"({"authToken": "hunter2"})");

    CHECK(settings.authToken.empty());
    CHECK(logged("'authToken'"));
}

// The log is echoed to the foobar2000 console, which is what people paste into bug reports.
TEST_CASE("a rejected token is never echoed into the log") {
    parseFresh(R"({"authToken": "hunter2"})");
    CHECK_FALSE(logged("hunter2"));

    parseFresh(R"({"authToken": ")" + std::string(64, 'a') + R"("})");
    CHECK_FALSE(logged(std::string(64, 'a')));
}

TEST_CASE("a token of legal length is kept") {
    const auto token = std::string(kMinTokenLength, 'a');
    const auto settings = parseFresh(R"({"authToken": ")" + token + R"("})");

    CHECK(settings.authToken == token);
}

TEST_CASE("a misspelled key is reported, because otherwise it is invisible") {
    const auto settings = parseFresh(R"({"bindaddress": "127.0.0.1"})");

    CHECK(settings.bindAddress == Settings().bindAddress);
    CHECK(logged("'bindaddress' is not a setting"));
}

// serialiseSettings writes every key, so a setting added later that the parser forgets to read
// fails here without this test needing to be touched.
TEST_CASE("no key we write is a key we then call unknown") {
    parseFresh(serialiseSettings(Settings()));

    CHECK_FALSE(logged("is not a setting"));
    CHECK_FALSE(logged("ignoring"));
}

TEST_CASE("a list with a bad entry keeps the good ones") {
    const auto settings = parseFresh(R"({"allowedFields": ["rating", 42, "", "comment"]})");

    CHECK(settings.allowedFields == std::vector<std::string>{"rating", "comment"});
    CHECK(logged("'allowedFields'"));
}

TEST_CASE("a list that is not a list keeps the default") {
    const auto settings = parseFresh(R"({"allowedFields": "rating"})");

    CHECK(settings.allowedFields == Settings().allowedFields);
    CHECK(logged("expected an array"));
}

TEST_CASE("an explicitly empty allowlist is honoured rather than read as an absent key") {
    const auto settings = parseFresh(R"({"allowedFields": []})");

    CHECK(settings.allowedFields.empty());
}

TEST_CASE("the two encoders carry their own bitrate") {
    const auto settings = parseFresh(R"({"opusBitrate": 320000, "aacBitrate": 96000})");

    CHECK(settings.opusBitrate == 320000);
    CHECK(settings.aacBitrate == 96000);
}

TEST_CASE("an Opus bitrate outside what libopus takes falls back and says so") {
    for (const auto* text : {R"({"opusBitrate": 16000})", R"({"opusBitrate": 600000})"}) {
        const auto settings = parseFresh(text);

        CHECK(settings.opusBitrate == Settings().opusBitrate);
        CHECK(logged("'opusBitrate'"));
    }
}

// A ticket that expires the instant it is minted is a 401 for every listener with nothing in
// the log to explain it, which is the failure a bound here exists to prevent.
TEST_CASE("a ticket lifetime outside its bounds falls back rather than expiring on arrival") {
    for (const auto* text :
         {R"({"streamTicketTtlSeconds": 0})", R"({"streamTicketTtlSeconds": -1})",
          R"({"streamTicketTtlSeconds": 86400})"}) {
        const auto settings = parseFresh(text);

        CHECK(settings.streamTicketTtlSeconds == Settings().streamTicketTtlSeconds);
        CHECK(logged("'streamTicketTtlSeconds'"));
    }

    // Zero is not how streaming is turned off, and both ends of the range are usable.
    CHECK(parseFresh(R"({"streamTicketTtlSeconds": 10})").streamTicketTtlSeconds == 10);
    CHECK(parseFresh(R"({"streamTicketTtlSeconds": 3600})").streamTicketTtlSeconds == 3600);
}

TEST_CASE("a negative stream cap falls back and says so") {
    const auto settings = parseFresh(R"({"maxConcurrentStreams": -1})");

    CHECK(settings.maxConcurrentStreams == Settings().maxConcurrentStreams);
    CHECK(logged("'maxConcurrentStreams'"));

    // Zero is kept, because it is how an install that has the encoder built in turns
    // listening off: the route answers 503 and says the cap is what refused it.
    CHECK(parseFresh(R"({"maxConcurrentStreams": 0})").maxConcurrentStreams == 0);
}

TEST_CASE("a boolean written as text keeps its default and names itself") {
    const auto settings = parseFresh(R"({"streamingEnabled": "false", "muteWhileStreaming": 0})");

    CHECK(settings.streamingEnabled == Settings().streamingEnabled);
    CHECK(settings.muteWhileStreaming == Settings().muteWhileStreaming);
    CHECK(logged("'streamingEnabled'"));
    CHECK(logged("'muteWhileStreaming'"));

    CHECK_FALSE(parseFresh(R"({"streamingEnabled": false})").streamingEnabled);
    CHECK_FALSE(parseFresh(R"({"muteWhileStreaming": false})").muteWhileStreaming);
}

// Windows' AAC encoder refuses every value but four, and a refusal costs the ADTS format
// altogether -- which is the only one Safari can play. A plausible number between two legal
// ones is the case that matters: bounds checking would wave it through.
TEST_CASE("an AAC bitrate the encoder would refuse never reaches it") {
    for (const auto* text :
         {R"({"aacBitrate": 256000})", R"({"aacBitrate": 144000})", R"({"aacBitrate": 320000})"}) {
        const auto settings = parseFresh(text);

        CHECK(settings.aacBitrate == Settings().aacBitrate);
        CHECK(logged("'aacBitrate'"));
    }
}

TEST_CASE("every bitrate the AAC encoder documents is accepted") {
    for (const int rate : kAacBitrates) {
        const auto settings = parseFresh(R"({"aacBitrate": )" + std::to_string(rate) + "}");

        CHECK(settings.aacBitrate == rate);
    }
}

TEST_CASE("the autoplaylist cap is read, and a negative one is not") {
    CHECK(parseFresh(R"({"maxAutoPlaylists": 12})").maxAutoPlaylists == 12);

    // Zero turns creation off, the way an empty allowlist turns writes off.
    CHECK(parseFresh(R"({"maxAutoPlaylists": 0})").maxAutoPlaylists == 0);

    const auto negative = parseFresh(R"({"maxAutoPlaylists": -1})");
    CHECK(negative.maxAutoPlaylists == Settings().maxAutoPlaylists);
    CHECK(logged("'maxAutoPlaylists'"));
}

TEST_CASE("an absent writePlaylists permits playlist writes, and an explicit false refuses them") {
    CHECK(Settings().writePlaylists);
    CHECK(parseFresh("{}").writePlaylists);
    CHECK(parseFresh(R"({"writePlaylists": true})").writePlaylists);

    CHECK_FALSE(parseFresh(R"({"writePlaylists": false})").writePlaylists);
}

TEST_CASE("a malformed writePlaylists keeps writes permitted and names itself") {
    for (const auto* text : {R"({"writePlaylists": "false"})", R"({"writePlaylists": 0})",
                             R"({"writePlaylists": null})"}) {
        const auto settings = parseFresh(text);

        CHECK(settings.writePlaylists);
        CHECK(logged("ignoring 'writePlaylists'"));
    }
}

TEST_CASE("writePlaylists survives a round trip through the file format") {
    Settings original;
    original.writePlaylists = false;

    CHECK_FALSE(parseFresh(serialiseSettings(original)).writePlaylists);
    CHECK(parseFresh(serialiseSettings(Settings())).writePlaylists);
}
