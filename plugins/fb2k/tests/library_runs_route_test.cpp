#include "third_party/doctest.h"

#include "core/failures.h"
#include "core/library.h"
#include "core/library_roles.h"
#include "support/keys.h"
#include "support/library_routes_server.h"
#include "support/question_library.h"
#include "support/runs_cases.h"
#include "support/summary_library.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <latch>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr int64_t kNow = 0;

constexpr char kBasic[] = "basic: album with its artist";

json documentOf(const httplib::Response& response) {
    return json::parse(response.body, nullptr, false);
}

std::string etagOf(const httplib::Result& response) {
    REQUIRE(response);
    REQUIRE(response->status == 200);
    const auto tag = response->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());
    return tag;
}

bool variesOnEncoding(const httplib::Response& response) {
    for (size_t at = 0; at < response.get_header_value_count("Vary"); ++at) {
        if (response.get_header_value("Vary", "", at).find("Accept-Encoding") != std::string::npos)
            return true;
    }
    return false;
}

struct Served {
    RunsCase expected;
    Library library;
    LibraryRoutesServer server;

    explicit Served(const char* name = kBasic) : expected(runsCase(name)), server(&library, kNow) {
        declareAndBuild(server, library, expected.library);
    }

    std::string path() const { return runsPath(expected.library.roles); }

    httplib::Result ask() const { return server.client().Get(path()); }

    httplib::Result askHolding(const std::string& tag) const {
        return server.client().Get(path(), httplib::Headers{{"If-None-Match", tag}});
    }

    void change(uint32_t ordinal, const char* role, const std::string& value) {
        const RowChange changed = expected.library.changed(ordinal, role, value);
        expected.library.rows.at(ordinal) = changed.values;
        library.apply({changed});
    }
};

}  // namespace

TEST_CASE("the runs are answered at the pair the library holds, a length and a cover for each") {
    for (const char* name : {kBasic, "album-across-directories", "whitespace-only-tags"}) {
        INFO("case: ", name);
        Served served(name);
        served.change(0, "rating", "5");
        const auto state = served.library.state();
        REQUIRE(state.revision != state.structure);
        const int refreshesBefore = served.server.refreshes();

        const auto response = served.ask();
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(response->get_header_value("Content-Type") == "application/json");

        const auto document = documentOf(*response);
        CHECK(keysOf(document) == Keys{"structure", "revision", "lengths", "covers", "untagged"});
        CHECK(document.at("structure") == state.structure);
        CHECK(document.at("revision") == state.revision);
        CHECK(document.at("lengths") == json(served.expected.lengths));
        CHECK(document.at("covers") == json(served.expected.covers));
        CHECK(document.at("untagged") == json(served.expected.untagged));
        CHECK(served.server.refreshes() == refreshesBefore);
    }
}

TEST_CASE("runs are held by nobody but the client that asked, under a validator of their own") {
    const Served served;
    const auto response = served.ask();
    REQUIRE(response);
    REQUIRE(response->status == 200);
    CHECK(response->get_header_value("Cache-Control") == "private, no-cache");
    CHECK(etagOf(response).front() == '"');
}

TEST_CASE("runs are gzipped where offered, sent as they stand where not, and vary on it") {
    const Served served;
    auto client = served.server.client();
    client.set_decompress(false);

    const auto packed = client.Get(served.path(), accepting("gzip"));
    const auto plain = client.Get(served.path(), accepting("identity"));
    REQUIRE(packed);
    REQUIRE(plain);
    REQUIRE(packed->status == 200);
    REQUIRE(plain->status == 200);

    CHECK(packed->get_header_value("Content-Encoding") == "gzip");
    CHECK(isGzip(packed->body));
    CHECK(variesOnEncoding(*packed));

    CHECK(plain->get_header_value("Content-Encoding").empty());
    CHECK(documentOf(*plain).at("lengths") == json(served.expected.lengths));
    CHECK(variesOnEncoding(*plain));
}

TEST_CASE("runs asked for again with their ETag are answered 304 with no body") {
    const Served served;
    const auto tag = etagOf(served.ask());

    const auto again = served.askHolding(tag);
    REQUIRE(again);
    CHECK(again->status == 304);
    CHECK(again->body.empty());
}

