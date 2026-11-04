#include "third_party/doctest.h"

#include "core/failures.h"
#include "core/library.h"
#include "core/player_outcome.h"
#include "support/keys.h"
#include "support/library_routes_server.h"
#include "support/question_library.h"
#include "support/summary_cases.h"
#include "support/summary_library.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr int64_t kNow = 0;

constexpr char kCreditsCase[] = "credits: search \"alpha\" splits true";
constexpr uint32_t kAlphaFtGamma = 2;

constexpr char kStructureMoved[] = "tracks were added or removed; read the state and ask again";

json documentOf(const httplib::Response& response) {
    return json::parse(response.body, nullptr, false);
}

const json& creditCase(const std::string_view name) {
    const json& cases = casesIn("library_credits_cases.json").at("cases");
    const auto found = std::find_if(cases.begin(), cases.end(), [name](const json& credited) {
        return credited.at("name").get_ref<const std::string&>() == name;
    });
    REQUIRE_MESSAGE(found != cases.end(), "the credits cases hold no case named ",
                    std::string(name));
    return *found;
}

bool variesOnEncoding(const httplib::Response& response) {
    for (size_t at = 0; at < response.get_header_value_count("Vary"); ++at) {
        if (response.get_header_value("Vary", "", at).find("Accept-Encoding") != std::string::npos)
            return true;
    }
    return false;
}

std::vector<Owned> creditsOf(const uint64_t structure, const uint32_t ordinal,
                             const bool splitsCredits) {
    return {{"splitsCredits", splitsCredits ? "true" : "false"},
            {"structure", std::to_string(structure)},
            {"ordinal", std::to_string(ordinal)}};
}

std::string libraryPathOf(const std::vector<std::string>& row) {
    return row.at(0) + row.at(1);
}

// `subsong` is left out where it is nullopt, which the route reads as 0.
std::vector<Owned> creditsAt(const std::string& track, const std::optional<std::string>& subsong,
                             const bool splitsCredits) {
    std::vector<Owned> owned{{"splitsCredits", splitsCredits ? "true" : "false"}, {"track", track}};
    if (subsong)
        owned.push_back({"subsong", *subsong});
    return owned;
}

struct Served {
    QuestionLibrary questions;
    Library library;
    LibraryRoutesServer server;

    explicit Served(const char* name) : Served(questionLibraryOf(questionCase(name))) {}

    explicit Served(QuestionLibrary built) : questions(std::move(built)), server(&library, kNow) {
        declareAndBuild(server, library, questions);
    }

    uint64_t structure() const { return library.state().structure; }

    httplib::Result ask(const std::vector<Owned>& owned,
                        const std::vector<RoleAsked>& roles) const {
        return server.client().Get(questionPath("credits", owned, roles));
    }

    httplib::Result ask(const uint64_t structure, const uint32_t ordinal) const {
        return ask(creditsOf(structure, ordinal, true), questions.roles);
    }
};

}  // namespace

