
#include "third_party/doctest.h"

#include "core/failures.h"
#include "core/library.h"
#include "support/keys.h"
#include "support/library_routes_server.h"
#include "support/spec.h"
#include "support/summary_library.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <cstdint>
#include <set>
#include <string>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr int64_t kHourMs = 3'600'000;

// A day and a half later is another local date wherever the suite runs, daylight saving included.
constexpr int64_t kNextDayMs = 36 * kHourMs;

httplib::Result getHolding(const LibraryRoutesServer& server, const std::string& path,
                           const std::string& tag) {
    return server.client().Get(path, httplib::Headers{{"If-None-Match", tag}});
}

std::string etagOf(const httplib::Result& response) {
    REQUIRE(response);
    REQUIRE(response->status == 200);
    const auto tag = response->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());
    return tag;
}

std::string etagAt(const LibraryRoutesServer& server, const std::vector<RoleAsked>& roles) {
    return etagOf(server.client().Get(summaryPath(roles)));
}

json documentOf(const httplib::Response& response) {
    return json::parse(response.body, nullptr, false);
}

std::set<std::string> publishedKeys(const std::string& schema) {
    const auto required = publishedRequired(schema);
    return {required.begin(), required.end()};
}

}  // namespace

TEST_CASE("a summary is the document computed from the held snapshot under the roles asked for") {
    const int64_t now = localNoon(kSummaryDate);
    Library library;
    const LibraryRoutesServer server(&library, now);
    declareAndBuild(server, library);

    const auto response = server.client().Get(summaryPath(everyRole()));
    REQUIRE(response);
    REQUIRE(response->status == 200);
    CHECK(response->get_header_value("Content-Type") == "application/json");
    CHECK(response->get_header_value("Cache-Control") == "private, no-cache");

    // If-None-Match is a comma-separated list, so a comma inside a validator splits it in two.
    const auto tag = response->get_header_value("ETag");
    CHECK_FALSE(tag.empty());
    CHECK(tag.find(',') == std::string::npos);

    const auto document = documentOf(*response);
    CHECK(keysOf(document) == publishedKeys("LibrarySummary"));
    CHECK(document.at("structure") == library.state().structure);
    CHECK(document.at("revision") == library.state().revision);
    CHECK(document == expectedSummary(library, everyRole(), now, kSummaryDate));
}

TEST_CASE("a role left out of the request reads as unresolved on every track") {
    const int64_t now = localNoon(kSummaryDate);
    Library library;
    const LibraryRoutesServer server(&library, now);
    declareAndBuild(server, library);

    const auto noPlayCounts = everyRoleBut({"playCount", "playCountLocal"});
    const auto response = server.client().Get(summaryPath(noPlayCounts));
    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto document = documentOf(*response);
    CHECK(document == expectedSummary(library, noPlayCounts, now, kSummaryDate));

    REQUIRE_FALSE(expectedSummary(library, everyRole(), now, kSummaryDate).at("topTracks").empty());
    CHECK(document.at("topTracks").empty());
}

TEST_CASE("a role naming another declared column is answered from that column under another ETag") {
    const int64_t now = localNoon(kSummaryDate);
    Library library;
    const LibraryRoutesServer server(&library, now);
    declareAndBuild(server, library);

    const auto usual = etagAt(server, everyRole());

    const auto spare = everyRoleWith({"playCount", kSpareExpression});
    const auto response = server.client().Get(summaryPath(spare));
    CHECK(etagOf(response) != usual);
    CHECK(documentOf(*response) == expectedSummary(library, spare, now, kSummaryDate));
}

TEST_CASE("a summary asked for again with its ETag is answered 304 with no body") {
    Library library;
    const LibraryRoutesServer server(&library, localNoon(kSummaryDate));
    declareAndBuild(server, library);

    const auto tag = etagAt(server, everyRole());

    const auto again = getHolding(server, summaryPath(everyRole()), tag);
    REQUIRE(again);
    CHECK(again->status == 304);
    CHECK(again->body.empty());
}

TEST_CASE("requests at one pair, local date and role set share an ETag and one computation") {
    const int64_t now = localNoon(kSummaryDate);
    Library library;
    LibraryRoutesServer server(&library, now);
    declareAndBuild(server, library);

    const auto first = etagAt(server, everyRole());
    CHECK(etagAt(server, everyRole()) == first);
    CHECK(server.summaryComputations() == 1);

    server.setNow(now + kHourMs);
    CHECK(etagAt(server, everyRole()) == first);
    CHECK(server.summaryComputations() == 1);

    const auto held = getHolding(server, summaryPath(everyRole()), first);
    REQUIRE(held);
    CHECK(held->status == 304);
    CHECK(server.summaryComputations() == 1);
}

