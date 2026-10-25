#include "third_party/doctest.h"

#include "core/failures.h"
#include "core/library.h"
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
#include <string>
#include <string_view>
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

struct Served {
    QuestionLibrary questions;
    Library library;
    LibraryRoutesServer server;

    explicit Served(const char* name)
        : questions(questionLibraryOf(questionCase(name))), server(&library, kNow) {
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

    const auto response =
        server.client().Get(questionPath("credits", creditsOf(7, 0, true), questions.roles));
    REQUIRE(response);
    CHECK(response->status == 202);
    const auto document = documentOf(*response);
    CHECK(keysOf(document) == Keys{"ready", "structure", "revision", "trackCount", "columns",
                                   "changeCounts", "build", "halted"});
    CHECK(document.at("ready") == false);
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