// A play count moves about once per track played, and every one of them moves
// `revision`.
TEST_CASE("a revision that moves no run keeps the ETag, so a client holding it is answered 304") {
    Served served;
    const auto tag = etagOf(served.ask());
    const uint64_t revisionBefore = served.library.state().revision;

    served.change(0, "playCount", "7");
    served.change(9, "playCount", "3");
    const auto state = served.library.state();
    REQUIRE(state.revision != revisionBefore);

    const auto held = served.askHolding(tag);
    REQUIRE(held);
    CHECK(held->status == 304);
    CHECK(held->body.empty());

    const auto fresh = served.ask();
    CHECK(etagOf(fresh) == tag);
    CHECK(documentOf(*fresh).at("revision") == state.revision);
}

TEST_CASE("a cover moving in place moves the ETag and answers the cover it moved to") {
    Served served;
    const auto tag = etagOf(served.ask());

    served.change(0, "trackNumber", "09");

    const auto moved = served.askHolding(tag);
    REQUIRE(moved);
    CHECK(moved->status == 200);
    CHECK(etagOf(moved) != tag);
    const auto document = documentOf(*moved);
    CHECK(document.at("lengths") == json(served.expected.lengths));
    CHECK(document.at("covers").at(0) == 1);
}

TEST_CASE("an album tag given to loose tracks moves the ETag and answers them as tagged") {
    Served served("untagged");
    REQUIRE(served.expected.untagged == std::vector<uint32_t>{1});
    const auto tag = etagOf(served.ask());

    for (const uint32_t ordinal : {3U, 4U, 5U})
        served.change(ordinal, "album", "Found");

    const auto moved = served.askHolding(tag);
    REQUIRE(moved);
    CHECK(moved->status == 200);
    CHECK(etagOf(moved) != tag);
    const auto document = documentOf(*moved);
    CHECK(document.at("lengths") == json(served.expected.lengths));
    CHECK(document.at("covers") == json(served.expected.covers));
    CHECK(document.at("untagged") == json::array());
}

TEST_CASE("a run breaking in place moves the ETag and answers the new lengths") {
    Served served;
    const auto tag = etagOf(served.ask());

    served.change(2, "albumArtist", "Somebody Else");

    const auto moved = served.askHolding(tag);
    REQUIRE(moved);
    CHECK(moved->status == 200);
    CHECK(etagOf(moved) != tag);
    const auto lengths = documentOf(*moved).at("lengths");
    CHECK(lengths.at(0) == 2);
    CHECK(lengths.at(1) == 1);
}

TEST_CASE("an album added moves the ETag and answers the runs with it, at the new structure") {
    Served served;
    const auto tag = etagOf(served.ask());

    QuestionLibrary& questions = served.expected.library;
    std::vector<std::string> added = questions.rows.back();
    added.at(0) = "Radiohead/Kid A/";
    added.at(questions.columnOf("album")) = "Kid A";
    questions.rows.push_back(added);
    served.library.replace(questions.snapshot());
    const auto state = served.library.state();

    const auto moved = served.askHolding(tag);
    REQUIRE(moved);
    CHECK(moved->status == 200);
    CHECK(etagOf(moved) != tag);

    auto lengths = served.expected.lengths;
    lengths.push_back(1);
    auto covers = served.expected.covers;
    covers.push_back(static_cast<uint32_t>(questions.rows.size() - 1));
    const auto document = documentOf(*moved);
    CHECK(document.at("structure") == state.structure);
    CHECK(document.at("lengths") == json(lengths));
    CHECK(document.at("covers") == json(covers));
}

TEST_CASE("runs take every role the four questions take") {
    const Served served;
    const auto& carried = served.expected.library.roles;

    std::vector<RoleAsked> every;
    for (const std::string_view name : kAllRoleNames) {
        const auto held = std::find_if(carried.begin(), carried.end(),
                                       [name](const RoleAsked& role) { return role.name == name; });
        every.push_back({std::string(name), held != carried.end() ? held->expression : "%title%"});
    }

    const auto response = served.server.client().Get(runsPath(every));
    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(documentOf(*response).at("lengths") == json(served.expected.lengths));
}

TEST_CASE("a role that is unknown, empty, unprintable or named twice is refused with a 400") {
    const Served served;
    const int refreshesBefore = served.server.refreshes();

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
        {"a role named twice", "album=%25album%25&album=%25artist%25", "duplicate role"},
    };

    for (const auto& request : refused) {
        INFO("refused: ", request.what);
        const auto response = served.server.client().Get("/api/library/runs?" + request.query);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == request.error);
        const auto body = documentOf(*response);
        CHECK((body.contains("detail") && body.at("detail").is_string()));
    }

    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE("without the media library runs are a 503, after the roles are judged") {
    const LibraryRoutesServer server(nullptr, kNow);

    const auto refused = server.client().Get("/api/library/runs?colour=%25title%25");
    REQUIRE(refused);
    CHECK(refused->status == 400);

    const auto unavailable = server.client().Get(runsPath(runsCase(kBasic).library.roles));
    REQUIRE(unavailable);
    CHECK(unavailable->status == 503);
    CHECK(errorOf(*unavailable) == kNoLibrary);
    CHECK(server.refreshes() == 0);
}