TEST_CASE("a moved pair, a new local date and another role set each compute a new document") {
    const int64_t now = localNoon(kSummaryDate);
    Library library;
    LibraryRoutesServer server(&library, now);
    declareAndBuild(server, library);

    const auto built = etagAt(server, everyRole());
    REQUIRE(server.summaryComputations() == 1);

    const uint64_t played = library.apply({summaryTrackPlayed(0, 40)});
    REQUIRE(played == library.state().revision);
    const auto afterPlay = server.client().Get(summaryPath(everyRole()));
    const auto playedTag = etagOf(afterPlay);
    CHECK(playedTag != built);
    CHECK(documentOf(*afterPlay).at("revision") == played);
    CHECK(server.summaryComputations() == 2);

    const auto stale = getHolding(server, summaryPath(everyRole()), built);
    REQUIRE(stale);
    CHECK(stale->status == 200);

    server.setNow(now + kNextDayMs);
    const auto nextDay = etagAt(server, everyRole());
    CHECK(nextDay != playedTag);
    CHECK(server.summaryComputations() == 3);

    const auto noGenre = etagAt(server, everyRoleBut({"genre"}));
    CHECK(noGenre != nextDay);
    CHECK(server.summaryComputations() == 4);
}

TEST_CASE("two requests arriving together for a document not yet held compute it once") {
    Library library;
    LibraryRoutesServer server(&library, localNoon(kSummaryDate));
    declareAndBuild(server, library);
    REQUIRE(server.summaryComputations() == 0);

    server.holdTogether(2);
    httplib::Result answers[2];
    std::thread first(
        [&server, &answers] { answers[0] = server.client().Get(summaryPath(everyRole())); });
    std::thread second(
        [&server, &answers] { answers[1] = server.client().Get(summaryPath(everyRole())); });
    first.join();
    second.join();

    const auto firstTag = etagOf(answers[0]);
    const auto secondTag = etagOf(answers[1]);
    CHECK(firstTag == secondTag);
    CHECK(answers[0]->body == answers[1]->body);
    CHECK(server.summaryComputations() == 1);

    etagAt(server, everyRole());
    CHECK(server.summaryComputations() == 1);
}

TEST_CASE("documents for two role sets asked for in turn are each computed once") {
    Library library;
    const LibraryRoutesServer server(&library, localNoon(kSummaryDate));
    declareAndBuild(server, library);

    const auto& whole = everyRole();
    const auto partial = everyRoleBut({"rating"});
    const auto wholeTag = etagAt(server, whole);
    const auto partialTag = etagAt(server, partial);
    CHECK(etagAt(server, whole) == wholeTag);
    CHECK(etagAt(server, partial) == partialTag);

    CHECK(server.summaryComputations() == 2);
}

// cpp-httplib's client unwraps gzip itself, so the wire is read with that turned off.
TEST_CASE(
    "a summary is gzipped where offered, varies on the encoding and is computed once for both") {
    Library library;
    const LibraryRoutesServer server(&library, localNoon(kSummaryDate));
    declareAndBuild(server, library);

    auto client = server.client();
    client.set_decompress(false);
    const auto packed = client.Get(summaryPath(everyRole()), accepting("gzip"));
    const auto plain = client.Get(summaryPath(everyRole()), accepting("identity"));

    const auto packedTag = etagOf(packed);
    CHECK(packed->get_header_value("Content-Encoding") == "gzip");
    CHECK(isGzip(packed->body));
    CHECK(packed->get_header_value("Vary").find("Accept-Encoding") != std::string::npos);

    const auto plainTag = etagOf(plain);
    CHECK(plain->get_header_value("Content-Encoding").empty());
    CHECK(documentOf(*plain).is_object());

    CHECK(packedTag != plainTag);
    CHECK(server.summaryComputations() == 1);
}

