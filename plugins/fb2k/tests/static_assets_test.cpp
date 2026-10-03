// Jean's page served over a real socket from the page seam: every path outside /api/. Where the
// files come from is the seam's business and is not tested here; what a request meets on its way
// to one is.

#include "third_party/doctest.h"

#include "core/text.h"
#include "support/log_capture.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cctype>
#include <iterator>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kIndex[] = "<!doctype html><title>Jean</title><script src=\"/assets/x.js\">";
constexpr char kScript[] = "export const jean = 1;";
constexpr char kLocale[] = "{\"Play\":\"Reproducir\"}";

constexpr char kHtml[] = "text/html; charset=utf-8";
constexpr char kRevalidate[] = "no-cache";
constexpr char kForAYear[] = "public, max-age=31536000, immutable";

// A font carries NULs, so a body cut at the first one is a truncated file rather than a match.
std::string fontBytes() {
    return {"wOF2\0\1\0\0\0\0\x0b\x2c", 12};
}

struct FakePages {
    std::map<std::string, std::string> files;
    std::vector<std::string> asked;
};

FakePages aBuild() {
    FakePages pages;
    pages.files = {
        {"index.html", kIndex},
        {"favicon.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>"},
        {"assets/x.js", kScript},
        {"assets/x.css", "body{margin:0}"},
        {"assets/rethink-sans-latin.woff2", fontBytes()},
        {"locales/es.json", kLocale},
    };

    return pages;
}

// The pointer must outlive the server.
Player serving(FakePages* pages) {
    Player player = servingPlayer();
    player.page.read = [pages](const std::string& path) -> std::optional<std::string_view> {
        pages->asked.push_back(path);

        const auto found = pages->files.find(path);
        if (found == pages->files.end())
            return std::nullopt;

        return found->second;
    };

    return player;
}

struct FakeDisk {
    std::map<std::string, std::string> files;
    std::vector<std::string> asked;

    bool holdsDirectory(const std::string& path) const {
        const std::string prefix = path + "/";
        return std::any_of(files.begin(), files.end(), [&prefix](const auto& file) {
            return file.first.rfind(prefix, 0) == 0;
        });
    }

    bool wasAskedFor(const std::string& path) const {
        return std::find(asked.begin(), asked.end(), path) != asked.end();
    }
};

std::vector<std::string> jeanRoot() {
    return {"index.html", "assets", "locales", "favicon.svg"};
}

Player serving(FakePages* pages, FakeDisk* disk) {
    Player player = serving(pages);
    player.page.names = jeanRoot();
    player.page.readDisk = [disk](const std::string& path) -> DiskPage {
        disk->asked.push_back(path);

        DiskPage page;
        const auto found = disk->files.find(path);
        if (found != disk->files.end()) {
            page.kind = DiskPage::Kind::file;
            page.bytes = found->second;
        } else if (disk->holdsDirectory(path)) {
            page.kind = DiskPage::Kind::directory;
        }

        return page;
    };

    return player;
}

size_t linesNaming(const std::string& name) {
    const auto lines = loggedLines();
    return static_cast<size_t>(std::count_if(
        lines.begin(), lines.end(),
        [&name](const std::string& line) { return line.find(name) != std::string::npos; }));
}

// A browser loading a page sends no Authorization header.
httplib::Result browse(const TestServer& server, const std::string& path) {
    return server.client().Get(path);
}

httplib::Result browse(const TestServer& server, const std::string& path,
                       const std::string& holding) {
    return server.client().Get(path, httplib::Headers{{"If-None-Match", holding}});
}

std::string mediaType(const std::string& contentType) {
    std::string type = contentType.substr(0, contentType.find(';'));
    type.erase(std::remove(type.begin(), type.end(), ' '), type.end());
    std::transform(type.begin(), type.end(), type.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return type;
}

json notFound() {
    return json{{"error", "not found"}};
}

}  // namespace

TEST_CASE("c1 GET / with no credential answers index.html as utf-8 html") {
    FakePages pages = aBuild();
    const TestServer server(servingSettings(), serving(&pages));

    const auto response = browse(server, "/");

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Type") == kHtml);
    CHECK(response->body == kIndex);
}

