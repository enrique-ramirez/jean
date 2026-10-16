#include "third_party/doctest.h"

#include "core/library.h"
#include "support/fixtures.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <string>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kDeclared[] = "/api/library/export?columns=%25title%25&columns=%25artist%25";

json refusalOf(const TestServer& server, const std::string& path) {
    const auto response = get(server, path);
    REQUIRE(response);
    CHECK(response->status == 400);
    return json::parse(response->body);
}

Snapshot declaringTitleAndArtist() {
    return snapshotOf({"%title%", "%artist%"}, {{"a/", "1.mp3", "0", "One", "Someone"}});
}

}  // namespace

// cpp-httplib drops a query pair whose raw text repeats an earlier one before the component reads
// the query, so the second `only=%title%` never arrives and the undeclared column is the second.
TEST_CASE(
    "a part naming a column twice in one spelling and then an undeclared one is refused for "
    "the undeclared one, counted without the repeat") {
    Library library;
    library.replace(declaringTitleAndArtist());
    const TestServer server(servingSettings(), Player{}, &library);

    CHECK(refusalOf(server, std::string(kDeclared) +
                                "&only=%25title%25&only=%25title%25&only=%25genre%25") ==
          json{{"error", "column not declared"},
               {"detail", "'only' column 1 is not one of 'columns'"}});
}

TEST_CASE("a spine flag other than true or false is refused as an unacceptable spine") {
    Library library;
    library.replace(declaringTitleAndArtist());
    const TestServer server(servingSettings(), Player{}, &library);

    for (const char* flag : {"maybe", "1", "TRUE", ""}) {
        INFO("spine=", flag);
        CHECK(refusalOf(server, std::string(kDeclared) + "&spine=" + flag) ==
              json{{"error", "unacceptable spine"}, {"detail", "'spine' must be true or false"}});
    }

    CHECK(refusalOf(server, std::string(kDeclared) + "&only=%25genre%25&spine=maybe") ==
          json{{"error", "column not declared"},
               {"detail", "'only' column 0 is not one of 'columns'"}});
}
