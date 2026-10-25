#include "third_party/doctest.h"

#include "core/failures.h"
#include "core/library.h"
#include "support/keys.h"
#include "support/library_routes_server.h"
#include "support/question_library.h"
#include "support/summary_library.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr int64_t kNow = 0;

constexpr char kStrokedLetters[] = "ascii: search mo for the stroked o";
constexpr char kGenres[] = "genres: search rock";
constexpr char kCredits[] = "credits: search \"alpha\" splits true";
constexpr uint32_t kBranfordRow = 3;

json documentOf(const httplib::Response& response) {
    return json::parse(response.body, nullptr, false);
}

bool variesOnEncoding(const httplib::Response& response) {
    for (size_t at = 0; at < response.get_header_value_count("Vary"); ++at) {
        if (response.get_header_value("Vary", "", at).find("Accept-Encoding") != std::string::npos)
            return true;
    }
    return false;
}

std::vector<Owned> valuesOf(const std::string& field, const std::string& prefix,
                            const size_t limit = 8) {
    return {{"field", field}, {"prefix", prefix}, {"limit", std::to_string(limit)}};
}

struct Served {
    QuestionLibrary questions;
    Library library;
    LibraryRoutesServer server;

    explicit Served(const char* name)
        : questions(questionLibraryOf(questionCase(name))), server(&library, kNow) {
        declareAndBuild(server, library, questions);
    }

    httplib::Result ask(const std::vector<Owned>& owned,
                        const std::vector<RoleAsked>& roles) const {
        return server.client().Get(questionPath("values", owned, roles));
    }

    httplib::Result ask(const std::vector<Owned>& owned) const {
        return ask(owned, questions.roles);
    }
};

json answered(const Served& served, const std::vector<Owned>& owned) {
    const auto response = served.ask(owned);
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return documentOf(*response);
}

}  // namespace

