// A client holds windows of the media library and declares its columns through
// POST /api/library/rows, so neither the whole library nor a patch of it is a
// route.

#include "third_party/doctest.h"

#include "core/library.h"
#include "core/player.h"
#include "support/fixtures.h"
#include "support/test_server.h"

#include <atomic>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;

namespace {

Player countingBuilds(std::atomic<int>* builds) {
    Player player;
    player.library.refresh = [builds](const std::vector<std::string>&, RebuildReason) {
        ++*builds;
    };
    return player;
}

}  // namespace

TEST_CASE(
    "the whole library and a patch of it are answered as a path no route "
    "serves") {
    std::atomic<int> builds{0};
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), countingBuilds(&builds), &library);

    const auto state = library.state();
    const auto pair =
        "structure=" + std::to_string(state.structure) + "&since=" + std::to_string(state.revision);

    const auto unrouted = get(server, "/api/no-route-is-published-here");
    REQUIRE(unrouted);
    REQUIRE(unrouted->status == 404);

    // The genre was never built, so a route that still declared would start a
    // build for it.
    const std::vector<std::string> gone{
        "/api/library/export?columns=%25title%25", "/api/library/export?columns=%25genre%25",
        "/api/library/export", "/api/library/changes?" + pair, "/api/library/changes"};
    for (const auto& path : gone) {
        INFO("path: ", path);
        const auto answer = get(server, path);
        REQUIRE(answer);
        CHECK(answer->status == 404);
        CHECK(answer->body == unrouted->body);
    }

    CHECK(builds == 0);
}
