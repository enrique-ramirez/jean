// The media library routes over a real socket. library_test.cpp covers the snapshot, the
// deltas and the wire format; what these add is which status a client sees, that a refused
// request never reaches the snapshot or the player, and that a re-poll costs nothing.

#include "third_party/doctest.h"

#include "core/http_server.h"
#include "core/library.h"
#include "support/spec.h"
#include "support/test_server.h"
#include "support/wire.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <iterator>
#include <map>
#include <set>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kTitle[] = "%title%";
constexpr char kPlays[] = "%play_count%";

// The declaration the fixture library is built from, percent-encoded as a client sends it.
constexpr char kExport[] = "/api/library/export?columns=%25title%25&columns=%25play_count%25";

TestServer serving(Library* library, const Player& player = {}) {
    return TestServer(servingSettings(), player, library);
}

httplib::Result getHolding(const TestServer& server, const std::string& path,
                           const std::string& tag) {
    auto headers = TestServer::bearer();
    headers.emplace("If-None-Match", tag);
    return server.client().Get(path, headers);
}

httplib::Result refresh(const TestServer& server) {
    return post(server, "/api/library/refresh", "");
}

// Three tracks and two columns, so a delta can move one column and leave the other alone,
// which is the case the per-column format exists for. The third track's play count is the
// unresolved sentinel, which is what capability detection reads.
void fill(Library& library) {
    LibraryBuilder builder({kTitle, kPlays}, 3);
    auto& sink = builder.sink();
    sink.row(0, {"Artist/Album/", "01.flac", "0", "One", "4"});
    sink.row(1, {"Artist/Album/", "02.flac", "0", "Two", "0"});
    sink.row(2, {"Artist/Other/", "03.flac", "0", "Three", "?"});

    library.replace(builder.finish());
}

void fillPastTheCap(Library& library) {
    constexpr size_t kValueBytes = size_t{1024} * 1024;
    const size_t rows = (kMaxLibraryBytes / kValueBytes) + 4;

    LibraryBuilder builder({kTitle}, rows);
    auto& sink = builder.sink();
    for (size_t index = 0; index < rows; ++index) {
        const auto ordinal = std::to_string(index);
        sink.row(index, {"Artist/Album/", ordinal + ".flac", "0",
                         ordinal + std::string(kValueBytes, 'x')});
    }

    library.replace(builder.finish());
}

uint64_t playOne(Library& library, const std::string& count) {
    return library.apply({{0, {"Artist/Album/", "01.flac", "0", "One", count}}});
}

// cpp-httplib emits one field line per set_header, and applyCors has already put Origin in one
// of them, so the header a cache reads as a list arrives here as two entries.
bool variesOnEncoding(const httplib::Response& response) {
    for (size_t at = 0; at < response.get_header_value_count("Vary"); ++at) {
        if (response.get_header_value("Vary", "", at) == "Accept-Encoding")
            return true;
    }

    return false;
}

struct BuildLog {
    int calls = 0;
    std::vector<std::string> columns;
    std::vector<RebuildReason> reasons;
};

Player building(BuildLog* log) {
    Player player;
    player.refreshLibrary = [log](std::vector<std::string> columns, RebuildReason why) {
        log->calls++;
        log->columns = std::move(columns);
        log->reasons.push_back(why);
    };
    return player;
}

}  // namespace

TEST_CASE("the poll document carries both generations and the set that is ready") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/library");

    REQUIRE(response);
    CHECK(response->status == 200);

    const auto body = json::parse(response->body);
    CHECK(body["ready"] == true);
    CHECK(body["structure"] == 1);
    CHECK(body["revision"] == 1);
    CHECK(body["trackCount"] == 3);
    CHECK(body["columns"] == json::array({kTitle, kPlays}));
}

// The spine is the component's own rather than something a client declared, so naming it in
// `columns` would make a client send it back and be told it had asked for a different set.
TEST_CASE("the poll document does not report the spine as a column") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/library");

    REQUIRE(response);
    const auto columns = json::parse(response->body)["columns"];
    CHECK(std::find(columns.begin(), columns.end(), "directory") == columns.end());
}

TEST_CASE("a client that already holds a representation is answered without one") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    for (const char* path : {"/api/library", kExport}) {
        INFO("path: ", path);

        const auto first = get(server, path);
        REQUIRE(first);
        REQUIRE(first->status == 200);

        const auto tag = first->get_header_value("ETag");
        REQUIRE_FALSE(tag.empty());

        const auto again = getHolding(server, path, tag);
        REQUIRE(again);
        CHECK(again->status == 304);
        CHECK(again->body.empty());
        CHECK(again->get_header_value("ETag") == tag);
    }
}