// A browser refuses a module script whose Content-Type is not a JavaScript MIME type, and the
// component sends nosniff, so a stylesheet or a font with the wrong type is refused as well.
TEST_CASE("c2 each file in the build is served at its own path with its extension's type") {
    FakePages pages = aBuild();
    const TestServer server(servingSettings(), serving(&pages));

    struct Served {
        const char* path;
        std::set<std::string> types;
    };

    const std::vector<Served> build{
        {"index.html", {"text/html"}},
        {"assets/x.js", {"text/javascript", "application/javascript"}},
        {"assets/x.css", {"text/css"}},
        {"locales/es.json", {"application/json"}},
        {"favicon.svg", {"image/svg+xml"}},
        {"assets/rethink-sans-latin.woff2", {"font/woff2"}},
    };

    for (const auto& file : build) {
        const auto response = browse(server, std::string("/") + file.path);

        INFO("path: ", file.path);
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(response->body == pages.files.at(file.path));
        CHECK(file.types.count(mediaType(response->get_header_value("Content-Type"))) == 1);
    }
}

// A source map hands out the source, and a file with no extension has no type to send it with.
TEST_CASE("c2 a file the build holds under an extension outside the table is a 404") {
    FakePages pages = aBuild();
    pages.files["assets/x.js.map"] = "{\"version\":3,\"sources\":[\"secret.ts\"]}";
    pages.files["LICENSE"] = "Copyright";
    pages.files["assets/x.exe"] = "MZ";
    const TestServer server(servingSettings(), serving(&pages));

    for (const char* path : {"/assets/x.js.map", "/LICENSE", "/assets/x.exe"}) {
        const auto response = browse(server, path);

        INFO("path: ", path);
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(json::parse(response->body) == notFound());
    }
}

// The same requests against a server with no page seam are what "as today" means, so any /api/
// answer that moves once a build is present is the page leaking into the API.
TEST_CASE("c3 a path under /api/ answers as it does with no page, and never from the page") {
    FakePages pages = aBuild();
    pages.files["api/index.html"] = kIndex;
    pages.files["api/assets/x.js"] = kScript;
    pages.files["api/locales/es.json"] = kLocale;

    const TestServer withPage(servingSettings(), serving(&pages));
    const TestServer withoutPage(servingSettings(), servingPlayer());

    const auto bareIndex = browse(withPage, "/api/index.html");

    REQUIRE(bareIndex);
    CHECK(bareIndex->status == 404);
    CHECK(bareIndex->body != kIndex);

    for (const char* path :
         {"/api/index.html", "/api/assets/x.js", "/api/locales/es.json", "/api/"}) {
        INFO("path: ", path);

        const auto page = withPage.client().Get(path);
        const auto today = withoutPage.client().Get(path);

        REQUIRE(page);
        REQUIRE(today);
        CHECK(page->status == today->status);
        CHECK(page->body == today->body);

        const auto head = withPage.client().Head(path);

        REQUIRE(head);
        CHECK(head->status == today->status);
    }

    CHECK(pages.asked.empty());
}

// Jean routes on the hash, so a path the build does not hold is never a view of the app, and
// answering index.html for it would hide a missing asset behind a page that loads blank.
TEST_CASE("c4 a path the build does not hold is the JSON 404") {
    FakePages pages = aBuild();
    const TestServer server(servingSettings(), serving(&pages));

    const auto unknownApiPath = get(server, "/api/nothing");

    REQUIRE(unknownApiPath);
    REQUIRE(unknownApiPath->status == 404);

    for (const char* path :
         {"/nothing", "/nothing.js", "/assets/gone.js", "/locales/xx.json", "/library/some/view"}) {
        INFO("path: ", path);

        const auto response = server.client().Get(path);

        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(json::parse(response->body) == notFound());
        CHECK(response->body == unknownApiPath->body);
    }
}

