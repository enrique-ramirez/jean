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
#include <atomic>
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

constexpr char kBasicAlbum[] = "basic: album with its artist";

constexpr std::string_view kKinds[] = {"album", "artist", "genre", "search"};

json documentOf(const httplib::Response& response) {
    return json::parse(response.body, nullptr, false);
}

std::vector<Owned> ownedFor(const std::string_view kind) {
    if (kind == "album")
        return {{"name", "Jessico"}, {"by", "Babasónicos"}};
    if (kind == "artist")
        return {{"name", "Brand New"}, {"splitsCredits", "true"}};
    if (kind == "search")
        return {{"query", "a"}, {"limit", "8"}, {"entityLimit", "3"}, {"splitsCredits", "true"}};
    return {{"name", "Alternative Rock"}};
}

bool variesOnEncoding(const httplib::Response& response) {
    for (size_t at = 0; at < response.get_header_value_count("Vary"); ++at) {
        if (response.get_header_value("Vary", "", at).find("Accept-Encoding") != std::string::npos)
            return true;
    }
    return false;
}

struct Served {
    QuestionLibrary questions;
    Library library;
    LibraryRoutesServer server;

    explicit Served(const json& asked)
        : questions(questionLibraryOf(asked)), server(&library, kNow) {
        declareAndBuild(server, library, questions);
    }

    httplib::Result ask(const std::string_view kind, const std::vector<RoleAsked>& roles) const {
        return server.client().Get(questionPath(kind, ownedFor(kind), roles));
    }

    httplib::Result ask(const std::string_view kind) const { return ask(kind, questions.roles); }
};

}  // namespace

TEST_CASE("each page question is answered with the case's answer at the pair the library holds") {
    const std::vector<const char*> cases{
        kBasicAlbum,
        "album-by: album by alpha, folded",
        "album-by: album by empty",
        "album-by: album by absent",
        "basic: album with an empty name",
        "credits: artist \"Alpha\" splits true",
        "credits: artist \"Alpha\" splits false",
        "credits: artist \"Blood, Sweat & Tears\" splits false",
        "basic: artist \"\" splits false",
        "basic: genre, folded",
    };

    for (const char* name : cases) {
        INFO("case: ", name);
        const json& asked = questionCase(name);
        Served served(asked);

        served.library.apply({served.questions.changed(0, "rating", "5")});
        const auto state = served.library.state();
        REQUIRE(state.revision != state.structure);
        const int refreshesBefore = served.server.refreshes();

        const auto response =
            served.server.client().Get(questionPathOf(asked, served.questions.roles));
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(response->get_header_value("Content-Type") == "application/json");
        CHECK(withoutSetSummaries(documentOf(*response), asked.at("expected")) ==
              expectedAnswer(asked, state));
        CHECK(served.server.refreshes() == refreshesBefore);
    }
}

TEST_CASE("every search case in the cases file is answered through the route as it expects") {
    size_t asked = 0;
    for (const json& searchCase : casesIn("library_questions_cases.json").at("cases")) {
        if (searchCase.at("question").at("kind") != "search")
            continue;
        INFO("case: ", searchCase.at("name").get<std::string>());
        ++asked;

        const Served served(searchCase);
        const auto response =
            served.server.client().Get(questionPathOf(searchCase, served.questions.roles));
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(withoutSetSummaries(documentOf(*response), searchCase.at("expected")) ==
              expectedAnswer(searchCase, served.library.state()));
    }
    CHECK(asked > 0);
}

TEST_CASE("a query of 1024 bytes is asked, and one byte more is refused however few characters") {
    const Served served(questionCase(kBasicAlbum));
    const auto searchFor = [&served](const std::string& query) {
        return served.server.client().Get(questionPath(
            "search",
            {{"query", query}, {"limit", "8"}, {"entityLimit", "3"}, {"splitsCredits", "true"}},
            served.questions.roles));
    };
    const json tooLong{{"error", "unacceptable question"},
                       {"detail", "'query' must be at most 1024 bytes"}};

    std::string twoByteCharacters;
    for (int at = 0; at < 512; ++at)
        twoByteCharacters += "é";
    REQUIRE(twoByteCharacters.size() == 1024);

    struct Asked {
        const char* what;
        std::string query;
        int status;
    };
    const std::vector<Asked> queries{
        {"1024 single-byte characters", std::string(1024, 'a'), 200},
        {"1025 single-byte characters", std::string(1025, 'a'), 400},
        {"512 two-byte characters", twoByteCharacters, 200},
        {"512 two-byte characters and one byte more", twoByteCharacters + "a", 400},
    };
    for (const auto& query : queries) {
        INFO("query: ", std::string(query.what));
        const auto response = searchFor(query.query);
        REQUIRE(response);
        CHECK(response->status == query.status);
        if (query.status == 400)
            CHECK(documentOf(*response) == tooLong);
    }
}