TEST_CASE("a wildcard validator is honoured, as RFC 9110 requires") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = getHolding(server, "/api/library", "*");

    REQUIRE(response);
    CHECK(response->status == 304);
}

// The tag names the generations rather than the bytes, so anything that moves either of them
// has to invalidate it or a client keeps a stale library indefinitely.
TEST_CASE("a revision moving invalidates what a client was holding") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto first = get(server, kExport);
    REQUIRE(first);
    const auto tag = first->get_header_value("ETag");

    playOne(library, "5");

    const auto again = getHolding(server, kExport, tag);
    REQUIRE(again);
    CHECK(again->status == 200);
    CHECK(again->get_header_value("ETag") != tag);
}

TEST_CASE("the export is the snapshot, framed as contract/openapi.yaml describes it") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, kExport);

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Type") == "application/octet-stream");
    CHECK(response->get_header_value("Cache-Control") == "no-cache, must-revalidate");

    const auto header = decode(response->body).header;
    CHECK(header["kind"] == "snapshot");
    CHECK(header["trackCount"] == 3);
    CHECK(columnNames(header) == std::vector<std::string>{kTitle, kPlays});
    CHECK(header["spine"]["directory"]["distinct"] == 2);
    CHECK(header["columns"][1]["hasUnresolved"] == true);
}

TEST_CASE("both binary routes are gzipped for a client that offers it") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto from = playOne(library, "5") - 1;

    for (const std::string& path :
         {std::string(kExport), "/api/library/changes?since=" + std::to_string(from)}) {
        INFO("path: ", path);

        const auto packed = undecoding(server).Get(path, accepting("gzip"));
        const auto plain = undecoding(server).Get(path, accepting("identity"));

        REQUIRE(packed);
        REQUIRE(plain);
        CHECK(packed->status == 200);
        CHECK(packed->get_header_value("Content-Encoding") == "gzip");
        CHECK(isGzip(packed->body));
        CHECK(packed->body.size() < plain->body.size());
    }
}

TEST_CASE("a client that does not offer gzip is sent the frame as it stands") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    for (const char* offer : {"identity", "", "deflate, br"}) {
        INFO("Accept-Encoding: ", offer);

        const auto response = undecoding(server).Get(kExport, accepting(offer));

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(response->get_header_value("Content-Encoding").empty());
        CHECK_FALSE(isGzip(response->body));
        CHECK(decode(response->body).header["kind"] == "snapshot");
    }
}

TEST_CASE("gzip offered with a weight of zero is a refusal rather than a preference") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto refused = undecoding(server).Get(kExport, accepting("gzip;q=0, identity"));
    REQUIRE(refused);
    CHECK(refused->get_header_value("Content-Encoding").empty());

    const auto ranked = undecoding(server).Get(kExport, accepting("gzip;q=0.5, identity;q=0.1"));
    REQUIRE(ranked);
    CHECK(ranked->get_header_value("Content-Encoding") == "gzip");
}

// One gunzip, not two: this is what pins cpp-httplib's refusal to compress a response whose
// handler already set Content-Encoding, which an upgrade could take away.
TEST_CASE("the gzipped snapshot decodes to exactly the bytes the plain one carried") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto plain = undecoding(server).Get(kExport, accepting("identity"));
    const auto decoded = server.client().Get(kExport, accepting("gzip"));

    REQUIRE(plain);
    REQUIRE(decoded);
    REQUIRE(decoded->get_header_value("Content-Encoding") == "gzip");
    CHECK(decoded->body == plain->body);
    CHECK(decode(decoded->body).header["kind"] == "snapshot");
}

TEST_CASE("each coding gets its own validator, and every answer says the body depends on it") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    for (const char* path : {"/api/library", kExport}) {
        INFO("path: ", path);

        const auto packed = undecoding(server).Get(path, accepting("gzip"));
        const auto plain = undecoding(server).Get(path, accepting("identity"));

        REQUIRE(packed);
        REQUIRE(plain);
        CHECK_FALSE(packed->get_header_value("ETag").empty());
        CHECK(packed->get_header_value("ETag") != plain->get_header_value("ETag"));
        CHECK(variesOnEncoding(*packed));
        CHECK(variesOnEncoding(*plain));

        auto crossed = accepting("gzip");
        crossed.emplace("If-None-Match", plain->get_header_value("ETag"));

        const auto answered = undecoding(server).Get(path, crossed);
        REQUIRE(answered);
        CHECK(answered->status == 200);
        CHECK(answered->get_header_value("Content-Encoding") == "gzip");
    }
}