TEST_CASE("with no snapshot ready runs answer the library document and start no build") {
    const QuestionLibrary questions = runsCase(kBasic).library;
    const Library library;
    const LibraryRoutesServer server(&library, kNow);
    const auto declared = declareThroughRows(server, questions.declared);
    REQUIRE(declared);
    REQUIRE(declared->status == 202);
    const int refreshesBefore = server.refreshes();

    const auto response = server.client().Get(runsPath(questions.roles));
    REQUIRE(response);
    CHECK(response->status == 202);
    CHECK(documentOf(*response).at("ready") == false);
    CHECK(server.refreshes() == refreshesBefore);
}

TEST_CASE(
    "a role naming a declared column the ready snapshot lacks is a 202 that starts no build") {
    Served served;

    constexpr char kMood[] = "%mood%";
    auto wider = served.expected.library.declared;
    wider.emplace_back(kMood);
    const auto declared = declareThroughRows(served.server, wider);
    REQUIRE(declared);
    REQUIRE(declared->status == 202);
    const int refreshesBefore = served.server.refreshes();

    auto roles = served.expected.library.roles;
    for (auto& role : roles) {
        if (role.name == "genre")
            role.expression = kMood;
    }
    const auto response = served.server.client().Get(runsPath(roles));
    REQUIRE(response);
    CHECK(response->status == 202);

    const auto document = documentOf(*response);
    CHECK(document.at("ready") == true);
    CHECK(document.at("structure") == served.library.state().structure);
    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE("a role naming a column the declaration does not hold is a 409 naming it") {
    const Served served;
    const int refreshesBefore = served.server.refreshes();

    auto roles = served.expected.library.roles;
    for (auto& role : roles) {
        if (role.name == "album")
            role.expression = "%comment%";
    }
    const auto response = served.server.client().Get(runsPath(roles));
    REQUIRE(response);
    CHECK(response->status == 409);
    CHECK(errorOf(*response) == "'%comment%' is not a declared column");
    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE("runs racing row changes answer the runs of the revision they carry") {
    constexpr size_t kReaders = 4;
    constexpr size_t kRoundsPerReader = 24;

    Served served;
    const RowChange retagged = served.expected.library.changed(2, "albumArtist", "Somebody Else");
    const RowChange restored = {2, served.expected.library.rows.at(2)};

    const auto runsNow = [&served] {
        const auto response = served.ask();
        REQUIRE(response);
        REQUIRE(response->status == 200);
        return documentOf(*response).at("lengths");
    };

    const uint64_t asBuilt = served.library.state().revision;
    const json untouched = runsNow();
    served.library.apply({retagged});
    const json moved = runsNow();
    served.library.apply({restored});
    REQUIRE(served.library.state().revision == asBuilt + 2);
    REQUIRE(untouched != moved);

    std::atomic<size_t> reading{kReaders};
    std::atomic<size_t> wrong{0};
    std::atomic<size_t> unanswered{0};
    std::atomic<size_t> toggles{0};
    std::latch start(kReaders + 1);

    std::thread writer([&] {
        start.arrive_and_wait();
        while (reading > 0) {
            served.library.apply({toggles % 2 == 0 ? retagged : restored});
            ++toggles;
            std::this_thread::yield();
        }
    });
    std::vector<std::thread> readers;
    readers.reserve(kReaders);
    for (size_t reader = 0; reader < kReaders; ++reader) {
        readers.emplace_back([&] {
            start.arrive_and_wait();
            for (size_t round = 0; round < kRoundsPerReader; ++round) {
                const auto response = served.ask();
                if (!response || response->status != 200) {
                    ++unanswered;
                    continue;
                }
                const json answer = documentOf(*response);
                const auto revision = answer.at("revision").get<uint64_t>();
                const json& expected = (revision - asBuilt) % 2 == 0 ? untouched : moved;
                if (answer.at("lengths") != expected)
                    ++wrong;
            }
            --reading;
        });
    }
    for (auto& reader : readers)
        reader.join();
    writer.join();

    INFO("row changes applied: ", toggles.load());
    CHECK(unanswered == 0);
    CHECK(wrong == 0);
}
