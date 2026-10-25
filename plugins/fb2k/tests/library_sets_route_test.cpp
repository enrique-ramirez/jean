#include "third_party/doctest.h"

#include "core/library.h"
#include "support/keys.h"
#include "support/library_routes_server.h"
#include "support/question_library.h"
#include "support/set_cases.h"
#include "support/summary_cases.h"
#include "support/summary_library.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr int64_t kNow = 0;

json documentOf(const httplib::Response& response) {
    return json::parse(response.body, nullptr, false);
}

struct Served {
    const json& setsCase;
    QuestionLibrary questions;
    Library library;
    LibraryRoutesServer server;

    explicit Served(const json& asked)
        : setsCase(asked), questions(measuredLibraryOf(asked)), server(&library, kNow) {
        declareAndBuild(server, library, questions);
    }

    json answer() const {
        const auto response =
            server.client().Get(questionPathOf(sourceOf(setsCase), questions.roles));
        REQUIRE(response);
        REQUIRE(response->status == 200);
        return documentOf(*response);
    }
};

const json& setNamed(const json& setsCase, const std::string& part) {
    const json& sets = setsCase.at("sets");
    const auto found = std::find_if(sets.begin(), sets.end(),
                                    [&part](const json& set) { return set.at("part") == part; });
    REQUIRE_MESSAGE(found != sets.end(), "the case holds no ", part, " set");
    return *found;
}

json recordsOnTheWire(const json& setsCase, const std::string& part) {
    json records = setNamed(setsCase, part).at("records");
    for (json& record : records)
        record["cover"] = pathIn(setsCase, record.at("cover").get<uint32_t>());
    return records;
}

// The cases file read its last-played stamps in its own zone, and the component reads them in this
// machine's.
json cardsOnTheWire(const json& setsCase) {
    json cards = setNamed(setsCase, "all").at("cards");
    if (cards.at("lastPlayed").is_number())
        cards["lastPlayed"] = onThisMachine(cards.at("lastPlayed").get<int64_t>());
    if (cards.at("mostPlayed").is_object()) {
        const auto ordinal = cards.at("mostPlayed").at("ordinal").get<uint32_t>();
        cards["mostPlayed"] = {{"ordinal", ordinal},
                               {"title", titleIn(setsCase, ordinal)},
                               {"plays", cards.at("mostPlayed").at("plays")}};
    }
    return cards;
}

std::string genresPath(const std::string& value) {
    return summaryPath(everyRole()) + "&genres=" + value;
}

std::string etagOf(const httplib::Result& response) {
    REQUIRE(response);
    REQUIRE(response->status == 200);
    const auto tag = response->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());
    return tag;
}

}  // namespace

TEST_CASE(
    "each question carries the figures of the set it names, and an artist its cards and records") {
    for (const char* name :
         {"basic: album with its artist", "basic: genre", "basic: search one letter a"}) {
        INFO("case: ", name);
        const Served served(setCase(name));
        const json& set = served.setsCase.at("sets").at(0);
        REQUIRE(set.at("figures").at("trackCount") > 1);

        CHECK(served.answer().at("figures") == set.at("figures"));
    }

    // Canon's own records begin at a row that is not their album's cover track.
    for (const char* name :
         {"credits: artist \"Beta\" splits true", "canonical: artist \"Canon\" splits true"}) {
        INFO("case: ", name);
        const Served served(setCase(name));
        const json answer = served.answer();

        CHECK(answer.at("figures") == setNamed(served.setsCase, "all").at("figures"));
        CHECK(answer.at("cards") == cardsOnTheWire(served.setsCase));

        const json& records = answer.at("records");
        CHECK(keysOf(records) == Keys{"own", "shared"});
        CHECK(records.at("own") == recordsOnTheWire(served.setsCase, "own"));
        CHECK(records.at("shared") == recordsOnTheWire(served.setsCase, "shared"));
    }
}

TEST_CASE(
    "a summary asked for its genres lists each with its tracks, albums, artists and two covers") {
    Library library;
    const LibraryRoutesServer server(&library, localNoon(kSummaryDate));
    declareAndBuild(server, library);

    const auto response = server.client().Get(genresPath("true"));
    REQUIRE(response);
    REQUIRE(response->status == 200);

    // Every album holds two tracks, so each tile's two largest are its first two albums. Rock is
    // albums 0, 2 and 4 by Artist A, Jazz albums 1 and 3 by Artist B.
    CHECK(documentOf(*response).at("genres") ==
          json::array({
              {{"name", "Rock"},
               {"count", 6},
               {"albumCount", 3},
               {"artistCount", 1},
               {"covers", {"Artist/Album 0/01 Song.flac", "Artist/Album 2/01 Song.flac"}}},
              {{"name", "Jazz"},
               {"count", 4},
               {"albumCount", 2},
               {"artistCount", 1},
               {"covers", {"Artist/Album 1/01 Song.flac", "Artist/Album 3/01 Song.flac"}}},
          }));
}

TEST_CASE("a summary without genres, or with genres=false, carries no genres") {
    Library library;
    const LibraryRoutesServer server(&library, localNoon(kSummaryDate));
    declareAndBuild(server, library);

    for (const std::string& path : {summaryPath(everyRole()), genresPath("false")}) {
        INFO("path: ", path);
        const auto response = server.client().Get(path);
        REQUIRE(response);
        REQUIRE(response->status == 200);
        const json document = documentOf(*response);
        CHECK(document.contains("shelves"));
        CHECK_FALSE(document.contains("genres"));
    }
}

TEST_CASE("a genres value other than true or false is refused with a 400 before any summary") {
    Library library;
    const LibraryRoutesServer server(&library, localNoon(kSummaryDate));
    declareAndBuild(server, library);

    for (const char* value : {"yes", "1", "TRUE", ""}) {
        INFO("genres=", value);
        const auto response = server.client().Get(genresPath(value));
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == "unacceptable question");
    }
    CHECK(server.summaryComputations() == 0);
}

TEST_CASE("a summary with genres is sent under an ETag of its own") {
    Library library;
    const LibraryRoutesServer server(&library, localNoon(kSummaryDate));
    declareAndBuild(server, library);

    const auto without = etagOf(server.client().Get(summaryPath(everyRole())));
    const auto with = etagOf(server.client().Get(genresPath("true")));
    CHECK(with != without);

    const auto held =
        server.client().Get(genresPath("true"), httplib::Headers{{"If-None-Match", without}});
    REQUIRE(held);
    CHECK(held->status == 200);
}