// kMaxLibraryBytes bounds what the component serialised and what a client has to hold once it
// has decoded, so a body that gzips to a few kilobytes is refused all the same.
TEST_CASE("the size cap is on the serialised snapshot rather than on what goes over the wire") {
    Library library;
    fillPastTheCap(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/library/export?columns=%25title%25");

    REQUIRE(response);
    CHECK(response->status == 413);
    CHECK(json::parse(response->body)["error"] ==
          "the library snapshot is larger than this component sends");
    CHECK(response->get_header_value("ETag").empty());
}

// Order decides where a column lands in the snapshot's array and nothing else, so two
// requests that differ only in it are the same declaration.
TEST_CASE("the order columns are named in does not make a different declaration") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));

    const auto response =
        get(server, "/api/library/export?columns=%25play_count%25&columns=%25title%25");

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(log.calls == 0);
}

// The export request is the declaration, so a set nobody has built yet is not a refusal: it
// is a wait, and the client is told what is ready so it knows what to poll for.
TEST_CASE("asking for a set that is not ready starts building exactly that set") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));

    const auto response = get(server, "/api/library/export?columns=%25genre%25");

    REQUIRE(response);
    CHECK(response->status == 202);
    CHECK(log.calls == 1);
    CHECK(log.columns == std::vector<std::string>{"%genre%"});

    const auto body = json::parse(response->body);
    CHECK(body["ready"] == true);
    CHECK(body["columns"] == json::array({kTitle, kPlays}));
}

// Otherwise a client polling by re-asking would start a rebuild per attempt, and a library
// walk is the most expensive thing this component can be asked for.
TEST_CASE("asking again for a set already building does not start a second build") {
    BuildLog log;
    Library library;
    const TestServer server = serving(&library, building(&log));

    for (int attempt = 0; attempt < 4; ++attempt) {
        const auto response = get(server, "/api/library/export?columns=%25genre%25");
        REQUIRE(response);
        CHECK(response->status == 202);
    }

    CHECK(log.calls == 1);
}

TEST_CASE("a 202 the player cannot honour is not made") {
    Library library;
    const TestServer server = serving(&library);

    const auto response = get(server, kExport);

    REQUIRE(response);
    CHECK(response->status == 503);
    CHECK(json::parse(response->body)["error"] == "the media library is not available");
}

TEST_CASE("an export must say what it wants") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/library/export");

    REQUIRE(response);
    CHECK(response->status == 400);

    const auto body = json::parse(response->body);
    CHECK(body["error"] == "unacceptable column");
    CHECK(body["detail"] == "'columns' is required");
}

// CONTRIBUTING.md, *Security rules*: refuse before doing. An install with the feature switched
// off answers 503, so a malformed request answered 400 there is the proof that validation ran
// before anything looked at a snapshot.
TEST_CASE("a malformed request is refused before the snapshot is consulted") {
    const TestServer off = serving(nullptr);

    const auto overlong =
        get(off, "/api/library/export?columns=" + std::string(kMaxColumnLength + 1, 'x'));
    REQUIRE(overlong);
    CHECK(overlong->status == 400);
    CHECK(json::parse(overlong->body)["error"] == "unacceptable column");

    const auto notANumber = get(off, "/api/library/changes?since=soon");
    REQUIRE(notANumber);
    CHECK(notANumber->status == 400);
    CHECK(json::parse(notANumber->body)["error"] == "unacceptable revision");
}

// cpp-httplib drops a query pair whose raw text exactly repeats an earlier one, so the same
// column sent twice never reaches the component at all. Two spellings of one column do, and
// that is the case the refusal exists for.
TEST_CASE("one column named twice is refused, however it was spelled") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));

    auto raw = server.client();
    raw.set_path_encode(false);

    const auto spelled = raw.Get("/api/library/export?columns=a&columns=%61", TestServer::bearer());
    REQUIRE(spelled);
    CHECK(spelled->status == 400);
    CHECK(json::parse(spelled->body)["error"] == "duplicate column");
    CHECK(log.calls == 0);

    const auto collapsed = get(server, "/api/library/export?columns=a&columns=a");
    REQUIRE(collapsed);
    CHECK(collapsed->status == 202);
    CHECK(log.columns == std::vector<std::string>{"a"});
}

TEST_CASE("a delta names the columns that moved and no others") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto from = playOne(library, "5") - 1;

    const auto response = get(server, "/api/library/changes?since=" + std::to_string(from));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Type") == "application/octet-stream");

    const auto header = decode(response->body).header;
    CHECK(header["kind"] == "delta");
    CHECK(header["since"] == from);
    CHECK(columnNames(header) == std::vector<std::string>{kPlays});
    CHECK(header["spine"].empty());
    CHECK(header["columns"][0]["ordinals"]["count"] == 1);
}