TEST_CASE("an answer is held by nobody but the client that asked, and sent under no validator") {
    const Served served(questionCase(kBasicAlbum));

    for (const auto kind : kKinds) {
        INFO("route: ", kind);
        const auto response = served.ask(kind);
        REQUIRE(response);
        REQUIRE(response->status == 200);
        CHECK(response->get_header_value("Cache-Control") == "private, no-cache");
        CHECK_FALSE(response->has_header("ETag"));
    }
}

TEST_CASE("an answer is gzipped where offered, sent as it stands where not, and varies on it") {
    const Served served(questionCase(kBasicAlbum));
    auto client = served.server.client();
    client.set_decompress(false);

    for (const auto kind : kKinds) {
        INFO("route: ", kind);
        const auto path = questionPath(kind, ownedFor(kind), served.questions.roles);
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
}

TEST_CASE("a role left out of a question reads as unresolved on every track") {
    const Served served(questionCase(kBasicAlbum));

    const auto without = [&served](const std::string_view role) {
        std::vector<RoleAsked> roles;
        std::copy_if(served.questions.roles.begin(), served.questions.roles.end(),
                     std::back_inserter(roles),
                     [role](const RoleAsked& asked) { return asked.name != role; });
        return roles;
    };

    const auto noAlbum = served.ask("album", without("album"));
    REQUIRE(noAlbum);
    REQUIRE(noAlbum->status == 200);
    const auto albumless = documentOf(*noAlbum);
    CHECK(albumless.at("refs") == json{{"runs", json::array()}});
    CHECK(albumless.at("album") == "Jessico");
    CHECK(albumless.at("artist").is_null());

    const auto noGenre = served.ask("genre", without("genre"));
    REQUIRE(noGenre);
    REQUIRE(noGenre->status == 200);
    CHECK(documentOf(*noGenre).at("refs") == json{{"runs", json::array()}});

    const auto noAlbumSearched = served.server.client().Get(questionPath(
        "search",
        {{"query", "jessico"}, {"limit", "8"}, {"entityLimit", "3"}, {"splitsCredits", "true"}},
        without("album")));
    REQUIRE(noAlbumSearched);
    REQUIRE(noAlbumSearched->status == 200);
    const auto searched = documentOf(*noAlbumSearched);
    CHECK(searched.at("matched") == json{{"runs", json::array()}});
    CHECK(searched.at("matchCount") == 0);
    CHECK(searched.at("albums").at("total") == 0);
}

TEST_CASE("a role or a question a route cannot read is refused with a 400 saying what is wrong") {
    const Served served(questionCase(kBasicAlbum));
    const int refreshesBefore = served.server.refreshes();
    const std::string tooLong = "role 'album' must be printable text of 1 to " +
                                std::to_string(kMaxColumnLength) + " characters";

    struct Refused {
        const char* what;
        std::string_view kind;
        std::string query;
        const char* error;
        std::string detail;
    };
    const std::vector<Refused> refused{
        {"a name that is no role", "genre", "name=Rock&colour=%25title%25", "unacceptable role",
         "'colour' is not a role"},
        {"another route's own parameter", "genre", "name=Rock&by=Someone", "unacceptable role",
         "'by' is not a role"},
        {"the artist route's own parameter", "album", "name=Jessico&splitsCredits=true",
         "unacceptable role", "'splitsCredits' is not a role"},
        {"the search route's own parameter", "artist", "name=Alpha&splitsCredits=true&query=a",
         "unacceptable role", "'query' is not a role"},
        {"an empty expression", "album", "name=Jessico&album=", "unacceptable role", tooLong},
        {"a role named twice", "genre", "name=Rock&album=%25album%25&album=%25artist%25",
         "duplicate role", "role 'album' is named twice"},
        {"an offending role before a missing name", "album", "colour=x", "unacceptable role",
         "'colour' is not a role"},

        {"no album name", "album", "by=Someone", "unacceptable question", "'name' is required"},
        {"no artist name", "artist", "splitsCredits=true", "unacceptable question",
         "'name' is required"},
        {"no genre name", "genre", "genre=%25genre%25", "unacceptable question",
         "'name' is required"},
        {"no splitsCredits", "artist", "name=Alpha", "unacceptable question",
         "'splitsCredits' is required"},
        {"no name and a splitsCredits that is no flag", "artist", "splitsCredits=yes",
         "unacceptable question", "'name' is required"},
        {"no name and a by named twice", "album", "by=A&by=B", "unacceptable question",
         "'name' is required"},
        {"no splitsCredits and a name named twice", "artist", "name=A&name=B",
         "unacceptable question", "'splitsCredits' is required"},

        {"a splitsCredits of yes", "artist", "name=Alpha&splitsCredits=yes",
         "unacceptable question", "'splitsCredits' must be true or false"},
        {"a splitsCredits of 1", "artist", "name=Alpha&splitsCredits=1", "unacceptable question",
         "'splitsCredits' must be true or false"},
        {"an empty splitsCredits", "artist", "name=Alpha&splitsCredits=", "unacceptable question",
         "'splitsCredits' must be true or false"},
        {"a splitsCredits that is no flag and a name named twice", "artist",
         "name=A&name=B&splitsCredits=yes", "unacceptable question",
         "'splitsCredits' must be true or false"},

        {"an album name named twice", "album", "name=A&name=B", "duplicate question",
         "'name' is named twice"},
        {"an artist name named twice", "artist", "name=A&name=B&splitsCredits=true",
         "duplicate question", "'name' is named twice"},
        {"a genre name named twice", "genre", "name=A&name=B", "duplicate question",
         "'name' is named twice"},
        {"by named twice", "album", "name=Jessico&by=A&by=B", "duplicate question",
         "'by' is named twice"},
        {"splitsCredits named twice", "artist", "name=Alpha&splitsCredits=true&splitsCredits=false",
         "duplicate question", "'splitsCredits' is named twice"},

        {"a page route's own parameter", "search",
         "query=a&limit=8&entityLimit=3&splitsCredits=true&name=Rock", "unacceptable role",
         "'name' is not a role"},
        {"the album route's own parameter", "search",
         "query=a&limit=8&entityLimit=3&splitsCredits=true&by=Someone", "unacceptable role",
         "'by' is not a role"},
        {"no query", "search", "limit=8&entityLimit=3&splitsCredits=true", "unacceptable question",
         "'query' is required"},
        {"no limit", "search", "query=a&entityLimit=3&splitsCredits=true", "unacceptable question",
         "'limit' is required"},
        {"no entityLimit", "search", "query=a&limit=8&splitsCredits=true", "unacceptable question",
         "'entityLimit' is required"},
        {"no splitsCredits on search", "search", "query=a&limit=8&entityLimit=3",
         "unacceptable question", "'splitsCredits' is required"},
        {"no query and a limit that is no count", "search",
         "limit=-1&entityLimit=3&splitsCredits=true", "unacceptable question",
         "'query' is required"},
        {"a negative limit", "search", "query=a&limit=-1&entityLimit=3&splitsCredits=true",
         "unacceptable question", "'limit' must be a whole number of 0 or more"},
        {"a limit with a plus sign", "search",
         "query=a&limit=%2B1&entityLimit=3&splitsCredits=true", "unacceptable question",
         "'limit' must be a whole number of 0 or more"},
        {"a fractional limit", "search", "query=a&limit=1.5&entityLimit=3&splitsCredits=true",
         "unacceptable question", "'limit' must be a whole number of 0 or more"},
        {"a limit in exponent form", "search", "query=a&limit=1e2&entityLimit=3&splitsCredits=true",
         "unacceptable question", "'limit' must be a whole number of 0 or more"},
        {"a limit with a space before it", "search",
         "query=a&limit=%201&entityLimit=3&splitsCredits=true", "unacceptable question",
         "'limit' must be a whole number of 0 or more"},
        {"an empty limit", "search", "query=a&limit=&entityLimit=3&splitsCredits=true",
         "unacceptable question", "'limit' must be a whole number of 0 or more"},
        {"a limit that is a word", "search", "query=a&limit=all&entityLimit=3&splitsCredits=true",
         "unacceptable question", "'limit' must be a whole number of 0 or more"},
        {"a negative entityLimit", "search", "query=a&limit=8&entityLimit=-3&splitsCredits=true",
         "unacceptable question", "'entityLimit' must be a whole number of 0 or more"},
        {"a fractional entityLimit", "search", "query=a&limit=8&entityLimit=2.0&splitsCredits=true",
         "unacceptable question", "'entityLimit' must be a whole number of 0 or more"},
        {"a splitsCredits of yes on search", "search",
         "query=a&limit=8&entityLimit=3&splitsCredits=yes", "unacceptable question",
         "'splitsCredits' must be true or false"},
        {"a limit that is no count and a query named twice", "search",
         "query=a&query=b&limit=x&entityLimit=3&splitsCredits=true", "unacceptable question",
         "'limit' must be a whole number of 0 or more"},
        {"a query named twice", "search",
         "query=a&query=b&limit=8&entityLimit=3&splitsCredits=true", "duplicate question",
         "'query' is named twice"},
        {"a limit named twice", "search",
         "query=a&limit=1&limit=2&entityLimit=3&splitsCredits=true", "duplicate question",
         "'limit' is named twice"},
        {"an entityLimit named twice", "search",
         "query=a&limit=8&entityLimit=1&entityLimit=2&splitsCredits=true", "duplicate question",
         "'entityLimit' is named twice"},
    };

    for (const auto& request : refused) {
        INFO("refused: ", std::string(request.what));
        const auto path = "/api/library/" + std::string(request.kind) + "?" + request.query;
        const auto response = served.server.client().Get(path);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(documentOf(*response) == json{{"error", request.error}, {"detail", request.detail}});
    }

    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE("without the media library a question is a 503, after what it asks is judged") {
    const LibraryRoutesServer server(nullptr, kNow);
    const auto roles = questionLibraryOf(questionCase(kBasicAlbum)).roles;

    for (const auto kind : kKinds) {
        INFO("route: ", kind);
        const auto refused = server.client().Get("/api/library/" + std::string(kind));
        REQUIRE(refused);
        CHECK(refused->status == 400);

        const auto unavailable = server.client().Get(questionPath(kind, ownedFor(kind), roles));
        REQUIRE(unavailable);
        CHECK(unavailable->status == 503);
        CHECK(errorOf(*unavailable) == kNoLibrary);
    }
    CHECK(server.refreshes() == 0);
}

TEST_CASE("with no snapshot ready a question answers the library document and starts no build") {
    const auto questions = questionLibraryOf(questionCase(kBasicAlbum));
    const Library library;
    const LibraryRoutesServer server(&library, kNow);
    const auto declared = declareThroughRows(server, questions.declared);
    REQUIRE(declared);
    REQUIRE(declared->status == 202);
    const int refreshesBefore = server.refreshes();

    for (const auto kind : kKinds) {
        INFO("route: ", kind);
        const auto response =
            server.client().Get(questionPath(kind, ownedFor(kind), questions.roles));
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
    "a role naming a declared column the ready snapshot lacks is a 202 that starts no build") {
    const Served served(questionCase(kBasicAlbum));

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

    for (const auto kind : kKinds) {
        INFO("route: ", kind);
        const auto response = served.ask(kind, moody);
        REQUIRE(response);
        CHECK(response->status == 202);

        const auto document = documentOf(*response);
        CHECK(document.at("ready") == true);
        CHECK(document.at("structure") == served.library.state().structure);
    }
    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE("a role naming a column the declaration does not hold is a 409 naming it") {
    const Served served(questionCase(kBasicAlbum));
    const int refreshesBefore = served.server.refreshes();

    auto commented = served.questions.roles;
    for (auto& role : commented) {
        if (role.name == "genre")
            role.expression = "%comment%";
    }

    for (const auto kind : kKinds) {
        INFO("route: ", kind);
        const auto response = served.ask(kind, commented);
        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(errorOf(*response) == "'%comment%' is not a declared column");
    }
    CHECK(served.server.refreshes() == refreshesBefore);
}

TEST_CASE("questions racing row changes answer the rows of the revision they carry") {
    constexpr size_t kReaders = 4;
    constexpr size_t kRoundsPerReader = 11;

    Served served(questionCase(kBasicAlbum));
    const RowChange retagged = served.questions.changed(2, "albumArtist", "Brand New");
    const RowChange restored = {2, served.questions.rows.at(2)};

    const auto askEveryKind = [&served] {
        json answers = json::array();
        for (const auto kind : kKinds) {
            const auto response = served.ask(kind);
            REQUIRE(response);
            REQUIRE(response->status == 200);
            answers.push_back(documentOf(*response));
        }
        return answers;
    };
    const auto withoutPair = [](json answer) {
        answer.erase("structure");
        answer.erase("revision");
        return answer;
    };

    const uint64_t asBuilt = served.library.state().revision;
    const json untouched = askEveryKind();
    served.library.apply({retagged});
    const json moved = askEveryKind();
    served.library.apply({restored});
    REQUIRE(served.library.state().revision == asBuilt + 2);
    REQUIRE(withoutPair(untouched[0]) != withoutPair(moved[0]));

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
                for (size_t at = 0; at < std::size(kKinds); ++at) {
                    const auto response = served.ask(kKinds[at]);
                    if (!response || response->status != 200) {
                        ++unanswered;
                        continue;
                    }
                    const json answer = documentOf(*response);
                    const auto revision = answer.at("revision").get<uint64_t>();
                    const json& expected = (revision - asBuilt) % 2 == 0 ? untouched : moved;
                    if (answer.at("structure") != served.library.state().structure ||
                        withoutPair(answer) != withoutPair(expected[at]))
                        ++wrong;
                }
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
