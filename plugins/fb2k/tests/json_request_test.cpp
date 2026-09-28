#include "third_party/doctest.h"

#include "core/library.h"
#include "support/fixtures.h"
#include "support/spec.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <memory>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kSendJson[] = "send application/json";

// Whatever a callback would answer. A refused request never asks for one.
struct Anything {
    template <typename T>
    operator T() const {
        return T{};
    }
};

template <typename Callback>
void count(Callback& callback, const std::shared_ptr<int>& calls) {
    callback = [calls](auto&&...) -> Anything {
        ++*calls;
        return {};
    };
}

Player countingEveryCall(const std::shared_ptr<int>& calls) {
    Player player = servingPlayer();

    count(player.library.writeTags, calls);
    count(player.playlists.list, calls);
    count(player.playlists.readRows, calls);
    count(player.playlists.readChangedRows, calls);
    count(player.playback.playPlaylistRow, calls);
    count(player.playback.commandTransport, calls);
    count(player.playback.seek, calls);
    count(player.playback.setOrder, calls);
    count(player.playback.setVolume, calls);
    count(player.playback.stepVolume, calls);
    count(player.playback.setMuted, calls);
    count(player.queue.read, calls);
    count(player.queue.addPlaylistRows, calls);
    count(player.queue.addLibraryTracks, calls);
    count(player.queue.moveEntry, calls);
    count(player.queue.removeEntry, calls);
    count(player.queue.clear, calls);
    count(player.autoPlaylists.create, calls);
    count(player.autoPlaylists.update, calls);
    count(player.autoPlaylists.remove, calls);
    count(player.playlists.resolveOwn, calls);
    count(player.playlists.create, calls);
    count(player.playlists.rename, calls);
    count(player.playlists.remove, calls);
    count(player.playlists.move, calls);
    count(player.playlists.copyRows, calls);
    count(player.playlists.removeRows, calls);
    count(player.playlists.fill, calls);
    count(player.playlists.emptyOwn, calls);
    count(player.autoPlaylists.preview, calls);
    count(player.stream.open, calls);
    count(player.stream.readTimeline, calls);
    count(player.stream.outputHeld, calls);
    count(player.stream.releaseOutput, calls);
    count(player.library.refresh, calls);
    count(player.library.readArtwork, calls);
    count(player.playlists.readRowArtwork, calls);
    count(player.library.readTrack, calls);
    count(player.library.readOrdinal, calls);
    count(player.playback.readPlayingTrack, calls);

    player.stream.formats = {"opus"};
    return player;
}

TicketMint countingMint(const std::shared_ptr<int>& calls) {
    return [calls] {
        ++*calls;
        return std::string("ticket");
    };
}

std::string dialable(std::string path) {
    for (const auto& [placeholder, value] :
         std::vector<std::pair<std::string, std::string>>{
             {"{id}", kPlaylistId}, {"{role}", "scratch"}, {"{index}", "0"}}) {
        const auto at = path.find(placeholder);
        if (at != std::string::npos)
            path.replace(at, placeholder.size(), value);
    }

    return "/api" + path;
}

std::vector<std::string> publishedPosts() {
    std::vector<std::string> posts;
    for (const auto& route : publishedRoutes())
        if (route.method == "POST")
            posts.push_back(dialable(route.path));

    return posts;
}

struct Refusable {
    const char* contentType;
    const char* body;
};

void checkEveryPostRefuses(const Refusable& request) {
    const auto calls = std::make_shared<int>(0);
    const auto minted = std::make_shared<int>(0);
    Library library;
    const TestServer server(servingSettings(), countingEveryCall(calls), &library,
                            countingMint(minted));

    const auto posts = publishedPosts();
    REQUIRE(posts.size() > 20);

    for (const auto& path : posts) {
        INFO("POST ", path);
        *calls = 0;
        *minted = 0;

        const auto response = server.client().Post(path, request.body, request.contentType);

        REQUIRE(response);
        CHECK(response->status == 415);

        const auto body = json::parse(response->body, nullptr, false);
        CHECK(body.is_object());
        CHECK(body.value("error", "") == kSendJson);

        CHECK(*calls == 0);
        CHECK(*minted == 0);
    }
}

}  // namespace

TEST_CASE("every POST the contract publishes refuses text/plain with 415 send application/json") {
    checkEveryPostRefuses({"text/plain;charset=UTF-8", "{}"});
}

// What a body-less command sends when nobody sets the header, and a browser lets it cross
// origins without a preflight.
TEST_CASE("every POST the contract publishes refuses no Content-Type with 415 send application/json") {
    checkEveryPostRefuses({"", ""});
}

TEST_CASE("a DELETE with no Content-Type is served, since only a POST must be application/json") {
    const auto calls = std::make_shared<int>(0);
    Library library;
    const TestServer server(servingSettings(), countingEveryCall(calls), &library);

    std::vector<std::string> deletes;
    for (const auto& route : publishedRoutes())
        if (route.method == "DELETE")
            deletes.push_back(dialable(route.path));

    REQUIRE_FALSE(deletes.empty());

    for (const auto& path : deletes) {
        INFO("DELETE ", path);

        const auto response = server.client().Delete(path);

        REQUIRE(response);
        CHECK(response->status != 415);
        CHECK(response->body.find(kSendJson) == std::string::npos);
    }
}