// Every spelling here reaches the handler as the decoded path, and the seam holds a file under
// that decoded key too, so a check that let one through would be answered with its bytes. A seam
// reading a folder would resolve each of these to a file outside the build.
TEST_CASE("c5 a path carrying .., a backslash or a NUL in any spelling is refused unread") {
    FakePages pages = aBuild();
    for (const char* held :
         {"../index.html", "assets/../index.html", "assets\\x.js", "assets\\..\\index.html"})
        pages.files[held] = kIndex;
    pages.files[std::string("index.html\0.js", 14)] = kIndex;
    pages.files[std::string("index.html\0", 11)] = kIndex;

    const TestServer server(servingSettings(), serving(&pages));

    const std::vector<std::string> refused{
        "/../index.html",
        "/assets/../index.html",
        "/assets/%2e%2e/index.html",
        "/assets/%2E%2E/index.html",
        "/assets/.%2e/index.html",
        // cpp-httplib also decodes the nonstandard %uXXXX form into the path it hands a handler.
        "/assets/%u002e%u002e/index.html",
        "/assets\\x.js",
        "/assets\\..\\index.html",
        "/assets%5cx.js",
        "/assets%5Cx.js",
        "/index.html%00.js",
        "/index.html%00",
    };

    for (const auto& path : refused) {
        INFO("path: ", path);

        const auto response = server.client().Get(path);

        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(json::parse(response->body) == notFound());
    }

    CHECK(pages.asked.empty());
}

// Win32 path normalisation drops a trailing dot or space from every path segment, so on Windows
// `www\assets.\x.js` opens `www\assets\x.js` and `www\api.\` opens `www\api\`. Both seams hold a
// file under each decoded spelling, so a check that let one through is answered with its bytes.
TEST_CASE(
    "c5 a path segment ending in a dot or a space is refused unread, in a folder or a file name") {
    FakePages pages = aBuild();
    FakeDisk disk;
    for (const char* held :
         {"assets./x.js", "api./index.html", "api./status", "locales./x.json", "mine./index.html",
          "mine /index.html", "index.html.", "index.html "}) {
        pages.files[held] = kIndex;
        disk.files[held] = kIndex;
    }
    const TestServer server(servingSettings(), serving(&pages, &disk));

    const std::vector<std::string> refused{
        "/assets./x.js",     "/api./",
        "/api./status",      "/locales./x.json",
        "/mine./index.html", "/mine%20/index.html",
        "/index.html.",      "/index.html%20",
    };

    for (const auto& path : refused) {
        INFO("path: ", path);

        const auto response = server.client().Get(path);

        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(json::parse(response->body) == notFound());
    }

    CHECK(pages.asked.empty());
    CHECK(disk.asked.empty());
}

// A stale index.html names scripts a new build no longer holds, and draws a blank page until
// somebody finds the hard reload. Revalidating it every time is what keeps an upgrade visible.
TEST_CASE("c6 index.html and a locale are revalidated on every load, and a matching tag is a 304") {
    FakePages pages = aBuild();
    const TestServer server(servingSettings(), serving(&pages));

    for (const char* path : {"/", "/index.html", "/locales/es.json"}) {
        INFO("path: ", path);

        const auto first = browse(server, path);

        REQUIRE(first);
        CHECK(first->status == 200);
        CHECK(first->get_header_value("Cache-Control") == kRevalidate);

        const auto tag = first->get_header_value("ETag");
        REQUIRE_FALSE(tag.empty());

        const auto again = browse(server, path, tag);

        REQUIRE(again);
        CHECK(again->status == 304);
        CHECK(again->body.empty());
    }
}

TEST_CASE("c6 a tag for bytes the build no longer holds gets the new bytes and a new tag") {
    FakePages pages = aBuild();
    const TestServer server(servingSettings(), serving(&pages));

    const auto before = browse(server, "/");

    REQUIRE(before);
    const auto staleTag = before->get_header_value("ETag");
    REQUIRE_FALSE(staleTag.empty());

    const std::string rebuilt = "<!doctype html><script src=\"/assets/y.js\">";
    pages.files["index.html"] = rebuilt;

    const auto after = browse(server, "/", staleTag);

    REQUIRE(after);
    CHECK(after->status == 200);
    CHECK(after->body == rebuilt);
    CHECK(after->get_header_value("ETag") != staleTag);
}

