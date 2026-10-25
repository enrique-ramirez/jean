// GET /api/state reporting that foobar2000's main thread has stopped running what this component
// posts to it. The route answers from the component's own store either way, so without this a
// client polling it sees a healthy player while every command it sends waits out kPlayerTimeout.

#include "third_party/doctest.h"

#include "core/ask_player.h"
#include "core/library.h"
#include "core/main_thread_queue.h"
#include "core/main_thread_watch.h"
#include "core/player.h"
#include "core/selection.h"
#include "support/eventually.h"
#include "support/fake_player.h"
#include "support/fixtures.h"
#include "support/main_thread_stand_in.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <chrono>
#include <cstdint>
#include <functional>
#include <string>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

Player watching(MainThreadWatch& watch) {
    Player player = servingPlayer();
    player.checkMainThread = [&watch](std::chrono::steady_clock::time_point now) {
        return watch.check(now);
    };
    return player;
}

struct Poll {
    int status = 0;
    std::string tag;
    json mainThread;
};

Poll poll(const TestServer& server, const std::string& heldTag = "") {
    const auto res =
        heldTag.empty()
            ? get(server, "/api/state")
            : server.client().Get("/api/state", httplib::Headers{{"If-None-Match", heldTag}});
    REQUIRE(res);

    Poll answer{res->status, res->get_header_value("ETag"), nullptr};
    if (res->status == 200)
        answer.mainThread = json::parse(res->body).at("mainThread");
    return answer;
}

constexpr char kStalledPlaylistId[] = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";
constexpr uint64_t kStalledStructure = 9204739866101318923ULL;

// Short of kPlayerTimeout so a route that asks the stalled main thread a second time fails the case
// in seconds rather than holding up the suite, and long enough that the one job it may ask for is
// pumped long before it runs out.
constexpr auto kStalledAnswerTimeout = std::chrono::seconds(5);

// Every read the fake answers becomes one main-thread job, as src/fb2k/ makes each of them.
template <typename Read, typename... Args>
std::function<Read(Args...)> onMainThread(MainThreadQueue& queue,
                                          std::function<Read(Args...)> read) {
    return [&queue, read](Args... args) {
        Read timedOut;
        timedOut.outcome = PlayerOutcome::timedOut;
        Read refused;
        refused.outcome = PlayerOutcome::playerRefused;
        return askPlayer<Read>(
            queue, "a playlist read",
            [read, args...](const AnswerPtr<Read>& answer) { answer->set(read(args...)); },
            timedOut, refused);
    };
}

Player readingOnMainThread(MainThreadQueue& queue, Player player) {
    player.playlists.readRole = onMainThread(queue, player.playlists.readRole);
    player.playlists.readRows = onMainThread(queue, player.playlists.readRows);
    player.playlists.readChangedRows = onMainThread(queue, player.playlists.readChangedRows);
    player.playlists.readTracks = onMainThread(queue, player.playlists.readTracks);
    return player;
}

PlaylistAnnotation stalledPlaylist() {
    PlaylistAnnotation playlist;
    playlist.id = kStalledPlaylistId;
    playlist.title = "Road trip";
    playlist.structure = kStalledStructure;
    playlist.revision = kStalledStructure;
    return playlist;
}

}  // namespace

TEST_CASE("GET /api/state says the main thread is answering while it runs each check") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    MainThreadWatch watch(queue);
    const TestServer server(servingSettings(), watching(watch));

    const auto first = poll(server);
    REQUIRE(first.status == 200);
    CHECK(first.mainThread == json{{"answering", true}, {"unansweredSeconds", nullptr}});

    mainThread.pump();
    server.advanceClock(kMainThreadStalledAfter * 2);

    CHECK(poll(server, first.tag).status == 304);
}

TEST_CASE("a stall moves GET /api/state's validator as it starts and again as it ends") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    MainThreadWatch watch(queue);
    const TestServer server(servingSettings(), watching(watch));

    const auto healthy = poll(server);
    REQUIRE(healthy.status == 200);

    server.advanceClock(kMainThreadStalledAfter);
    const auto stalled = poll(server, healthy.tag);
    REQUIRE(stalled.status == 200);
    CHECK(stalled.tag != healthy.tag);
    CHECK(stalled.mainThread["answering"] == false);
    CHECK(stalled.mainThread["unansweredSeconds"].get<double>() ==
          doctest::Approx(std::chrono::duration<double>(kMainThreadStalledAfter).count()));

    // A stall going on is one change, not one per poll: a client holding it revalidates for free.
    server.advanceClock(kMainThreadCheckInterval);
    CHECK(poll(server, stalled.tag).status == 304);

    mainThread.pump();
    const auto recovered = poll(server, stalled.tag);
    REQUIRE(recovered.status == 200);
    CHECK(recovered.tag != stalled.tag);
    CHECK(recovered.mainThread == json{{"answering", true}, {"unansweredSeconds", nullptr}});
}

TEST_CASE("a server with no main thread to check reports one answering") {
    const TestServer server;

    const auto answer = poll(server);
    REQUIRE(answer.status == 200);
    CHECK(answer.mainThread == json{{"answering", true}, {"unansweredSeconds", nullptr}});
}

TEST_CASE("a question is answered while the main thread is stalled, and posts nothing to it") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    MainThreadWatch watch(queue);
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), watching(watch), &library);

    REQUIRE(poll(server).status == 200);
    server.advanceClock(kMainThreadStalledAfter);
    const auto stalled = poll(server);
    REQUIRE(stalled.status == 200);
    REQUIRE(stalled.mainThread["answering"] == false);
    const size_t postedBefore = mainThread.postedCount();

    const std::string search =
        "/api/library/search?query=a&limit=8&entityLimit=3&splitsCredits=true&title=%25title%25";
    for (const std::string& question :
         {std::string("/api/library/genre?name=Rock&title=%25title%25"), search}) {
        INFO("question: ", question);
        const auto answer = get(server, question);
        REQUIRE(answer);
        CHECK(answer->status == 200);
        CHECK(json::parse(answer->body).at("structure") == library.state().structure);
    }
    CHECK(mainThread.postedCount() == postedBefore);
}

// The main thread runs the one job a find may post, the copy of the playlist's handles, and then
// stops: a find that went back to it for a page of rows or a row's columns waits there until
// kStalledAnswerTimeout and answers 504.
TEST_CASE(
    "a find is answered while the main thread is stalled but for its one copy of the playlist") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls(), kStalledAnswerTimeout);
    Library library;
    buildLibrary(library);
    FakePlayer foobar(&library);
    foobar.add(stalledPlaylist(), {libraryTrack(3), titled("Dragged in"), libraryTrack(1),
                                   titled("Another track dragged in")});
    const TestServer server(servingSettings(), readingOnMainThread(queue, foobar.player()),
                            &library);

    std::thread runsOneJob([&mainThread] {
        if (eventually([&mainThread] { return mainThread.postedCount() > 0; }))
            mainThread.pump();
    });
    const auto answer =
        get(server, std::string("/api/playlists/") + kStalledPlaylistId +
                        "/find?query=track&structure=" + std::to_string(kStalledStructure) +
                        "&title=%25title%25");
    runsOneJob.join();

    REQUIRE(answer);
    CHECK(answer->status == 200);
    const SelectionResult matched = decodeSelection(json::parse(answer->body).at("matched"), 4);
    REQUIRE(matched.ok());
    CHECK(matched.ordinals == std::vector<uint32_t>{0, 2, 3});
    CHECK(mainThread.postedCount() == 1);
    CHECK(foobar.count(Call::readTracks) == 1);
}