TEST_CASE("every track of a case is answered through the route as today's creditMembers names it") {
    Served served(kCreditsCase);
    served.library.apply({served.questions.changed(0, "rating", "5")});
    const auto state = served.library.state();
    REQUIRE(state.revision != state.structure);
    const int refreshesBefore = served.server.refreshes();

    for (const json& row : creditCase(kCreditsCase).at("rows")) {
        const auto ordinal = row.at("ordinal").get<uint32_t>();
        for (const auto& [way, splitsCredits] : {std::pair{"split", true}, {"unsplit", false}}) {
            INFO("ordinal ", ordinal, ", ", way);
            const auto response = served.ask(creditsOf(state.structure, ordinal, splitsCredits),
                                             served.questions.roles);
            REQUIRE(response);
            CHECK(response->status == 200);
            CHECK(response->get_header_value("Content-Type") == "application/json");
            CHECK(documentOf(*response) == json{{"structure", state.structure},
                                                {"revision", state.revision},
                                                {"artist", row.at(way).at("artist")},
                                                {"albumArtist", row.at(way).at("albumArtist")}});
        }
    }
    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE(
    "a credit answer is held by nobody but the client that asked, and sent under no validator") {
    const Served served(kCreditsCase);

    const auto response = served.ask(served.structure(), kAlphaFtGamma);
    REQUIRE(response);
    REQUIRE(response->status == 200);
    CHECK(response->get_header_value("Cache-Control") == "private, no-cache");
    CHECK_FALSE(response->has_header("ETag"));
}

TEST_CASE(
    "a credit answer is gzipped where offered, sent as it stands where not, and varies on it") {
    const Served served(kCreditsCase);
    auto client = served.server.client();
    client.set_decompress(false);

    const auto path = questionPath("credits", creditsOf(served.structure(), kAlphaFtGamma, true),
                                   served.questions.roles);
    const auto packed = client.Get(path, accepting("gzip"));
    const auto plain = client.Get(path, accepting("identity"));
    REQUIRE(packed);
    REQUIRE(plain);
    REQUIRE(packed->status == 200);
    REQUIRE(plain->status == 200);

    CHECK(packed->get_header_value("Content-Encoding") == "gzip");
    CHECK(isGzip(packed->body));
    CHECK(variesOnEncoding(*packed));

    CHECK(plain->get_header_value("Content-Encoding").empty());
    CHECK(documentOf(*plain).is_object());
    CHECK(variesOnEncoding(*plain));
}

TEST_CASE("a structure that is not the current one is a 409, before an ordinal past the end is") {
    Served served(kCreditsCase);
    const uint64_t before = served.structure();
    QuestionLibrary grown = served.questions;
    grown.rows.push_back(grown.rows.back());
    grown.rows.back().at(1) = "added.flac";
    served.library.replace(grown.snapshot());
    const uint64_t current = served.structure();
    REQUIRE(current != before);
    const auto tracks = static_cast<uint32_t>(served.library.state().trackCount);
    const int refreshesBefore = served.server.refreshes();

    struct Stale {
        const char* what;
        uint64_t structure;
        uint32_t ordinal;
    };
    const std::vector<Stale> stale{
        {"the structure before tracks were added", before, kAlphaFtGamma},
        {"the structure before, and an ordinal past its end", before, tracks + 100},
        {"a structure the library never had", current + 1, kAlphaFtGamma},
    };
    for (const auto& asked : stale) {
        INFO(asked.what);
        const auto response = served.ask(asked.structure, asked.ordinal);
        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(documentOf(*response) == json{{"error", kStructureMoved}, {"detail", ""}});
    }

    const auto last = served.ask(current, tracks - 1);
    REQUIRE(last);
    CHECK(last->status == 200);
    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE("an ordinal past the last track of the current structure is a 400 naming the ordinal") {
    const Served served(kCreditsCase);
    const auto tracks = static_cast<uint32_t>(served.library.state().trackCount);

    for (const uint32_t ordinal : {tracks, tracks + 1, uint32_t{4294967295}}) {
        INFO("ordinal: ", ordinal);
        const auto response = served.ask(served.structure(), ordinal);
        REQUIRE(response);
        CHECK(response->status == 400);
        const json document = documentOf(*response);
        CHECK(document.value("error", "") == "unacceptable question");
        CHECK(document.value("detail", "").find("'ordinal'") != std::string::npos);
    }
}

TEST_CASE("a role or a credit question the route cannot read is refused with a 400 saying what") {
    const Served served(kCreditsCase);
    const int refreshesBefore = served.server.refreshes();
    const std::string tooLong = "role 'album' must be printable text of 1 to " +
                                std::to_string(kMaxColumnLength) + " characters";
    const std::string valid = "splitsCredits=true&structure=1&ordinal=0";

    struct Refused {
        const char* what;
        std::string query;
        const char* error;
        std::string detail;
    };
    const std::vector<Refused> refused{
        {"a name that is no role", valid + "&colour=%25title%25", "unacceptable role",
         "'colour' is not a role"},
        {"a page question's own parameter", valid + "&name=Alpha", "unacceptable role",
         "'name' is not a role"},
        {"the search question's own parameter", valid + "&query=a", "unacceptable role",
         "'query' is not a role"},
        {"the values question's own parameter", valid + "&field=artist", "unacceptable role",
         "'field' is not a role"},
        {"an empty expression", valid + "&album=", "unacceptable role", tooLong},
        {"a role named twice", valid + "&album=%25album%25&album=%25artist%25", "duplicate role",
         "role 'album' is named twice"},

        {"no splitsCredits", "structure=1&ordinal=0", "unacceptable question",
         "'splitsCredits' is required"},
        {"no structure", "splitsCredits=true&ordinal=0", "unacceptable question",
         "'structure' is required"},
        {"no ordinal", "splitsCredits=true&structure=1", "unacceptable question",
         "'ordinal' is required"},

        {"a splitsCredits of yes", "splitsCredits=yes&structure=1&ordinal=0",
         "unacceptable question", "'splitsCredits' must be true or false"},
        {"a negative ordinal", "splitsCredits=true&structure=1&ordinal=-1", "unacceptable question",
         "'ordinal' must be a whole number of 0 or more"},
        {"a fractional ordinal", "splitsCredits=true&structure=1&ordinal=1.5",
         "unacceptable question", "'ordinal' must be a whole number of 0 or more"},
        {"an ordinal with a plus sign", "splitsCredits=true&structure=1&ordinal=%2B1",
         "unacceptable question", "'ordinal' must be a whole number of 0 or more"},
        {"an empty ordinal", "splitsCredits=true&structure=1&ordinal=", "unacceptable question",
         "'ordinal' must be a whole number of 0 or more"},

        {"splitsCredits named twice",
         "splitsCredits=true&splitsCredits=false&structure=1&ordinal=0", "duplicate question",
         "'splitsCredits' is named twice"},
        {"structure named twice", "splitsCredits=true&structure=1&structure=2&ordinal=0",
         "duplicate question", "'structure' is named twice"},
        {"ordinal named twice", "splitsCredits=true&structure=1&ordinal=0&ordinal=1",
         "duplicate question", "'ordinal' is named twice"},
    };

    for (const auto& request : refused) {
        INFO("refused: ", std::string(request.what));
        const auto response = served.server.client().Get("/api/library/credits?" + request.query);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(documentOf(*response) == json{{"error", request.error}, {"detail", request.detail}});
    }

    CHECK(served.server.refreshes() == refreshesBefore);
}

// The contract spells a structure as a string of decimal digits and names no sentence for one
// that is not, so the refusal is held to its error and to naming the parameter.
TEST_CASE("a structure that is not a string of decimal digits is a 400 naming the structure") {
    const Served served(kCreditsCase);

    for (const std::string structure : {"x", "-1", "", "1.5", "%2B1", "0x10"}) {
        INFO("structure: ", structure);
        const auto response = served.server.client().Get(
            "/api/library/credits?splitsCredits=true&ordinal=0&structure=" + structure);
        REQUIRE(response);
        CHECK(response->status == 400);
        const json document = documentOf(*response);
        CHECK(document.value("error", "") == "unacceptable question");
        CHECK(document.value("detail", "").find("'structure'") != std::string::npos);
    }
}

TEST_CASE("without the media library a credit question is a 503, after what it asks is judged") {
    const LibraryRoutesServer server(nullptr, kNow);
    const auto roles = questionLibraryOf(questionCase(kCreditsCase)).roles;

    const auto refused = server.client().Get("/api/library/credits");
    REQUIRE(refused);
    CHECK(refused->status == 400);

    // With no library there is no end for the ordinal to fall past.
    for (const uint32_t ordinal : {uint32_t{0}, uint32_t{4294967295}}) {
        INFO("ordinal: ", ordinal);
        const auto unavailable =
            server.client().Get(questionPath("credits", creditsOf(1, ordinal, true), roles));
        REQUIRE(unavailable);
        CHECK(unavailable->status == 503);
        CHECK(errorOf(*unavailable) == kNoLibrary);
    }

    const auto byPath = server.client().Get(
        questionPath("credits", creditsAt("Alpha/First/01 Solo.flac", "0", true), roles));
    REQUIRE(byPath);
    CHECK(byPath->status == 503);
    CHECK(errorOf(*byPath) == kNoLibrary);
    CHECK(server.refreshes() == 0);
}

TEST_CASE(
    "with no snapshot ready a credit question answers the library document, starting no build") {
    const auto questions = questionLibraryOf(questionCase(kCreditsCase));
    const Library library;
    const LibraryRoutesServer server(&library, kNow);
    const auto declared = declareThroughRows(server, questions.declared);
    REQUIRE(declared);
    REQUIRE(declared->status == 202);
    const int refreshesBefore = server.refreshes();

    const std::vector<std::pair<const char*, std::vector<Owned>>> forms{
        {"by ordinal", creditsOf(7, 0, true)},
        {"by library path", creditsAt(libraryPathOf(questions.rows.at(0)), "0", true)},
    };
    for (const auto& [form, owned] : forms) {
        INFO(std::string(form));
        const auto response = server.client().Get(questionPath("credits", owned, questions.roles));
        REQUIRE(response);
        CHECK(response->status == 202);
        const auto document = documentOf(*response);
        CHECK(keysOf(document) == Keys{"ready", "structure", "revision", "trackCount", "columns",
                                       "changeCounts", "build", "halted"});
        CHECK(document.at("ready") == false);
    }
    CHECK(server.refreshes() == refreshesBefore);
}

TEST_CASE(
    "a credit role naming a declared column the snapshot lacks is a 202 that starts no build") {
    const Served served(kCreditsCase);

    constexpr char kMood[] = "%mood%";
    auto wider = served.questions.declared;
    wider.emplace_back(kMood);
    const auto declared = declareThroughRows(served.server, wider);
    REQUIRE(declared);
    REQUIRE(declared->status == 202);
    const int refreshesBefore = served.server.refreshes();

    auto moody = served.questions.roles;
    for (auto& role : moody) {
        if (role.name == "genre")
            role.expression = kMood;
    }

    const auto response = served.ask(creditsOf(served.structure(), kAlphaFtGamma, true), moody);
    REQUIRE(response);
    CHECK(response->status == 202);
    const auto document = documentOf(*response);
    CHECK(document.at("ready") == true);
    CHECK(document.at("structure") == served.structure());
    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE("a credit role naming a column the declaration does not hold is a 409 naming it") {
    const Served served(kCreditsCase);
    const int refreshesBefore = served.server.refreshes();

    auto commented = served.questions.roles;
    for (auto& role : commented) {
        if (role.name == "genre")
            role.expression = "%comment%";
    }

    const auto response = served.ask(creditsOf(served.structure(), kAlphaFtGamma, true), commented);
    REQUIRE(response);
    CHECK(response->status == 409);
    CHECK(errorOf(*response) == "'%comment%' is not a declared column");
    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE("a library path answers the document its track's ordinal answers, split or unsplit") {
    Served served(kCreditsCase);
    served.library.apply({served.questions.changed(0, "rating", "5")});
    const auto state = served.library.state();
    const int refreshesBefore = served.server.refreshes();

    for (const json& row : creditCase(kCreditsCase).at("rows")) {
        const auto ordinal = row.at("ordinal").get<uint32_t>();
        const std::string track = libraryPathOf(served.questions.rows.at(ordinal));
        for (const bool splitsCredits : {true, false}) {
            const auto byOrdinal = served.ask(creditsOf(state.structure, ordinal, splitsCredits),
                                              served.questions.roles);
            REQUIRE(byOrdinal);
            REQUIRE(byOrdinal->status == 200);

            for (const std::optional<std::string>& subsong :
                 {std::optional<std::string>{"0"}, std::optional<std::string>{}}) {
                INFO(track, ", splitsCredits ", splitsCredits, ", subsong ",
                     subsong.value_or("left out"));
                const auto byPath =
                    served.ask(creditsAt(track, subsong, splitsCredits), served.questions.roles);
                REQUIRE(byPath);
                CHECK(byPath->status == 200);
                CHECK(byPath->get_header_value("Content-Type") == "application/json");
                CHECK(documentOf(*byPath) == documentOf(*byOrdinal));
            }
        }
    }
    CHECK(served.server.refreshes() == refreshesBefore);
}

// The twin is another credit's row moved to the same file, so an answer for the wrong subsong
// names other artists than the right one would.
TEST_CASE("a subsong picks the track of that subsong among those one file holds") {
    QuestionLibrary built = questionLibraryOf(questionCase(kCreditsCase));
    std::vector<std::string> twin = built.rows.at(10);
    twin.at(0) = built.rows.at(kAlphaFtGamma).at(0);
    twin.at(1) = built.rows.at(kAlphaFtGamma).at(1);
    twin.at(2) = "1";
    built.rows.insert(built.rows.begin() + kAlphaFtGamma + 1, twin);
    const Served served(std::move(built));
    const std::string track = libraryPathOf(served.questions.rows.at(kAlphaFtGamma));

    const auto first = served.ask(served.structure(), kAlphaFtGamma);
    const auto second = served.ask(served.structure(), kAlphaFtGamma + 1);
    REQUIRE(first);
    REQUIRE(second);
    REQUIRE(first->status == 200);
    REQUIRE(second->status == 200);
    REQUIRE(documentOf(*first) != documentOf(*second));

    for (const auto& [subsong, expected] :
         {std::pair{"0", documentOf(*first)}, {"1", documentOf(*second)}}) {
        INFO("subsong ", std::string(subsong));
        const auto response = served.ask(creditsAt(track, subsong, true), served.questions.roles);
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(documentOf(*response) == expected);
    }

    const auto none = served.ask(creditsAt(track, "2", true), served.questions.roles);
    REQUIRE(none);
    CHECK(none->status == 404);
    CHECK(errorOf(*none) == kNoSuchLibraryTrack);
}

TEST_CASE("a library path and subsong no track holds is a 404 saying there is no such track") {
    const Served served(kCreditsCase);
    const int refreshesBefore = served.server.refreshes();
    const std::string held = libraryPathOf(served.questions.rows.at(0));
    const std::string directory = served.questions.rows.at(0).at(0);
    const std::string filename = served.questions.rows.at(0).at(1);

    struct Unheld {
        const char* what;
        std::string track;
        std::optional<std::string> subsong;
    };
    // The path is a lookup key, so a spelling that a filesystem would resolve to a held file
    // still names nothing.
    const std::vector<Unheld> unheld{
        {"a path no track is at", "Nobody/Nowhere/01 Missing.flac", "0"},
        {"a subsong the file does not hold", held, "1"},
        {"the last subsong 32 bits hold", held, "4294967295"},
        {"a directory alone", directory, "0"},
        {"a filename alone", filename, "0"},
        {"a path through '..'", directory + "../" + held, "0"},
        {"a path back-slashed", "Alpha\\First\\01 Solo.flac", std::nullopt},
    };
    REQUIRE(held == "Alpha/First/01 Solo.flac");

    for (const auto& asked : unheld) {
        INFO(std::string(asked.what));
        const auto response =
            served.ask(creditsAt(asked.track, asked.subsong, true), served.questions.roles);
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(errorOf(*response) == kNoSuchLibraryTrack);
    }
    CHECK(served.server.refreshes() == refreshesBefore);
}

// Two media library roots can hold one relative path. Answering whichever sorts first would show
// one copy's credit for the row a client opened from the other.
TEST_CASE("a library path two media library roots hold is the 409 GET /api/track/library gives") {
    QuestionLibrary built = questionLibraryOf(questionCase(kCreditsCase));
    built.rows.insert(built.rows.begin() + kAlphaFtGamma + 1, built.rows.at(kAlphaFtGamma));
    const Served served(std::move(built));
    const std::string twice = libraryPathOf(served.questions.rows.at(kAlphaFtGamma));
    const int refreshesBefore = served.server.refreshes();

    for (const std::optional<std::string>& subsong :
         {std::optional<std::string>{"0"}, std::optional<std::string>{}}) {
        INFO("subsong ", subsong.value_or("left out"));
        const auto response = served.ask(creditsAt(twice, subsong, true), served.questions.roles);
        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(errorOf(*response) == describe(PlayerOutcome::ambiguousAddress));
        CHECK_FALSE(documentOf(*response).contains("artist"));
    }

    const auto noSuchSubsong = served.ask(creditsAt(twice, "1", true), served.questions.roles);
    REQUIRE(noSuchSubsong);
    CHECK(noSuchSubsong->status == 404);

    const auto once = served.ask(creditsAt(libraryPathOf(served.questions.rows.at(0)), "0", true),
                                 served.questions.roles);
    REQUIRE(once);
    CHECK(once->status == 200);
    CHECK(served.server.refreshes() == refreshesBefore);
}

// Every request below is refused with the error the route gives a malformed question. The
// detail is left to the route: the contract names no sentence for these.
// The detail is left to the route: the owner named the error for these and no sentence.
TEST_CASE("a credit question naming both forms, neither, or half of one is a 400 refusing it") {
    const Served served(kCreditsCase);
    const int refreshesBefore = served.server.refreshes();
    const std::string track = libraryPathOf(served.questions.rows.at(0));
    const std::string structure = std::to_string(served.structure());

    constexpr char kUnacceptable[] = "unacceptable question";
    constexpr char kDuplicate[] = "duplicate question";

    struct Refused {
        const char* what;
        std::vector<Owned> owned;
        const char* error = kUnacceptable;
    };
    const std::vector<Refused> refused{
        {"both forms whole",
         {{"splitsCredits", "true"},
          {"structure", structure},
          {"ordinal", "0"},
          {"track", track},
          {"subsong", "0"}}},
        {"an ordinal form and a track",
         {{"splitsCredits", "true"}, {"structure", structure}, {"ordinal", "0"}, {"track", track}}},
        {"an ordinal form and a subsong",
         {{"splitsCredits", "true"}, {"structure", structure}, {"ordinal", "0"}, {"subsong", "0"}}},
        {"a track and an ordinal with no structure",
         {{"splitsCredits", "true"}, {"ordinal", "0"}, {"track", track}}},
        {"neither form", {{"splitsCredits", "true"}}},
        {"a subsong alone", {{"splitsCredits", "true"}, {"subsong", "0"}}},
        {"a track with no splitsCredits", {{"track", track}, {"subsong", "0"}}},
        {"a track named twice",
         {{"splitsCredits", "true"}, {"track", track}, {"track", "Beta/Second/01 Beta Alone.flac"}},
         kDuplicate},
        {"a subsong named twice",
         {{"splitsCredits", "true"}, {"track", track}, {"subsong", "0"}, {"subsong", "1"}},
         kDuplicate},
        {"an empty track", {{"splitsCredits", "true"}, {"track", ""}}},
        {"a track past 4096 characters",
         {{"splitsCredits", "true"}, {"track", std::string(4097, 'a')}}},
        {"a track carrying a control character",
         {{"splitsCredits", "true"},
          {"track", "Alpha/First/" + std::string(1, '\x01') + "01 Solo.flac"}}},
    };

    for (const auto& request : refused) {
        INFO("refused: ", std::string(request.what));
        const auto response = served.server.client().Get(
            questionPath("credits", request.owned, served.questions.roles));
        REQUIRE(response);
        CHECK(response->status == 400);
        const json document = documentOf(*response);
        CHECK(document.value("error", "") == std::string(request.error));
        CHECK_FALSE(document.contains("artist"));
    }
    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE("a subsong that is not a whole number 32 bits hold is a 400 naming the subsong") {
    const Served served(kCreditsCase);
    const std::string track = libraryPathOf(served.questions.rows.at(0));

    for (const std::string subsong : {"x", "-1", "", "1.5", "+1", "4294967296"}) {
        INFO("subsong: ", subsong);
        const auto response = served.ask(creditsAt(track, subsong, true), served.questions.roles);
        REQUIRE(response);
        CHECK(response->status == 400);
        const json document = documentOf(*response);
        CHECK(document.value("error", "") == "unacceptable question");
        CHECK(document.value("detail", "").find("'subsong'") != std::string::npos);
    }
}