TEST_CASE("c6 a file under assets/ is cached for a year without revalidating") {
    FakePages pages = aBuild();
    const TestServer server(servingSettings(), serving(&pages));

    for (const char* path : {"/assets/x.js", "/assets/x.css", "/assets/rethink-sans-latin.woff2"}) {
        const auto response = browse(server, path);

        INFO("path: ", path);
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(response->get_header_value("Cache-Control") == kForAYear);
    }
}

// The build is written straight from the component's own resources rather than copied into each
// response, and cpp-httplib compresses only a body it holds. So what it would have compressed is
// compressed before it is handed over, and the rest must still arrive whole.
TEST_CASE("c6 a text file is gzipped for a client that asks, and a font is sent whole") {
    FakePages pages = aBuild();
    const TestServer server(servingSettings(), serving(&pages));
    auto wire = undecoding(server);

    const auto variesByEncoding = [](const httplib::Response& response) {
        const auto named = response.headers.equal_range("Vary");
        return std::any_of(named.first, named.second, [](const auto& header) {
            return header.second.find("Accept-Encoding") != std::string::npos;
        });
    };

    for (const std::string path : {"/", "/assets/x.js", "/locales/es.json"}) {
        INFO("path: ", path);
        const auto file = path == "/" ? std::string("index.html") : path.substr(1);

        const auto packed = wire.Get(path, accepting("gzip"));
        REQUIRE(packed);
        CHECK(packed->status == 200);
        CHECK(packed->get_header_value("Content-Encoding") == "gzip");
        CHECK(variesByEncoding(*packed));
        CHECK(isGzip(packed->body));

        const auto plain = wire.Get(path, accepting("identity"));
        REQUIRE(plain);
        CHECK(plain->get_header_value("Content-Encoding").empty());
        CHECK(plain->body == pages.files.at(file));
    }

    const auto font = wire.Get("/assets/rethink-sans-latin.woff2", accepting("gzip"));
    REQUIRE(font);
    CHECK(font->status == 200);
    CHECK(font->get_header_value("Content-Encoding").empty());
    CHECK(font->body == fontBytes());
}

TEST_CASE("c7 HEAD / answers what GET / would, with no body") {
    FakePages pages = aBuild();
    const TestServer server(servingSettings(), serving(&pages));

    const auto response = server.client().Head("/");

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Type") == kHtml);
    CHECK(response->body.empty());
}

TEST_CASE("c7 POST / is a 404, and no other method reaches a page file") {
    FakePages pages = aBuild();
    const TestServer server(servingSettings(), serving(&pages));

    const auto posted = server.client().Post("/", "", "text/plain");

    REQUIRE(posted);
    CHECK(posted->status == 404);
    CHECK(json::parse(posted->body) == notFound());

    auto client = server.client();
    std::vector<httplib::Result> others;
    others.push_back(client.Put("/index.html", "", "text/plain"));
    others.push_back(client.Patch("/index.html", "", "text/plain"));
    others.push_back(client.Delete("/index.html"));

    for (const auto& other : others) {
        REQUIRE(other);
        CHECK(other->status != 200);
        CHECK(other->body != kIndex);
    }

    CHECK(pages.asked.empty());
}

// A folder dropped in www/ is somebody else's code sharing Jean's origin, so letting it replace
// one of Jean's files would hand it Jean's page and whatever Jean does with it.
TEST_CASE("c9 a path the build holds is answered from the build, and disk is never asked for it") {
    FakePages pages = aBuild();
    FakeDisk disk;
    for (const auto& file : pages.files)
        disk.files[file.first] = "replaced on disk";
    const TestServer server(servingSettings(), serving(&pages, &disk));

    const auto root = browse(server, "/");

    REQUIRE(root);
    CHECK(root->status == 200);
    CHECK(root->body == kIndex);

    for (const auto& file : pages.files) {
        const auto response = browse(server, "/" + file.first);

        INFO("path: ", file.first);
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(response->body == file.second);
        CHECK_FALSE(disk.wasAskedFor(file.first));
    }
}