TEST_CASE(
    "an accented prefix is answered with the values it folds onto, at the pair the library holds") {
    Served served(kStrokedLetters);
    served.library.apply({served.questions.changed(0, "rating", "5")});
    const auto state = served.library.state();
    REQUIRE(state.revision != state.structure);
    const int refreshesBefore = served.server.refreshes();

    const auto response = served.ask(valuesOf("artist", "MŒ"));
    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Type") == "application/json");
    CHECK(documentOf(*response) == json{{"structure", state.structure},
                                        {"revision", state.revision},
                                        {"values", {"Moenia", "Mœnia"}}});
    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE("each field named on the route is completed from its own column") {
    struct Asked {
        const char* library;
        const char* field;
        const char* prefix;
        json values;
    };
    const std::vector<Asked> asked{
        {kCredits, "artist", "tv", {"TV On The Radio"}},
        {kCredits, "albumArtist", "tv", {"TV on the Radio"}},
        {kStrokedLetters, "album", "mo", {"Mo Better Blues", "Mœnia"}},
        {kGenres, "genre", "po", {"Pop"}},
    };
    for (const auto& question : asked) {
        INFO("field: ", question.field);
        const Served served(question.library);
        CHECK(answered(served, valuesOf(question.field, question.prefix)).at("values") ==
              question.values);
    }
}

TEST_CASE("an empty prefix is asked, and answers every value up to the limit") {
    const Served served(kStrokedLetters);

    CHECK(answered(served, valuesOf("artist", "", 100)).at("values") ==
          json{"Branford Marsalis", "Moenia", "MØ", "Mœnia", "Æon Flux", "Łódź"});
    CHECK(answered(served, valuesOf("artist", "", 2)).at("values") ==
          json{"Branford Marsalis", "Moenia"});
    CHECK(answered(served, valuesOf("artist", "", 0)).at("values") == json::array());
}

TEST_CASE("a retag between two asks is answered at the new revision with the value it brought") {
    Served served(kStrokedLetters);
    REQUIRE(answered(served, valuesOf("artist", "mon")).at("values") == json::array());

    served.library.apply({served.questions.changed(kBranfordRow, "artist", "Mono")});
    const json after = answered(served, valuesOf("artist", "mon"));
    CHECK(after.at("values") == json{"Mono"});
    CHECK(after.at("revision") == served.library.state().revision);
}

TEST_CASE(
    "a values answer is held by nobody but the client that asked, and sent under no validator") {
    const Served served(kStrokedLetters);

    const auto response = served.ask(valuesOf("artist", "mo"));
    REQUIRE(response);
    REQUIRE(response->status == 200);
    CHECK(response->get_header_value("Cache-Control") == "private, no-cache");
    CHECK_FALSE(response->has_header("ETag"));
}

TEST_CASE(
    "a values answer is gzipped where offered, sent as it stands where not, and varies on it") {
    const Served served(kStrokedLetters);
    auto client = served.server.client();
    client.set_decompress(false);

    const auto path = questionPath("values", valuesOf("artist", "mo"), served.questions.roles);
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

TEST_CASE("a prefix of 1024 bytes is asked, and one byte more is refused however few characters") {
    const Served served(kStrokedLetters);
    const json tooLong{{"error", "unacceptable question"},
                       {"detail", "'prefix' must be at most 1024 bytes"}};

    std::string twoByteCharacters;
    for (int at = 0; at < 512; ++at)
        twoByteCharacters += "é";
    REQUIRE(twoByteCharacters.size() == 1024);

    struct Asked {
        const char* what;
        std::string prefix;
        int status;
    };
    const std::vector<Asked> prefixes{
        {"1024 single-byte characters", std::string(1024, 'm'), 200},
        {"1025 single-byte characters", std::string(1025, 'm'), 400},
        {"512 two-byte characters", twoByteCharacters, 200},
        {"512 two-byte characters and one byte more", twoByteCharacters + "m", 400},
    };
    for (const auto& asked : prefixes) {
        INFO("prefix: ", std::string(asked.what));
        const auto response = served.ask(valuesOf("artist", asked.prefix));
        REQUIRE(response);
        CHECK(response->status == asked.status);
        if (asked.status == 400)
            CHECK(documentOf(*response) == tooLong);
        else
            CHECK(documentOf(*response).at("values") == json::array());
    }
}

TEST_CASE("a role or a values question the route cannot read is refused with a 400 saying what") {
    const Served served(kStrokedLetters);
    const int refreshesBefore = served.server.refreshes();
    const std::string tooLong = "role 'album' must be printable text of 1 to " +
                                std::to_string(kMaxColumnLength) + " characters";
    const std::string valid = "field=artist&prefix=mo&limit=8";
    const std::string notACount = "'limit' must be a whole number of 0 or more";

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
        {"the credit question's own parameter", valid + "&ordinal=0", "unacceptable role",
         "'ordinal' is not a role"},
        {"splitsCredits, which completion has no use for", valid + "&splitsCredits=true",
         "unacceptable role", "'splitsCredits' is not a role"},
        {"an empty expression", valid + "&album=", "unacceptable role", tooLong},
        {"a role named twice", valid + "&album=%25album%25&album=%25artist%25", "duplicate role",
         "role 'album' is named twice"},

        {"no field", "prefix=mo&limit=8", "unacceptable question", "'field' is required"},
        {"no prefix", "field=artist&limit=8", "unacceptable question", "'prefix' is required"},
        {"no limit", "field=artist&prefix=mo", "unacceptable question", "'limit' is required"},

        {"a negative limit", "field=artist&prefix=mo&limit=-1", "unacceptable question", notACount},
        {"a fractional limit", "field=artist&prefix=mo&limit=1.5", "unacceptable question",
         notACount},
        {"a limit with a plus sign", "field=artist&prefix=mo&limit=%2B1", "unacceptable question",
         notACount},
        {"an empty limit", "field=artist&prefix=mo&limit=", "unacceptable question", notACount},
        {"a limit that is a word", "field=artist&prefix=mo&limit=all", "unacceptable question",
         notACount},

        {"field named twice", "field=artist&field=album&prefix=mo&limit=8", "duplicate question",
         "'field' is named twice"},
        {"prefix named twice", "field=artist&prefix=mo&prefix=ma&limit=8", "duplicate question",
         "'prefix' is named twice"},
        {"limit named twice", "field=artist&prefix=mo&limit=1&limit=2", "duplicate question",
         "'limit' is named twice"},
    };

    for (const auto& request : refused) {
        INFO("refused: ", std::string(request.what));
        const auto response = served.server.client().Get("/api/library/values?" + request.query);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(documentOf(*response) == json{{"error", request.error}, {"detail", request.detail}});
    }

    CHECK(served.server.refreshes() == refreshesBefore);
}

// The contract lists the four fields and names no sentence for any other, so the refusal is held
// to its error and to naming the parameter.
TEST_CASE("a field other than artist, albumArtist, album and genre is a 400 naming the field") {
    const Served served(kStrokedLetters);

    for (const std::string field : {"title", "genres", "", "artists", "%25artist%25"}) {
        INFO("field: ", field);
        const auto response =
            served.server.client().Get("/api/library/values?prefix=mo&limit=8&field=" + field);
        REQUIRE(response);
        CHECK(response->status == 400);
        const json document = documentOf(*response);
        CHECK(document.value("error", "") == "unacceptable question");
        CHECK(document.value("detail", "").find("'field'") != std::string::npos);
    }
}

TEST_CASE("without the media library a values question is a 503, after what it asks is judged") {
    const LibraryRoutesServer server(nullptr, kNow);
    const auto roles = questionLibraryOf(questionCase(kStrokedLetters)).roles;

    const auto refused = server.client().Get("/api/library/values");
    REQUIRE(refused);
    CHECK(refused->status == 400);

    const auto unavailable =
        server.client().Get(questionPath("values", valuesOf("artist", "mo"), roles));
    REQUIRE(unavailable);
    CHECK(unavailable->status == 503);
    CHECK(errorOf(*unavailable) == kNoLibrary);
    CHECK(server.refreshes() == 0);
}

TEST_CASE(
    "with no snapshot ready a values question answers the library document, starting no build") {
    const auto questions = questionLibraryOf(questionCase(kStrokedLetters));
    const Library library;
    const LibraryRoutesServer server(&library, kNow);
    const auto declared = declareThroughRows(server, questions.declared);
    REQUIRE(declared);
    REQUIRE(declared->status == 202);
    const int refreshesBefore = server.refreshes();

    const auto response =
        server.client().Get(questionPath("values", valuesOf("artist", "mo"), questions.roles));
    REQUIRE(response);
    CHECK(response->status == 202);
    const auto document = documentOf(*response);
    CHECK(keysOf(document) == Keys{"ready", "structure", "revision", "trackCount", "columns",
                                   "changeCounts", "build", "halted"});
    CHECK(document.at("ready") == false);
    CHECK(server.refreshes() == refreshesBefore);
}

TEST_CASE(
    "a values role naming a declared column the snapshot lacks is a 202 that starts no build") {
    const Served served(kStrokedLetters);

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

    const auto response = served.ask(valuesOf("genre", ""), moody);
    REQUIRE(response);
    CHECK(response->status == 202);
    const auto document = documentOf(*response);
    CHECK(document.at("ready") == true);
    CHECK(document.at("structure") == served.library.state().structure);
    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE("a values role naming a column the declaration does not hold is a 409 naming it") {
    const Served served(kStrokedLetters);
    const int refreshesBefore = served.server.refreshes();

    auto commented = served.questions.roles;
    for (auto& role : commented) {
        if (role.name == "genre")
            role.expression = "%comment%";
    }

    const auto response = served.ask(valuesOf("genre", ""), commented);
    REQUIRE(response);
    CHECK(response->status == 409);
    CHECK(errorOf(*response) == "'%comment%' is not a declared column");
    CHECK(served.server.refreshes() == refreshesBefore);
}