TEST_CASE("a delta must say what it is catching up from") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/library/changes");

    REQUIRE(response);
    CHECK(response->status == 400);

    const auto body = json::parse(response->body);
    CHECK(body["error"] == "unacceptable revision");
    CHECK(body["detail"] == "'since' is required");
}

// A rebuild with a different set moves `structure`, so a client holding the wrong one reaches
// this rather than a refusal of its own. Its next move is the same either way: export.
TEST_CASE("a client whose ordinals have shifted is told to export rather than patched") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/library/changes?since=0");

    REQUIRE(response);
    CHECK(response->status == 409);
    CHECK(json::parse(response->body)["error"] ==
          "tracks were added or removed; export the library again");
}

TEST_CASE("a client too far behind to be patched is told so, and so is one from the future") {
    Library library(1);
    fill(library);
    const TestServer server = serving(&library);

    playOne(library, "5");
    const auto current = playOne(library, "6");

    const auto behind = get(server, "/api/library/changes?since=1");
    REQUIRE(behind);
    CHECK(behind->status == 410);
    CHECK(json::parse(behind->body)["error"] ==
          "that revision is older than the retained window; export the library again");

    const auto ahead = get(server, "/api/library/changes?since=" + std::to_string(current + 1));
    REQUIRE(ahead);
    CHECK(ahead->status == 410);
    CHECK(json::parse(ahead->body)["error"] == "no such revision");
}

TEST_CASE("an install with the library switched off says so on every route") {
    const TestServer off = serving(nullptr);

    const auto unavailable = [](const httplib::Result& answer) {
        REQUIRE(answer);
        CHECK(answer->status == 503);
        CHECK(json::parse(answer->body)["error"] == "the media library is not available");
    };

    unavailable(get(off, "/api/library"));
    unavailable(get(off, kExport));
    unavailable(get(off, "/api/library/changes?since=1"));
    unavailable(refresh(off));
}

// The one state where the routes disagree on purpose: a client declares at the export route
// and waits at GET /library, and there is nothing yet for a delta to be a delta against.
TEST_CASE("a library that has not been built yet is a wait rather than an absence") {
    BuildLog log;
    Library library;
    const TestServer server = serving(&library, building(&log));

    const auto polled = get(server, "/api/library");
    REQUIRE(polled);
    CHECK(polled->status == 200);
    CHECK(json::parse(polled->body)["ready"] == false);
    CHECK(json::parse(polled->body)["structure"] == 0);

    const auto exported = get(server, kExport);
    REQUIRE(exported);
    CHECK(exported->status == 202);
    CHECK(log.columns == std::vector<std::string>{kTitle, kPlays});

    const auto patched = get(server, "/api/library/changes?since=1");
    REQUIRE(patched);
    CHECK(patched->status == 503);
    CHECK(json::parse(patched->body)["error"] == "the library snapshot has not been built yet");
}

TEST_CASE("a refresh reproduces the set a client last declared, as a change in the data") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));

    REQUIRE(get(server, "/api/library/export?columns=%25genre%25"));

    const auto response = refresh(server);

    REQUIRE(response);
    CHECK(response->status == 202);
    CHECK(log.calls == 2);
    CHECK(log.columns == std::vector<std::string>{"%genre%"});
    CHECK(log.reasons.front() == RebuildReason::columnsDeclared);
    CHECK(log.reasons.back() == RebuildReason::dataChanged);
    CHECK(json::parse(response->body)["structure"] == 1);
}

// Otherwise a refresh from a client that has not exported yet would replace a good snapshot
// with one built from nothing.
TEST_CASE("a refresh before anything is declared rebuilds what is already there") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));

    REQUIRE(refresh(server));

    CHECK(log.columns == std::vector<std::string>{kTitle, kPlays});
}

TEST_CASE("a refresh the player cannot make is refused rather than pretended") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = refresh(server);

    REQUIRE(response);
    CHECK(response->status == 503);
}

// Rule 5 of CONTRIBUTING.md, *Tests*: answering 429 and not walking the player's whole library
// are different promises, and only the second is the feature.
TEST_CASE("a client looping on refresh stops reaching the player") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));

    constexpr int kAttempts = 8;
    int refused = 0;

    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        const auto response = refresh(server);
        REQUIRE(response);

        if (response->status == 429) {
            refused++;
            CHECK(response->get_header_value("Retry-After") == "30");
            CHECK(json::parse(response->body)["error"] == "too many library refreshes");
        }
    }

    CHECK(refused > 0);
    CHECK(log.calls == kAttempts - refused);
}