TEST_CASE(
    "c10 a locale the build lacks is answered from www/locales/ and revalidated on every load") {
    FakePages pages = aBuild();
    FakeDisk disk;
    disk.files["locales/custom.json"] = "{\"Play\":\"Tocar\"}";
    disk.files["locales/fr.json"] = "{\"Play\":\"Lire\"}";
    const TestServer server(servingSettings(), serving(&pages, &disk));

    for (const char* path : {"locales/custom.json", "locales/fr.json"}) {
        INFO("path: ", path);

        const auto first = browse(server, std::string("/") + path);

        REQUIRE(first);
        CHECK(first->status == 200);
        CHECK(first->body == disk.files.at(path));
        CHECK(mediaType(first->get_header_value("Content-Type")) == "application/json");
        CHECK(first->get_header_value("Cache-Control") == kRevalidate);

        const auto tag = first->get_header_value("ETag");
        REQUIRE_FALSE(tag.empty());

        const auto again = browse(server, std::string("/") + path, tag);

        REQUIRE(again);
        CHECK(again->status == 304);
    }
}

TEST_CASE("c10 a file on disk outside www/locales/ never fills a gap in Jean's own paths") {
    FakePages pages = aBuild();
    FakeDisk disk;
    disk.files["favicon.png"] = "\x89PNG";
    disk.files["assets/extra.js"] = kScript;
    const TestServer server(servingSettings(), serving(&pages, &disk));

    for (const char* path : {"/favicon.png", "/assets/extra.js"}) {
        const auto response = browse(server, path);

        INFO("path: ", path);
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(json::parse(response->body) == notFound());
    }
}

TEST_CASE(
    "c11 /<name>/ answers the folder's index.html, and a directory inside it answers its own") {
    FakePages pages = aBuild();
    FakeDisk disk;
    disk.files["mine/index.html"] = "<!doctype html><title>Mine</title>";
    disk.files["mine/sub/index.html"] = "<!doctype html><title>Mine, deeper</title>";
    const TestServer server(servingSettings(), serving(&pages, &disk));

    const auto top = browse(server, "/mine/");

    REQUIRE(top);
    CHECK(top->status == 200);
    CHECK(top->body == disk.files.at("mine/index.html"));
    CHECK(top->get_header_value("Content-Type") == kHtml);

    const auto deeper = browse(server, "/mine/sub/");

    REQUIRE(deeper);
    CHECK(deeper->status == 200);
    CHECK(deeper->body == disk.files.at("mine/sub/index.html"));
}

TEST_CASE("c11 /<name> for a folder is a 301 to /<name>/") {
    FakePages pages = aBuild();
    FakeDisk disk;
    disk.files["mine/index.html"] = "<!doctype html><title>Mine</title>";
    const TestServer server(servingSettings(), serving(&pages, &disk));

    const auto response = browse(server, "/mine");

    REQUIRE(response);
    CHECK(response->status == 301);
    CHECK(response->get_header_value("Location") == "/mine/");
}

TEST_CASE("c11 a path naming no folder in www/ is the JSON 404") {
    FakePages pages = aBuild();
    FakeDisk disk;
    disk.files["mine/index.html"] = "<!doctype html><title>Mine</title>";
    const TestServer server(servingSettings(), serving(&pages, &disk));

    for (const char* path : {"/nothere", "/nothere/", "/nothere/index.html"}) {
        const auto response = browse(server, path);

        INFO("path: ", path);
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(json::parse(response->body) == notFound());
    }
}