TEST_CASE("a role that is unknown, empty, unprintable or named twice is refused with a 400") {
    Library library;
    const LibraryRoutesServer server(&library, localNoon(kSummaryDate));
    declareAndBuild(server, library);
    const int refreshesBefore = server.refreshes();

    struct Refused {
        const char* what;
        std::string query;
        const char* error;
    };
    const std::vector<Refused> refused{
        {"a name that is no role", "colour=%25title%25", "unacceptable role"},
        {"no role beside a good one", "title=%25title%25&colour=%25title%25", "unacceptable role"},
        {"an empty expression", "album=", "unacceptable role"},
        {"an expression carrying a control character", "album=%25al%01bum%25", "unacceptable role"},
        // cpp-httplib drops a query pair repeating an earlier one byte for byte, so the two name
        // different expressions.
        {"a role named twice", "album=%25album%25&album=%25artist%25", "duplicate role"},
    };

    for (const auto& request : refused) {
        INFO("refused: ", request.what);
        const auto response = server.client().Get("/api/library/summary?" + request.query);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == request.error);
        const auto body = documentOf(*response);
        CHECK((body.contains("detail") && body.at("detail").is_string()));
    }

    CHECK(server.summaryComputations() == 0);
    CHECK(server.refreshes() == refreshesBefore);
}

TEST_CASE("without the media library a summary is a 503, after the roles are judged") {
    const LibraryRoutesServer server(nullptr, localNoon(kSummaryDate));

    const auto refused = server.client().Get("/api/library/summary?colour=%25title%25");
    REQUIRE(refused);
    CHECK(refused->status == 400);

    const auto unavailable = server.client().Get(summaryPath(everyRole()));
    REQUIRE(unavailable);
    CHECK(unavailable->status == 503);
    CHECK(errorOf(*unavailable) == kNoLibrary);
    CHECK(server.refreshes() == 0);
}

TEST_CASE("with no snapshot ready a summary answers the library document and starts no build") {
    const Library library;
    const LibraryRoutesServer server(&library, localNoon(kSummaryDate));
    const auto declared = server.client().Get(exportPath(summaryColumns()));
    REQUIRE(declared);
    REQUIRE(declared->status == 202);
    const int refreshesBefore = server.refreshes();

    const auto response = server.client().Get(summaryPath(everyRole()));
    REQUIRE(response);
    CHECK(response->status == 202);

    const auto document = documentOf(*response);
    CHECK(keysOf(document) == Keys{"ready", "structure", "revision", "snapshotId", "trackCount",
                                   "columns", "build", "halted"});
    CHECK(document.at("ready") == false);

    CHECK(server.refreshes() == refreshesBefore);
    CHECK(server.summaryComputations() == 0);
}

TEST_CASE(
    "a role naming a declared column the ready snapshot lacks is a 202 that starts no build") {
    Library library;
    const LibraryRoutesServer server(&library, localNoon(kSummaryDate));
    declareAndBuild(server, library);

    constexpr char kMood[] = "%mood%";
    auto wider = summaryColumns();
    wider.emplace_back(kMood);
    const auto declared = server.client().Get(exportPath(wider));
    REQUIRE(declared);
    REQUIRE(declared->status == 202);
    const int refreshesBefore = server.refreshes();

    const auto response = server.client().Get(summaryPath(everyRoleWith({"genre", kMood})));
    REQUIRE(response);
    CHECK(response->status == 202);

    const auto document = documentOf(*response);
    CHECK(document.at("ready") == true);
    CHECK(document.at("structure") == library.state().structure);

    CHECK(server.refreshes() == refreshesBefore);
    CHECK(server.summaryComputations() == 0);
}

TEST_CASE("a role naming a column the declaration does not hold is a 409 naming it") {
    Library library;
    const LibraryRoutesServer server(&library, localNoon(kSummaryDate));
    declareAndBuild(server, library);
    const int refreshesBefore = server.refreshes();

    const auto response = server.client().Get(summaryPath(everyRoleWith({"genre", "%comment%"})));
    REQUIRE(response);
    CHECK(response->status == 409);
    CHECK(errorOf(*response) == "'%comment%' is not a declared column");

    CHECK(server.refreshes() == refreshesBefore);
    CHECK(server.summaryComputations() == 0);
}

TEST_CASE("a library too large to export is still summarised") {
    const int64_t now = localNoon(kSummaryDate);
    constexpr size_t kTinyCeiling = 64;
    Library library(kRetainedRevisions, kTinyCeiling);
    const LibraryRoutesServer server(&library, now);
    declareAndBuild(server, library);

    const auto exported = server.client().Get(exportPath(summaryColumns()));
    REQUIRE(exported);
    REQUIRE(exported->status == 413);

    const auto response = server.client().Get(summaryPath(everyRole()));
    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(documentOf(*response) == expectedSummary(library, everyRole(), now, kSummaryDate));
}