// Varying the set declared is the other way to ask for repeated library walks, and it spends
// the same bucket the refresh route does rather than a second one.
TEST_CASE("a client varying the set it declares stops reaching the player too") {
    BuildLog log;
    Library library;
    const TestServer server = serving(&library, building(&log));

    constexpr int kAttempts = 8;
    int refused = 0;

    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        const auto response =
            get(server, "/api/library/export?columns=%25genre" + std::to_string(attempt) + "%25");
        REQUIRE(response);

        if (response->status == 429)
            refused++;
    }

    CHECK(refused > 0);
    CHECK(log.calls == kAttempts - refused);
}

TEST_CASE("no library route answers without a token") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto rejected = [](const httplib::Result& answer) {
        REQUIRE(answer);
        CHECK(answer->status == 401);
    };

    rejected(server.client().Get("/api/library"));
    rejected(server.client().Get(kExport));
    rejected(server.client().Get("/api/library/changes?since=1"));
    rejected(server.client().Post("/api/library/refresh", "", "application/json"));
}

TEST_CASE("the library is reported as a capability rather than discovered by a 503") {
    Library library;
    const TestServer on = serving(&library);
    const TestServer off = serving(nullptr);

    const auto reported = [](const TestServer& server) {
        const auto response = get(server, "/api/capabilities");
        REQUIRE(response);
        return json::parse(response->body)["canReadLibrary"].get<bool>();
    };

    CHECK(reported(on) == true);
    CHECK(reported(off) == false);
}

// The same comparison api_contract_test.cpp makes for the stream routes: every refusal these
// routes can make is driven, and the answer compared with what the specification publishes.
TEST_CASE("no library route answers a status contract/openapi.yaml does not document") {
    INFO("shape changed -- update contract/openapi.yaml to match");

    BuildLog log;
    Library library(1);
    const TestServer server = serving(&library, building(&log));
    const TestServer off = serving(nullptr);

    std::map<std::string, std::set<int>> seen;
    const auto note = [&seen](const std::string& route, const httplib::Result& response) {
        REQUIRE_MESSAGE(response, "no answer from ", route);
        seen[route].insert(response->status);
    };

    note("GET /library", get(server, "/api/library"));
    note("GET /library", server.client().Get("/api/library"));
    note("GET /library", get(off, "/api/library"));

    note("GET /library/export", get(off, kExport));
    note("GET /library/export", get(server, "/api/library/export"));
    note("GET /library/export", get(server, kExport));
    note("GET /library/changes", get(server, "/api/library/changes?since=1"));

    fill(library);
    playOne(library, "5");
    playOne(library, "6");

    const auto exported = get(server, kExport);
    note("GET /library/export", exported);
    REQUIRE(exported);
    note("GET /library/export", getHolding(server, kExport, exported->get_header_value("ETag")));
    note("GET /library/export", server.client().Get(kExport));

    const auto delta = get(server, "/api/library/changes?since=2");
    note("GET /library/changes", delta);
    REQUIRE(delta);
    note("GET /library/changes",
         getHolding(server, "/api/library/changes?since=2", delta->get_header_value("ETag")));
    note("GET /library/changes", server.client().Get("/api/library/changes?since=2"));
    note("GET /library/changes", get(server, "/api/library/changes"));
    note("GET /library/changes", get(server, "/api/library/changes?since=0"));
    note("GET /library/changes", get(server, "/api/library/changes?since=99"));
    note("GET /library/changes", get(off, "/api/library/changes?since=1"));

    note("POST /library/refresh", refresh(server));
    note("POST /library/refresh",
         server.client().Post("/api/library/refresh", "", "application/json"));
    note("POST /library/refresh", refresh(off));

    for (int attempt = 0; attempt < 8; ++attempt) {
        note("POST /library/refresh", refresh(server));
        note("GET /library/export",
             get(server, "/api/library/export?columns=%25genre" + std::to_string(attempt) + "%25"));
    }

    for (const auto& route : publishedRoutes()) {
        if (route.path.rfind("/library", 0) != 0)
            continue;

        const auto name = route.method + " " + route.path;
        INFO("route: ", name);

        REQUIRE_FALSE(seen[name].empty());

        std::set<int> undocumented;
        std::set_difference(seen[name].begin(), seen[name].end(), route.statuses.begin(),
                            route.statuses.end(), std::inserter(undocumented, undocumented.end()));

        CHECK(undocumented.empty());
    }
}