TEST_CASE(
    "c11 a folder added while running is served on the next request, and one removed is gone") {
    FakePages pages = aBuild();
    FakeDisk disk;
    const TestServer server(servingSettings(), serving(&pages, &disk));

    const auto before = browse(server, "/later/");

    REQUIRE(before);
    CHECK(before->status == 404);

    disk.files["later/index.html"] = "<!doctype html><title>Later</title>";

    const auto added = browse(server, "/later/");

    REQUIRE(added);
    CHECK(added->status == 200);
    CHECK(added->body == disk.files.at("later/index.html"));

    disk.files.clear();

    const auto removed = browse(server, "/later/");

    REQUIRE(removed);
    CHECK(removed->status == 404);
}

TEST_CASE(
    "c12 a folder named as one of Jean's roots or api, in any case, is never read and is logged "
    "once") {
    FakePages pages = aBuild();
    FakeDisk disk;
    disk.files["Assets/x.js"] = kScript;
    disk.files["API/index.html"] = kIndex;
    disk.files["LOCALES/x.json"] = kLocale;
    disk.files["favicon.SVG/index.html"] = kIndex;
    disk.files["assets/extra.js"] = kScript;
    const TestServer server(servingSettings(), serving(&pages, &disk));

    clearLog();

    const std::vector<std::string> shadowing{"/Assets/x.js", "/API/", "/LOCALES/x.json",
                                             "/favicon.SVG/", "/assets"};

    for (int round = 0; round < 2; ++round) {
        for (const auto& path : shadowing) {
            const auto response = browse(server, path);

            INFO("path: ", path, ", round ", round);
            REQUIRE(response);
            CHECK(response->status == 404);
            CHECK(json::parse(response->body) == notFound());
        }
    }

    CHECK(disk.asked.empty());

    for (const char* name : {"Assets", "API", "LOCALES", "favicon.SVG"}) {
        INFO("name: ", name);
        CHECK(linesNaming(name) == 1);
    }
}

TEST_CASE("c13 a folder interface's file is answered with its extension's registered type") {
    FakePages pages = aBuild();
    FakeDisk disk;

    struct Served {
        const char* path;
        std::set<std::string> types;
    };

    const std::vector<Served> folder{
        {"mine/page.html", {"text/html"}},
        {"mine/app.js", {"text/javascript", "application/javascript"}},
        {"mine/app.css", {"text/css"}},
        {"mine/data.json", {"application/json"}},
        {"mine/logo.svg", {"image/svg+xml"}},
        {"mine/font.woff2", {"font/woff2"}},
        {"mine/cover.png", {"image/png"}},
        {"mine/cover.jpg", {"image/jpeg"}},
        {"mine/cover.webp", {"image/webp"}},
        {"mine/favicon.ico", {"image/vnd.microsoft.icon", "image/x-icon"}},
        {"mine/spinner.gif", {"image/gif"}},
        {"mine/font.woff", {"font/woff"}},
        {"mine/font.ttf", {"font/ttf"}},
        {"mine/robots.txt", {"text/plain"}},
        {"mine/app.webmanifest", {"application/manifest+json"}},
    };

    for (const auto& file : folder)
        disk.files[file.path] = std::string("bytes of ") + file.path;
    const TestServer server(servingSettings(), serving(&pages, &disk));

    for (const auto& file : folder) {
        const auto response = browse(server, std::string("/") + file.path);

        INFO("path: ", file.path);
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(response->body == disk.files.at(file.path));
        CHECK(file.types.count(mediaType(response->get_header_value("Content-Type"))) == 1);
    }
}

TEST_CASE("c13 a folder interface's file outside the table is a 404") {
    FakePages pages = aBuild();
    FakeDisk disk;
    disk.files["mine/index.html"] = "<!doctype html><title>Mine</title>";
    disk.files["mine/setup.exe"] = "MZ";
    disk.files["mine/app.js.map"] = "{\"version\":3}";
    disk.files["mine/LICENSE"] = "Copyright";
    const TestServer server(servingSettings(), serving(&pages, &disk));

    for (const char* path : {"/mine/setup.exe", "/mine/app.js.map", "/mine/LICENSE"}) {
        const auto response = browse(server, path);

        INFO("path: ", path);
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(json::parse(response->body) == notFound());
    }
}

TEST_CASE("c13 every file of a folder interface is revalidated with an ETag, assets/ included") {
    FakePages pages = aBuild();
    FakeDisk disk;
    disk.files["mine/index.html"] = "<!doctype html><title>Mine</title>";
    disk.files["mine/assets/x.js"] = kScript;
    const TestServer server(servingSettings(), serving(&pages, &disk));

    for (const char* path : {"/mine/", "/mine/assets/x.js"}) {
        INFO("path: ", path);

        const auto first = browse(server, path);

        REQUIRE(first);
        CHECK(first->status == 200);
        CHECK(first->get_header_value("Cache-Control") == kRevalidate);

        const auto tag = first->get_header_value("ETag");
        REQUIRE_FALSE(tag.empty());

        const auto again = browse(server, path, tag);

        REQUIRE(again);
        CHECK(again->status == 304);
    }
}

namespace {

// A policy a browser enforces is only as good as its weakest directive, so each is read on its own
// rather than the header compared as one string that a reordering would break.
std::map<std::string, std::set<std::string>> directivesOf(const std::string& policy) {
    std::map<std::string, std::set<std::string>> directives;

    for (const auto& directive : splitOn(policy, ';')) {
        const auto words = splitOn(directive, ' ');
        if (words.empty())
            continue;

        directives[words.front()] = std::set<std::string>(std::next(words.begin()), words.end());
    }

    return directives;
}

}  // namespace

TEST_CASE(
    "c14 Jean's page and a folder interface run only this origin's code, and nobody may frame "
    "them") {
    FakePages pages = aBuild();
    FakeDisk disk;
    disk.files["mine/index.html"] = "<!doctype html><title>Mine</title>";
    const TestServer server(servingSettings(), serving(&pages, &disk));

    for (const char* path : {"/", "/assets/x.js", "/mine/"}) {
        INFO("path: ", path);

        const auto response = browse(server, path);

        REQUIRE(response);
        REQUIRE(response->status == 200);

        auto policy = directivesOf(response->get_header_value("Content-Security-Policy"));
        const std::set<std::string> self{"'self'"};

        CHECK(policy["default-src"] == self);
        CHECK(policy["script-src"] == self);
        CHECK(policy["style-src"] == self);
        CHECK(policy["font-src"] == self);
        CHECK(policy["img-src"] == std::set<std::string>{"'self'", "blob:"});
        CHECK(policy["media-src"] == std::set<std::string>{"'self'", "blob:"});
        CHECK(policy["object-src"] == std::set<std::string>{"'none'"});
        CHECK(policy["base-uri"] == self);
        CHECK(policy["form-action"] == self);
        CHECK(policy["frame-ancestors"] == std::set<std::string>{"'none'"});

        CHECK(response->get_header_value("X-Frame-Options") == "DENY");
        CHECK(response->get_header_value("Referrer-Policy") == "no-referrer");
        CHECK(response->get_header_value("Cross-Origin-Opener-Policy") == "same-origin");
    }
}

TEST_CASE(
    "c14 the page may reach the player, the three artist-information services and LRCLIB's "
    "lyric search, and nothing else") {
    FakePages pages = aBuild();
    const TestServer server(servingSettings(), serving(&pages));

    const auto response = browse(server, "/");

    REQUIRE(response);
    auto policy = directivesOf(response->get_header_value("Content-Security-Policy"));
    CHECK(policy["connect-src"] == std::set<std::string>{"'self'", "https://musicbrainz.org",
                                                         "https://www.wikidata.org",
                                                         "https://en.wikipedia.org",
                                                         "https://lrclib.net"});
}

TEST_CASE(
    "c14 the page asks for no camera, microphone or location, and refuses them to anything it "
    "embeds") {
    FakePages pages = aBuild();
    const TestServer server(servingSettings(), serving(&pages));

    const auto response = browse(server, "/");

    REQUIRE(response);
    const auto features = splitOn(response->get_header_value("Permissions-Policy"), ',');
    const std::set<std::string> refused(features.begin(), features.end());
    CHECK(refused == std::set<std::string>{"camera=()", "microphone=()", "geolocation=()"});
}
