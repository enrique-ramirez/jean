// The playlist routes over a real socket, the autoplaylists and the two fills. playlists_test.cpp
// covers the decisions behind them; what these add is that a refused request never reaches the
// player at all, and what a route asked of the player when it did.

#include "third_party/doctest.h"

#include "core/library.h"
#include "core/settings.h"
#include "support/fake_player.h"
#include "support/keys.h"
#include "support/log_capture.h"
#include "support/spec.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cstdint>
#include <functional>
#include <iterator>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

// Every structure generation and content revision below is nineteen digits, because a playlist's
// two counters are seeded so that neither repeats across a restart of this component and a live
// one reads 3539374692803743171. A JSON number is an IEEE 754 double and exact only to 2^53, so
// each of these, and every value within five hundred of it, parses to kThroughADouble. A case at
// five digits passes whether the field is a number or a run of digits and says nothing.
constexpr uint64_t kThroughADouble = 9204739866101318656ULL;

constexpr uint64_t kRockStructure = 9204739866101318907ULL;
constexpr uint64_t kRockRevision = 9204739866101318919ULL;

constexpr uint64_t kOrdinaryStructure = 9204739866101318904ULL;
constexpr uint64_t kOrdinaryRevision = 9204739866101318902ULL;

constexpr uint64_t kRowsStructure = 9204739866101318923ULL;
constexpr uint64_t kRowsRevision = 9204739866101318977ULL;

constexpr char kCreate[] = R"({"title": "#Jean Rock", "query": "%genre% IS Rock"})";

PlaylistAnnotation rock() {
    AutoPlaylistSpec spec;
    spec.key = "folder:genre:Rock";
    spec.query = "%genre% IS Rock";

    PlaylistAnnotation playlist;
    playlist.id = kPlaylistId;
    playlist.index = 2;
    playlist.title = "#Jean Rock";
    playlist.itemCount = 412;
    playlist.isAutoPlaylist = true;
    playlist.structure = kRockStructure;
    playlist.revision = kRockRevision;
    playlist.managed = spec;
    return playlist;
}

constexpr int kRockMatches = 412;

// The media library generation a preview's ordinals are counted in. Past 2^32, so a field
// narrowed to 32 bits on the way out is caught, and inside 2^53, since GET /state's
// library.structure travels as a JSON number and this is the same value.
constexpr uint64_t kPreviewedStructure = 4294967337ULL;

// Fewer than kRockMatches: a match the snapshot does not hold is left out.
const std::vector<uint32_t>& rockOrdinals() {
    static const std::vector<uint32_t> ordinals = {12, 13, 407};
    return ordinals;
}

// The autoplaylist this component made, and the answers foobar2000 gives a preview of its query
// and of one it cannot parse.
void holdingAnAutoPlaylist(FakePlayer& player) {
    player.add(rock());

    PreviewResult matching;
    matching.valid = true;
    matching.matches = kRockMatches;
    matching.libraryEnabled = true;
    matching.structure = kPreviewedStructure;
    matching.ordinals = rockOrdinals();
    player.answerPreview("%genre% IS Rock", matching);

    PreviewResult unparsed;
    unparsed.error = "Query syntax error";
    unparsed.libraryEnabled = true;
    player.answerPreview("bad", unparsed);
}

json capabilitiesUnder(const Settings& settings) {
    return capabilitiesOf(TestServer(settings));
}

json capabilitiesReporting(std::vector<std::string> orders) {
    Player player = servingPlayer();
    player.report.playbackOrders = std::move(orders);

    return capabilitiesOf(TestServer(servingSettings(), player));
}

// Three of the playback orders a stock foobar2000 reports, out of its own listing order so that
// the list a client draws can be told from a list built by walking a table of names. The whole
// set, and the Jean name each order carries, is pinned in tests/playback_modes_test.cpp; these
// cases are about which of them an install can offer, which is the other question.
const std::vector<std::string>& reportedOrders() {
    static const std::vector<std::string> orders = {"Shuffle (albums)", "Default",
                                                    "Repeat (track)"};
    return orders;
}

const std::vector<std::string>& offeredModes() {
    static const std::vector<std::string> modes = {"shuffleAlbums", "inOrder", "repeatOne"};
    return modes;
}

// foobar2000's playback orders are extensible, so a component can register one this component
// has never seen.
constexpr char kOrderAddedByAComponent[] = "Shuffle (artists)";

constexpr char kScratchPlaylistId[] = "11111111-1111-1111-1111-111111111111";

constexpr char kScratchTitle[] = "#Jean Scratch";

constexpr char kScratchFill[] = "/api/playlists/own/scratch/items";

// The route the queue's holding playlist answered on, kept so that a client still sending it
// can be driven at.
constexpr char kQueueFill[] = "/api/playlists/own/queue/items";

std::string userFill() {
    return std::string("/api/playlists/") + kPlaylistId + "/items";
}

constexpr char kSecondPlaylistId[] = "22222222-2222-2222-2222-222222222222";
constexpr char kThirdPlaylistId[] = "55555555-5555-5555-5555-555555555555";
constexpr char kUnknownPlaylistId[] = "66666666-6666-6666-6666-666666666666";

// An autoplaylist this component made, for the writes that address one beside the playlists
// every other write addresses.
constexpr char kAutoPlaylistId[] = "77777777-7777-7777-7777-777777777777";

constexpr char kForeignAutoPlaylistId[] = "88888888-8888-8888-8888-888888888888";

// An autoplaylist made in foobar2000 or by another component: an autoplaylist, holding rows, and
// no record of this component's.
PlaylistAnnotation foreignAutoPlaylist() {
    PlaylistAnnotation playlist;
    playlist.id = kForeignAutoPlaylistId;
    playlist.title = "Made at the player";
    playlist.isAutoPlaylist = true;
    playlist.structure = kOrdinaryStructure;
    playlist.revision = kOrdinaryRevision;
    return playlist;
}

std::string autoPlaylistPath(const std::string& id) {
    return std::string("/api/autoplaylists/") + id;
}

PlaylistAnnotation ordinary() {
    PlaylistAnnotation playlist;
    playlist.id = kSecondPlaylistId;
    playlist.index = 3;
    playlist.title = "Ordinary playlist";
    playlist.itemCount = 3;
    playlist.structure = kOrdinaryStructure;
    playlist.revision = kOrdinaryRevision;
    return playlist;
}

PlaylistAnnotation userPlaylist(const std::string& id, const std::string& title,
                                uint64_t structure) {
    PlaylistAnnotation playlist;
    playlist.id = id;
    playlist.title = title;
    playlist.structure = structure;
    playlist.revision = kRowsRevision;
    return playlist;
}

// The scratch under a title a user could have given a playlist of their own, so a route that
// found it by title rather than by the role it reports is caught doing so.
PlaylistAnnotation scratchEntry() {
    auto playlist = userPlaylist(kScratchPlaylistId, "Saturday", kRowsStructure);
    playlist.role = OwnPlaylistRole::scratch;
    return playlist;
}

const std::vector<std::string>& alreadyHeld() {
    static const std::vector<std::string> titles = {"Held A", "Held B", "Held C", "Held D",
                                                    "Held E"};
    return titles;
}

// The two playlists a fill can land in, each already holding rows so that a fill appending is
// told from one replacing, and a position from a count starting at zero.
void holdingForAFill(FakePlayer& player) {
    player.add(scratchEntry(), titledRows(alreadyHeld()));
    player.add(userPlaylist(kPlaylistId, "Road trip", kRowsStructure), titledRows(alreadyHeld()));
}

std::string ownBody(const std::string& title, uint64_t structure) {
    return R"({"title": ")" + title + R"(", "structure": )" + std::to_string(structure) +
           R"(, "ordinals": [3, 1]})";
}

std::string userBody(uint64_t structure) {
    return R"({"structure": )" + std::to_string(structure) + R"(, "ordinals": [3, 1]})";
}

std::vector<std::string> theFilledTracks() {
    return {builtTrackTitle(3), builtTrackTitle(1)};
}

constexpr uint64_t kUnresolvableStructure = 1;

struct Target {
    std::string name;
    std::string path;
    std::string body;
    bool replaces;
    std::string id;
};

std::vector<Target> targets(uint64_t structure) {
    return {{"the scratch role", kScratchFill, ownBody(kScratchTitle, structure), true,
             kScratchPlaylistId},
            {"a user's playlist", userFill(), userBody(structure), false, kPlaylistId}};
}

// What a fill of theFilledTracks leaves a target holdingForAFill seeded: the tracks alone where
// the target is emptied first, and after the rows it held where it is appended to.
std::vector<std::string> filled(const Target& target) {
    auto titles = target.replaces ? std::vector<std::string>{} : alreadyHeld();
    const auto tracks = theFilledTracks();
    titles.insert(titles.end(), tracks.begin(), tracks.end());
    return titles;
}

Settings readOnlyPlaylists() {
    auto settings = servingSettings();
    settings.writePlaylists = false;
    return settings;
}

std::string titleOf(const TestServer& server, const std::string& id) {
    const auto response = server.client().Get("/api/playlists");
    REQUIRE(response);

    const auto body = json::parse(response->body);
    const auto& playlists = body["playlists"];
    const auto found = std::find_if(playlists.begin(), playlists.end(),
                                    [&id](const json& playlist) { return playlist["id"] == id; });

    if (found == playlists.end())
        return {};

    return found->at("title").get<std::string>();
}

std::vector<json> foundByRole(const TestServer& server) {
    const auto response = server.client().Get("/api/playlists");
    REQUIRE(response);

    const auto body = json::parse(response->body);

    std::vector<json> scratch;
    for (const auto& playlist : body.at("playlists"))
        if (playlist.at("role") == "scratch")
            scratch.push_back(playlist);

    return scratch;
}

constexpr std::string_view kJeanPrefix = "#Jean";

std::string withField(const std::string& body, const std::string& field, const json& value) {
    auto document = json::parse(body);
    document[field] = value;
    return document.dump();
}

std::string naming(const std::string& body, const json& set) {
    auto document = json::parse(body);
    document.erase("ordinals");
    document.update(set);
    return document.dump();
}

std::vector<Target> appendTargets(uint64_t structure, const json& set) {
    auto all = targets(structure);

    all.erase(std::remove_if(all.begin(), all.end(),
                             [](const Target& target) { return target.replaces; }),
              all.end());

    for (auto& target : all)
        target.body = naming(target.body, set);

    return all;
}

// Answered by value and not as a const reference: nlohmann's const operator[] asserts on a key that
// is not there, so a field the route left out would abort the run rather than fail an assertion
// naming it.
json entryFor(const json& body, const std::string& id) {
    const auto& playlists = body.at("playlists");
    const auto found = std::find_if(playlists.begin(), playlists.end(),
                                    [&id](const json& playlist) { return playlist["id"] == id; });

    REQUIRE(found != playlists.end());
    return *found;
}

// A structure generation or a content revision, read the one way a client may read one. Asserted
// rather than converted: a number here is the defect this whole file is about, and it has to fail
// as an assertion rather than as a type error out of the JSON library.
std::string counterIn(const json& document, const std::string& field) {
    REQUIRE(document.contains(field));

    const auto& value = document.at(field);
    INFO(field, " on the wire: ", value.dump());
    REQUIRE(value.is_string());

    return value.get<std::string>();
}

// The JSON text of a field rather than its value, so a failure names the type it arrived as: a
// number prints bare where a run of digits prints in quotes.
std::string wireValue(const json& document, const std::string& field) {
    REQUIRE(document.contains(field));
    return document.at(field).dump();
}

std::string asDigits(uint64_t counter) {
    return "\"" + std::to_string(counter) + "\"";
}

constexpr char kLibraryFolder[] = "Fictional Artist/Imaginary Album/";

FakeRow libraryRow(const std::string& title, const std::string& file, uint32_t subsong = 0) {
    FakeRow row;
    row.fields = {{"%title%", title}, {"%artist%", "Fictional Artist"}};
    row.libraryPath = kLibraryFolder + file;
    row.subsong = subsong;
    return row;
}

FakeRow strayRow(const std::string& title, uint32_t subsong = 0) {
    FakeRow row;
    row.fields = {{"%title%", title}, {"%artist%", "Somebody Else"}};
    row.subsong = subsong;
    return row;
}

constexpr uint32_t kStrayRow = 2;

std::vector<FakeRow> playlistRows() {
    return {libraryRow("First", "01.flac"), libraryRow("Second", "02.flac"), strayRow("Dragged in"),
            libraryRow("Fourth", "04.flac"), libraryRow("Fifth", "05.flac")};
}

// One file holding several tracks, which is a cue sheet or a disc image: every row of it resolves
// to the same library path, so the subsong is the whole of what tells two of them apart.
constexpr char kCueFile[] = "03 The Whole Set.flac";
constexpr uint32_t kStraySubsong = 4;

std::vector<FakeRow> cueSheetRows() {
    return {libraryRow("Opening", kCueFile, 1), libraryRow("Second Movement", kCueFile, 2),
            strayRow("A disc image dragged in", kStraySubsong)};
}

std::map<uint32_t, FakeRow> changedCueSheetRows() {
    return {{0, libraryRow("Opening, five stars", kCueFile, 1)},
            {1, libraryRow("Second Movement, five stars", kCueFile, 2)},
            {kStrayRow, strayRow("A disc image dragged in, five stars", kStraySubsong)}};
}

void holdingRows(FakePlayer& player, std::vector<FakeRow> rows = playlistRows()) {
    player.add(userPlaylist(kPlaylistId, "Road trip", kRowsStructure), std::move(rows));
}

std::string encoded(const std::string& column) {
    std::string escaped;
    for (const char character : column)
        escaped += character == '%' ? "%25" : std::string(1, character);

    return escaped;
}

std::string itemsPath(const std::string& id, size_t offset, size_t count,
                      const std::vector<std::string>& columns) {
    auto path = "/api/playlists/" + id + "/items?offset=" + std::to_string(offset) +
                "&count=" + std::to_string(count);

    for (const auto& column : columns)
        path += "&columns=" + encoded(column);

    return path;
}

json pageOf(const TestServer& server, const std::string& id, size_t offset, size_t count,
            const std::vector<std::string>& columns) {
    const auto response = get(server, itemsPath(id, offset, count, columns));

    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

json titlesIn(const json& page) {
    json titles = json::array();
    for (const auto& item : page.at("items"))
        titles.push_back(item.at("columns").at(0));

    return titles;
}

std::map<uint32_t, FakeRow> changedRows() {
    return {{1, libraryRow("Second, five stars", "02.flac")},
            {kStrayRow, strayRow("Dragged in, five stars")}};
}

// Two of the three carry one artist and all three carry different titles, so one response holds a
// column whose values repeat across changed rows beside a column whose values do not.
std::map<uint32_t, FakeRow> rowsSharingAnArtist() {
    return {{1, libraryRow("Second, five stars", "02.flac")},
            {kStrayRow, strayRow("Dragged in, five stars")},
            {3, libraryRow("Fourth, five stars", "04.flac")}};
}

constexpr uint64_t kChangedSince = kRowsRevision - 1;
constexpr uint64_t kOldestRetained = kRowsRevision - 2;

// playlistRows() read at kChangedSince, then retagged at the player, which moves the playlist's
// revision on to kRowsRevision.
void holdingChangedRows(FakePlayer& player,
                        const std::map<uint32_t, FakeRow>& changed = changedRows()) {
    auto entry = userPlaylist(kPlaylistId, "Road trip", kRowsStructure);
    entry.revision = kChangedSince;

    player.add(entry, playlistRows());
    player.retag(kPlaylistId, changed);
    player.retainRevisionsFrom(kPlaylistId, kOldestRetained);
}

std::string changesPath(const std::string& id, const std::string& structure,
                        const std::string& since, const std::vector<std::string>& columns) {
    auto path =
        "/api/playlists/" + id + "/items/changes?structure=" + structure + "&since=" + since;

    for (const auto& column : columns)
        path += "&columns=" + encoded(column);

    return path;
}

std::string changesPath(const std::string& id, uint64_t structure, uint64_t since,
                        const std::vector<std::string>& columns) {
    return changesPath(id, std::to_string(structure), std::to_string(since), columns);
}

json deltaOf(const TestServer& server, uint64_t since, const std::vector<std::string>& columns) {
    const auto response = get(server, changesPath(kPlaylistId, kRowsStructure, since, columns));

    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

json dictionariesIn(const json& delta) {
    REQUIRE(delta.contains("columns"));
    return delta.at("columns");
}

// `text` promises the values a column takes and no order, so a case about which column a
// dictionary belongs to reads it as a set.
std::set<std::string> valuesIn(const json& dictionary) {
    REQUIRE(dictionary.contains("text"));

    std::set<std::string> values;
    for (const auto& value : dictionary.at("text"))
        values.insert(value.get<std::string>());

    return values;
}

// A changed row does not carry its own values: the response carries one dictionary per declared
// column, and a row's value in each is the entry its id names.
json columnsAt(const json& delta, size_t row) {
    json values = json::array();
    for (const auto& dictionary : dictionariesIn(delta)) {
        REQUIRE(dictionary.contains("text"));
        REQUIRE(dictionary.contains("ids"));
        REQUIRE(dictionary.at("ids").size() == delta.at("items").size());

        const auto id = dictionary.at("ids").at(row).get<size_t>();
        REQUIRE(id < dictionary.at("text").size());
        values.push_back(dictionary.at("text").at(id));
    }

    return values;
}

std::map<uint32_t, json> byPosition(const json& delta) {
    REQUIRE(delta.contains("items"));

    std::map<uint32_t, json> rows;
    for (size_t at = 0; at < delta.at("items").size(); ++at) {
        auto item = delta.at("items").at(at);
        INFO("row: ", item.dump());
        REQUIRE(item.contains("position"));

        item["columns"] = columnsAt(delta, at);
        rows.emplace(item.at("position").get<uint32_t>(), std::move(item));
    }

    return rows;
}

json patchedTitles(const json& delta) {
    json patched = json::object();
    for (const auto& [position, row] : byPosition(delta))
        patched[std::to_string(position)] = row.at("columns").at(0);

    return patched;
}

std::string playPath(const std::string& id, const std::string& index) {
    return "/api/playlists/" + id + "/items/" + index + "/play";
}

void checkRefused(const TestServer& server, const std::string& path, int status) {
    const auto response = get(server, path);

    REQUIRE(response);
    CHECK(response->status == status);
    CHECK(json::parse(response->body)["error"].is_string());
}

constexpr char kCreatePlaylist[] = "/api/playlists";

constexpr char kNewTitle[] = "Road trip";

constexpr char kSourceField[] = "source";

std::vector<std::string> rockTitles() {
    return {"Rock A", "Rock B", "Rock C", "Rock D", "Rock E"};
}

// rock() holding rows a create can take a source's positions from, beside a playlist of the
// user's.
void holdingForACreate(FakePlayer& player) {
    player.add(rock(), titledRows(rockTitles()));
    player.add(ordinary());
}

std::string createBody(const json& set = json::object()) {
    json body{{"title", kNewTitle}};
    body.update(set);
    return body.dump();
}

json listingOf(const TestServer& server) {
    const auto response = server.client().Get("/api/playlists");

    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

std::vector<std::string> idsIn(const json& body) {
    const auto& playlists = body.at("playlists");

    std::vector<std::string> ids;
    std::transform(playlists.begin(), playlists.end(), std::back_inserter(ids),
                   [](const json& playlist) { return playlist.at("id").get<std::string>(); });
    return ids;
}

constexpr char kMoveIndexField[] = "index";

std::string playlistPath(const std::string& id) {
    return "/api/playlists/" + id;
}

std::string movePath(const std::string& id) {
    return playlistPath(id) + "/move";
}

std::string renameBody(const std::string& title) {
    return json{{"title", title}}.dump();
}

std::string moveBody(uint32_t index) {
    return json{{kMoveIndexField, index}}.dump();
}

// Three, and in the player's own order, so a move reads back as an order rather than as a swap:
// two playlists reverse the same either way round.
void holdingThreePlaylists(FakePlayer& player) {
    auto third = ordinary();
    third.id = kThirdPlaylistId;
    third.title = "Third playlist";

    player.add(rock());
    player.add(ordinary());
    player.add(third);
}

// Every call this component can make against the play queue, whichever one it was.
int queueCalls(const FakePlayer& player) {
    int calls = 0;
    for (const auto call : {Call::readQueue, Call::queueRows, Call::queueTracks,
                            Call::moveQueueEntry, Call::removeQueueEntry, Call::clearQueue})
        calls += player.count(call);
    return calls;
}

struct Edit {
    std::string name;
    std::function<httplib::Result(const TestServer&, const std::string& id)> send;
    Call call;
};

// The three edits that address a playlist by its GUID rather than by its rows.
std::vector<Edit> playlistEdits() {
    return {{"renaming",
             [](const TestServer& server, const std::string& id) {
                 return post(server, playlistPath(id), renameBody(kNewTitle));
             },
             Call::renamePlaylist},
            {"deleting",
             [](const TestServer& server, const std::string& id) {
                 return server.client().Delete(playlistPath(id));
             },
             Call::removePlaylist},
            {"moving",
             [](const TestServer& server, const std::string& id) {
                 return post(server, movePath(id), moveBody(0));
             },
             Call::movePlaylist}};
}

// The two routes that address an autoplaylist by its GUID. The update carries a title, so taking
// a playlist over is seen in its name as well as in its kind.
std::vector<Edit> autoPlaylistEdits() {
    return {{"updating an autoplaylist",
             [](const TestServer& server, const std::string& id) {
                 return post(server, autoPlaylistPath(id),
                             R"({"title": "Taken over", "query": "%genre% IS Jazz"})");
             },
             Call::updateAutoPlaylist},
            {"deleting an autoplaylist",
             [](const TestServer& server, const std::string& id) {
                 return server.client().Delete(autoPlaylistPath(id));
             },
             Call::removeAutoPlaylist}};
}

// Far enough from the target's that a copy answering the source playlist's generation, or the
// library's, is visible rather than equal by luck.
constexpr uint64_t kSourceStructure = kRowsStructure + 100;

std::vector<std::string> roadTripTitles() {
    return {"First", "Second", "Third", "Fourth"};
}

std::vector<std::string> sourceTitles() {
    return {"Source A", "Source B", "Source C", "Source D", "Source E"};
}

// The rows two playlists hold, by title, so a copy and a removal read back off the rows route the
// way a client reads them.
void holdingTwoPlaylists(FakePlayer& player) {
    player.add(userPlaylist(kPlaylistId, "Road trip", kRowsStructure),
               titledRows(roadTripTitles()));
    player.add(userPlaylist(kSecondPlaylistId, "Everything", kSourceStructure),
               titledRows(sourceTitles()));
}

void holdingTheScratch(FakePlayer& player) {
    player.add(scratchEntry(),
               titledRows({"Result A", "Result B", "Result C", "Result D", "Result E"}));
}

std::string copyPath(const std::string& id) {
    return "/api/playlists/" + id + "/items/copy";
}

std::string removeRowsPath(const std::string& id) {
    return "/api/playlists/" + id + "/items/remove";
}

json copyBody(const std::string& sourceId, const json& runs) {
    return json{{kSourceField, sourceId}, {"runs", runs}};
}

json removeRowsBody(uint64_t structure, const json& runs) {
    return json{{"structure", std::to_string(structure)}, {"runs", runs}};
}

std::string moveRowsPath(const std::string& id) {
    return "/api/playlists/" + id + "/items/move";
}

std::string sortRowsPath(const std::string& id) {
    return "/api/playlists/" + id + "/items/sort";
}

json moveRowsBody(uint64_t structure, const json& set, uint32_t to) {
    json body{{"structure", std::to_string(structure)}, {"to", to}};
    body.update(set);
    return body;
}

json sortRowsBody(uint64_t structure, const std::string& pattern) {
    return json{{"structure", std::to_string(structure)}, {"pattern", pattern}};
}

json firstTwoRows() {
    return json{{"runs", json::array({json::array({0, 2})})}};
}

// contract/openapi.yaml's bound on SortPlaylistRowsRequest.pattern.
constexpr size_t kLongestPattern = 4096;

// A removal names the playlist's own generation, as a run of decimal digits. A fill names the
// media library's, which is a number: withStructure below is the fill's builder and the two are
// no longer interchangeable.
json withGeneration(const json& set, uint64_t structure) {
    json body{{"structure", std::to_string(structure)}};
    body.update(set);
    return body;
}

json withStructure(const json& set, uint64_t structure) {
    json body{{"structure", structure}};
    body.update(set);
    return body;
}

// Named descending, so an answer in the order the runs were given is told from an ascending one.
json unorderedRuns() {
    return json::array({json::array({3, 1}), json::array({0, 2})});
}

constexpr size_t kEveryHeldRow = 64;

json heldTitles(const TestServer& server, const std::string& id) {
    return titlesIn(pageOf(server, id, 0, kEveryHeldRow, {"%title%"}));
}

std::string generationOf(const TestServer& server, const std::string& id) {
    return counterIn(entryFor(listingOf(server), id), "structure");
}

// What a client sends after reading the listing, for a write driven more than once against one
// server. A server with no player lists nothing, and any run of digits does there, since that
// request is refused before its generation is weighed.
uint64_t generationToSend(const TestServer& server, const std::string& id) {
    const auto response = server.client().Get("/api/playlists");
    if (!response || response->status != 200)
        return 0;

    return std::stoull(generationOf(server, id));
}

struct RowEdit {
    std::string name;
    std::function<httplib::Result(const TestServer&, const std::string& id)> send;
    Call call;
};

std::vector<RowEdit> rowEdits() {
    return {
        {"copying rows in",
         [](const TestServer& server, const std::string& id) {
             return post(server, copyPath(id), copyBody(kSecondPlaylistId, unorderedRuns()).dump());
         },
         Call::copyRows},
        {"removing rows",
         [](const TestServer& server, const std::string& id) {
             return post(server, removeRowsPath(id),
                         removeRowsBody(kRowsStructure, unorderedRuns()).dump());
         },
         Call::removeRows},
        {"moving rows",
         [](const TestServer& server, const std::string& id) {
             return post(server, moveRowsPath(id),
                         moveRowsBody(kRowsStructure, json{{"runs", unorderedRuns()}}, 1).dump());
         },
         Call::moveRows},
        {"sorting rows",
         [](const TestServer& server, const std::string& id) {
             return post(server, sortRowsPath(id), sortRowsBody(kRowsStructure, "%title%").dump());
         },
         Call::sortRows}};
}

struct Write {
    std::string name;
    std::function<httplib::Result(const TestServer&)> send;

    // 200 where the route answers a document and 204 where it answers none. Which of the two
    // each route sends is settled by that route's own case.
    int whenAccepted = 200;
};

// Every write writePlaylists can refuse. kAutoPlaylistId is an autoplaylist this component made,
// so the update and the delete of one are aimed at its own records rather than at a stranger's
// playlist. The setting still refuses them: what it exempts is the scratch, which holds no music
// of the user's, and an autoplaylist holds theirs.
//
// The list is driven in order against one server, so the three playlist edits take a playlist
// each and the copy runs before the removal that shortens the playlist it reads from. The move and
// the sort read the generation they send, since each moves it on.
std::vector<Write> playlistWrites(uint64_t structure) {
    return {
        {"creating an autoplaylist",
         [](const TestServer& server) { return post(server, "/api/autoplaylists", kCreate); }},
        {"updating an autoplaylist",
         [](const TestServer& server) {
             return post(server, std::string("/api/autoplaylists/") + kAutoPlaylistId,
                         R"({"query": "%genre% IS Jazz"})");
         }},
        {"deleting an autoplaylist",
         [](const TestServer& server) {
             return server.client().Delete(std::string("/api/autoplaylists/") + kAutoPlaylistId);
         }},
        {"moving rows within a playlist",
         [](const TestServer& server) {
             return post(
                 server, moveRowsPath(kPlaylistId),
                 moveRowsBody(generationToSend(server, kPlaylistId), firstTwoRows(), 2).dump());
         }},
        {"sorting a playlist",
         [](const TestServer& server) {
             return post(server, sortRowsPath(kPlaylistId),
                         sortRowsBody(generationToSend(server, kPlaylistId), "%title%").dump());
         }},
        {"filling a playlist a user owns, which is what addTo does",
         [structure](const TestServer& server) {
             return post(server, userFill(), userBody(structure));
         }},
        {"creating a playlist",
         [](const TestServer& server) { return post(server, kCreatePlaylist, createBody()); }},
        {"renaming a playlist",
         [](const TestServer& server) {
             return post(server, playlistPath(kPlaylistId), renameBody(kNewTitle));
         },
         204},
        {"moving a playlist",
         [](const TestServer& server) {
             return post(server, movePath(kSecondPlaylistId), moveBody(0));
         },
         204},
        {"deleting a playlist",
         [](const TestServer& server) {
             return server.client().Delete(playlistPath(kThirdPlaylistId));
         },
         204},
        {"copying rows into a playlist",
         [](const TestServer& server) {
             return post(server, copyPath(kPlaylistId),
                         copyBody(kSecondPlaylistId, unorderedRuns()).dump());
         }},
        {"removing rows from a playlist", [](const TestServer& server) {
             return post(server, removeRowsPath(kSecondPlaylistId),
                         removeRowsBody(kSourceStructure, unorderedRuns()).dump());
         }}};
}

// Every playlist playlistWrites addresses, beside the scratch.
void holdingEveryWriteTarget(FakePlayer& player) {
    auto autoPlaylist = rock();
    autoPlaylist.id = kAutoPlaylistId;
    autoPlaylist.managed->key = "folder:genre:Jazz";
    player.add(autoPlaylist);

    holdingTwoPlaylists(player);
    player.add(userPlaylist(kThirdPlaylistId, "Third playlist", kOrdinaryStructure));
    player.add(scratchEntry());
}

std::vector<Write> playlistAndRowWrites() {
    const std::set<std::string> kept{"creating a playlist",
                                     "renaming a playlist",
                                     "moving a playlist",
                                     "deleting a playlist",
                                     "copying rows into a playlist",
                                     "removing rows from a playlist",
                                     "moving rows within a playlist",
                                     "sorting a playlist"};

    auto writes = playlistWrites(0);
    writes.erase(std::remove_if(writes.begin(), writes.end(),
                                [&kept](const Write& write) { return !kept.contains(write.name); }),
                 writes.end());

    REQUIRE(writes.size() == kept.size());
    return writes;
}

// With writePlaylists on, the role is the only thing that can refuse these, so the message names
// it. With the setting off, whether the setting or the role answers first is nothing the client
// can depend on and nothing this asks about. Reusing another refusal's message is what it catches:
// the scratch is refused for being the component's own and for nothing else.
void namesTheRole(const httplib::Response& response, bool writePlaylists) {
    if (!writePlaylists)
        return;

    CHECK(errorOf(response) == describe(PlayerOutcome::ownPlaylist));
}

// foobar2000's playlist_lock carries a filter bit per edit, and these are the writes one can
// refuse: renaming, removing the playlist, adding rows, removing them and reordering them, which a
// move and a sort of the rows both are. A create makes a playlist nothing has locked yet, and
// moving one within the list is announced to a lock rather than filtered by it.
std::vector<Write> lockableWrites() {
    return {{"renaming a playlist",
             [](const TestServer& server) {
                 return post(server, playlistPath(kPlaylistId), renameBody(kNewTitle));
             }},
            {"deleting a playlist",
             [](const TestServer& server) {
                 return server.client().Delete(playlistPath(kPlaylistId));
             }},
            {"copying rows into a playlist",
             [](const TestServer& server) {
                 return post(server, copyPath(kPlaylistId),
                             copyBody(kSecondPlaylistId, unorderedRuns()).dump());
             }},
            {"removing rows from a playlist",
             [](const TestServer& server) {
                 return post(server, removeRowsPath(kPlaylistId),
                             removeRowsBody(kRowsStructure, unorderedRuns()).dump());
             }},
            {"moving rows within a playlist",
             [](const TestServer& server) {
                 return post(server, moveRowsPath(kPlaylistId),
                             moveRowsBody(kRowsStructure, firstTwoRows(), 2).dump());
             }},
            {"sorting a playlist", [](const TestServer& server) {
                 return post(server, sortRowsPath(kPlaylistId),
                             sortRowsBody(kRowsStructure, "%title%").dump());
             }}};
}

}  // namespace

TEST_CASE("GET /api/playlists answers each playlist by everything a client draws it from") {
    const TestServer server(servingSettings(), TestServer::listing([] {
                                return PlaylistsResult{PlayerOutcome::done, {rock(), ordinary()}};
                            }));

    const auto response = server.client().Get("/api/playlists");

    REQUIRE(response);
    CHECK(response->status == 200);

    const auto body = json::parse(response->body);
    REQUIRE(body["playlists"].size() == 2);

    CHECK(body["playlists"][0]["id"] == kPlaylistId);
    CHECK(body["playlists"][1]["id"] == kSecondPlaylistId);

    auto first = entryFor(body, kPlaylistId);
    CHECK(first["index"] == 2);
    CHECK(first["title"] == "#Jean Rock");
    CHECK(first["itemCount"] == 412);
    CHECK(first["isAutoPlaylist"] == true);
    CHECK(wireValue(first, "structure") == asDigits(kRockStructure));
    CHECK(wireValue(first, "revision") == asDigits(kRockRevision));
    CHECK(first["managed"]["key"] == "folder:genre:Rock");

    auto second = entryFor(body, kSecondPlaylistId);
    CHECK(second["index"] == 3);
    CHECK(second["title"] == "Ordinary playlist");
    CHECK(second["itemCount"] == 3);
    CHECK(second["isAutoPlaylist"] == false);
    CHECK(wireValue(second, "structure") == asDigits(kOrdinaryStructure));
    CHECK(wireValue(second, "revision") == asDigits(kOrdinaryRevision));
    CHECK(second["managed"].is_null());
}

// The marker foobar2000 keeps on the playlist is what says which one is the scratch, so a title
// typed at the player decides nothing either way: the scratch is renamed here and the playlist
// beside it carries the title Jean gives its own.
TEST_CASE("the scratch answers its role however it and the playlists around it are titled") {
    const TestServer server(servingSettings(), TestServer::listing([] {
                                auto scratch = ordinary();
                                scratch.id = kScratchPlaylistId;
                                scratch.title = "Party mix";
                                scratch.role = OwnPlaylistRole::scratch;

                                auto titled = ordinary();
                                titled.title = kScratchTitle;

                                return PlaylistsResult{PlayerOutcome::done, {scratch, titled}};
                            }));

    const auto response = server.client().Get("/api/playlists");

    REQUIRE(response);
    const auto body = json::parse(response->body);

    auto renamed = entryFor(body, kScratchPlaylistId);
    CHECK(renamed["title"] == "Party mix");
    CHECK(renamed["role"] == "scratch");

    auto impostor = entryFor(body, kSecondPlaylistId);
    CHECK(impostor["title"] == kScratchTitle);
    CHECK(impostor["role"].is_null());
}

// Pinned as a set, because a field Jean does not read is one every client has to decide what to do
// with. Absence is null rather than omission, so a playlist with a role and one without answer the
// same shape.
TEST_CASE("a playlist carries these keys and no others") {
    const TestServer server(servingSettings(), TestServer::listing([] {
                                auto scratch = ordinary();
                                scratch.id = kScratchPlaylistId;
                                scratch.role = OwnPlaylistRole::scratch;

                                return PlaylistsResult{PlayerOutcome::done, {rock(), scratch}};
                            }));

    const auto response = server.client().Get("/api/playlists");

    REQUIRE(response);
    const auto body = json::parse(response->body);
    REQUIRE(body["playlists"].size() == 2);

    const auto keys = Keys{"id",   "index",     "title",    "itemCount", "isAutoPlaylist",
                           "role", "structure", "revision", "managed"};

    for (const auto& playlist : body["playlists"]) {
        INFO("playlist: ", playlist.dump());
        CHECK(keysOf(playlist) == keys);
    }
}

TEST_CASE(
    "a page of rows answers the columns the client asked for, in the order it asked for "
    "them") {
    FakePlayer foobar;
    holdingRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto page = pageOf(server, kPlaylistId, 0, 2, {"%artist%", "%title%"});
    const auto& items = page.at("items");
    REQUIRE(items.size() == 2);

    CHECK(items[0].at("columns") == json::array({"Fictional Artist", "First"}));
    CHECK(items[1].at("columns") == json::array({"Fictional Artist", "Second"}));

    const auto reversed = pageOf(server, kPlaylistId, 0, 1, {"%title%", "%artist%"});
    REQUIRE(reversed.at("items").size() == 1);
    CHECK(reversed.at("items")[0].at("columns") == json::array({"First", "Fictional Artist"}));
}

// A row's columns come off the handle the playlist holds rather than off a library record, so a
// file dragged in from outside the media library draws like every other row. This is the case a
// route reading the library snapshot instead passes for every playlist anybody tests it with.
TEST_CASE("a row the media library does not hold answers its columns like every other row") {
    FakePlayer foobar;
    holdingRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto page = pageOf(server, kPlaylistId, kStrayRow, 1, {"%title%", "%artist%"});
    const auto& items = page.at("items");
    REQUIRE(items.size() == 1);

    CHECK(items[0].at("columns") == json::array({"Dragged in", "Somebody Else"}));
}

// The library path is what a client asks GET /api/artwork for, so a row the library does not hold
// has to say so rather than carry a key that finds no cover.
TEST_CASE(
    "a row carries its library path where the media library holds the track and null where "
    "it does not") {
    FakePlayer foobar;
    holdingRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto page = pageOf(server, kPlaylistId, 0, playlistRows().size(), {"%title%"});
    const auto& items = page.at("items");
    REQUIRE(items.size() == playlistRows().size());

    for (const auto& item : items) {
        INFO("row: ", item.dump());
        REQUIRE(item.contains("libraryPath"));
    }

    CHECK(items[0].at("libraryPath") == std::string(kLibraryFolder) + "01.flac");
    CHECK(items[kStrayRow].at("libraryPath").is_null());
}

// Every track of a cue sheet shares one library path, so the subsong is the whole of what tells
// two of them apart. A client rating by the path alone reaches the first track of the file.
TEST_CASE("a row says which track inside its file it holds") {
    SUBCASE("two tracks of one cue sheet share a path and differ by subsong") {
        FakePlayer foobar;
        holdingRows(foobar, cueSheetRows());
        const TestServer server(servingSettings(), foobar.player());

        const auto page = pageOf(server, kPlaylistId, 0, 2, {"%title%"});
        const auto& items = page.at("items");
        REQUIRE(items.size() == 2);

        CHECK(items[0].at("libraryPath") == items[1].at("libraryPath"));
        CHECK(items[0].at("subsong") == 1);
        CHECK(items[1].at("subsong") == 2);
    }

    SUBCASE("an ordinary file is subsong zero") {
        FakePlayer foobar;
        holdingRows(foobar);
        const TestServer server(servingSettings(), foobar.player());

        const auto page = pageOf(server, kPlaylistId, 0, 1, {"%title%"});
        const auto& items = page.at("items");
        REQUIRE(items.size() == 1);

        CHECK(items[0].at("subsong") == 0);
    }
}

// The subsong comes off the handle the playlist holds rather than off a media library record, so a
// file dragged in from outside the library still says which of its tracks the row is. An
// implementation hanging the field off libraryPath answers zero here and looks right everywhere
// else.
TEST_CASE("a row the media library does not hold says which track inside its file it holds") {
    FakePlayer foobar;
    holdingRows(foobar, cueSheetRows());
    const TestServer server(servingSettings(), foobar.player());

    const auto page = pageOf(server, kPlaylistId, kStrayRow, 1, {"%title%"});
    const auto& items = page.at("items");
    REQUIRE(items.size() == 1);

    CHECK(items[0].at("libraryPath").is_null());
    CHECK(items[0].at("subsong") == kStraySubsong);
}

TEST_CASE("a page says how many rows the playlist holds and which versions it was read at") {
    FakePlayer foobar;
    holdingRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto page = pageOf(server, kPlaylistId, 1, 2, {"%title%"});

    CHECK(page.at("items").size() == 2);
    CHECK(page.at("totalCount") == playlistRows().size());
    CHECK(wireValue(page, "structure") == asDigits(kRowsStructure));
    CHECK(wireValue(page, "revision") == asDigits(kRowsRevision));
}

TEST_CASE("offset and count decide which of a playlist's rows a page holds") {
    FakePlayer foobar;
    holdingRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    SUBCASE("a page starts at the offset the client asked for") {
        const auto page = pageOf(server, kPlaylistId, 1, 2, {"%title%"});
        CHECK(titlesIn(page) == json::array({"Second", "Dragged in"}));
    }

    SUBCASE("a count reaching past the end answers the rows that remain") {
        const auto page = pageOf(server, kPlaylistId, 3, 1000, {"%title%"});

        CHECK(titlesIn(page) == json::array({"Fourth", "Fifth"}));
        CHECK(page.at("totalCount") == playlistRows().size());
    }
}

TEST_CASE("a playlist the player does not hold is a 404 rather than an empty page") {
    FakePlayer foobar;
    holdingRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response = get(server, itemsPath(kSecondPlaylistId, 0, 10, {"%title%"}));

    REQUIRE(response);
    CHECK(response->status == 404);
}

TEST_CASE(
    "a page request the component can judge for itself is a 400 and never reaches the "
    "player") {
    FakePlayer foobar;
    holdingRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto columns = "&columns=" + encoded("%title%");
    const std::string paged = "offset=0&count=10";

    struct Request {
        std::string id;
        std::string query;
    };

    for (const auto& request : {
             Request{kPlaylistId, "count=10" + columns},
             Request{kPlaylistId, "offset=0" + columns},
             Request{kPlaylistId, "offset=&count=10" + columns},
             Request{kPlaylistId, "offset=0&count=" + columns},
             Request{kPlaylistId, "offset=two&count=10" + columns},
             Request{kPlaylistId, "offset=0&count=ten" + columns},
             Request{kPlaylistId, "offset=-1&count=10" + columns},
             Request{kPlaylistId, "offset=0&count=1.5" + columns},
             Request{kPlaylistId, "offset=4294967296&count=10" + columns},
             Request{kPlaylistId, "offset=0&count=4294967296" + columns},
             Request{kPlaylistId, paged},
             // Right length and right alphabet, so the router hands it over and this
             // component's own check is what refuses it.
             Request{"------------------------------------", paged + columns},
         }) {
        INFO("id: ", request.id, " query: ", request.query);
        const auto response =
            get(server, "/api/playlists/" + request.id + "/items?" + request.query);

        REQUIRE(response);
        CHECK(response->status == 400);
        if (response->status == 400)
            CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(foobar.total() == 0);
}

TEST_CASE("a delta carries only the rows whose content changed, each at the position it sits at") {
    FakePlayer foobar;
    holdingChangedRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto patched = patchedTitles(deltaOf(server, kChangedSince, {"%title%"}));

    CHECK(patched == json({{"1", "Second, five stars"},
                           {std::to_string(kStrayRow), "Dragged in, five stars"}}));
}

TEST_CASE("a changed row resolves to the fields a page's row carries, its library path included") {
    FakePlayer foobar;
    holdingChangedRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto rows = byPosition(deltaOf(server, kChangedSince, {"%artist%", "%title%"}));

    REQUIRE(rows.count(1) == 1);
    CHECK(rows.at(1).at("columns") == json::array({"Fictional Artist", "Second, five stars"}));
    CHECK(rows.at(1).at("libraryPath") == std::string(kLibraryFolder) + "02.flac");

    REQUIRE(rows.count(kStrayRow) == 1);
    CHECK(rows.at(kStrayRow).at("columns") ==
          json::array({"Somebody Else", "Dragged in, five stars"}));
    CHECK(rows.at(kStrayRow).at("libraryPath").is_null());
}

// A patched row loses its address unless the delta carries the subsong too: the client holds the
// rows it drew from a page, and a change to one of them replaces what it holds at that position.
TEST_CASE("a changed row says which track inside its file it holds") {
    FakePlayer foobar;
    holdingChangedRows(foobar, changedCueSheetRows());
    const TestServer server(servingSettings(), foobar.player());

    const auto rows = byPosition(deltaOf(server, kChangedSince, {"%title%"}));

    REQUIRE(rows.count(0) == 1);
    REQUIRE(rows.count(1) == 1);
    CHECK(rows.at(0).at("libraryPath") == rows.at(1).at("libraryPath"));
    CHECK(rows.at(0).at("subsong") == 1);
    CHECK(rows.at(1).at("subsong") == 2);

    REQUIRE(rows.count(kStrayRow) == 1);
    CHECK(rows.at(kStrayRow).at("libraryPath").is_null());
    CHECK(rows.at(kStrayRow).at("subsong") == kStraySubsong);
}

// A bulk retag reaches thousands of rows sharing an album or an artist, and the client appends
// what this carries to the dictionary it holds. One entry per changed row is the growth the
// dictionary exists to stop, so the count matters as much as the values.
TEST_CASE("a value two changed rows share is carried once, with an id into it from each") {
    FakePlayer foobar;
    holdingChangedRows(foobar, rowsSharingAnArtist());
    const TestServer server(servingSettings(), foobar.player());

    const auto delta = deltaOf(server, kChangedSince, {"%artist%", "%title%"});
    const auto rows = byPosition(delta);

    REQUIRE(rows.size() == 3);
    CHECK(rows.at(1).at("columns").at(0) == "Fictional Artist");
    CHECK(rows.at(3).at("columns").at(0) == "Fictional Artist");
    CHECK(rows.at(kStrayRow).at("columns").at(0) == "Somebody Else");

    const auto artists = dictionariesIn(delta).at(0);
    CHECK(artists.at("text").size() == 2);
    CHECK(artists.at("ids").size() == 3);

    const auto titles = dictionariesIn(delta).at(1);
    CHECK(titles.at("text").size() == 3);
    CHECK(titles.at("ids").size() == 3);
}

TEST_CASE("a changed row carries where it sits and nothing else, so a value travels once") {
    FakePlayer foobar;
    holdingChangedRows(foobar, rowsSharingAnArtist());
    const TestServer server(servingSettings(), foobar.player());

    const auto delta = deltaOf(server, kChangedSince, {"%artist%", "%title%"});

    REQUIRE(delta.at("items").size() == 3);
    for (const auto& item : delta.at("items")) {
        INFO("row: ", item.dump());
        CHECK(keysOf(item) == Keys{"position", "libraryPath", "subsong"});
    }
}

TEST_CASE("the dictionaries arrive in the order the request declared its columns") {
    FakePlayer foobar;
    holdingChangedRows(foobar, rowsSharingAnArtist());
    const TestServer server(servingSettings(), foobar.player());

    const std::set<std::string> artists{"Fictional Artist", "Somebody Else"};
    const std::set<std::string> titles{"Second, five stars", "Dragged in, five stars",
                                       "Fourth, five stars"};

    SUBCASE("the artist asked for first answers first") {
        const auto columns =
            dictionariesIn(deltaOf(server, kChangedSince, {"%artist%", "%title%"}));

        REQUIRE(columns.size() == 2);
        CHECK(valuesIn(columns.at(0)) == artists);
        CHECK(valuesIn(columns.at(1)) == titles);
    }

    SUBCASE("the same two asked for the other way round answer the other way round") {
        const auto columns =
            dictionariesIn(deltaOf(server, kChangedSince, {"%title%", "%artist%"}));

        REQUIRE(columns.size() == 2);
        CHECK(valuesIn(columns.at(0)) == titles);
        CHECK(valuesIn(columns.at(1)) == artists);
    }
}

TEST_CASE("a delta says which revision the client is now caught up to") {
    FakePlayer foobar;
    holdingChangedRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto delta = deltaOf(server, kChangedSince, {"%title%"});

    CHECK(delta.at("items").size() == changedRows().size());
    CHECK(wireValue(delta, "revision") == asDigits(kRowsRevision));
}

TEST_CASE("a revision nothing has changed since answers an empty delta rather than an error") {
    FakePlayer foobar;
    holdingChangedRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto delta = deltaOf(server, kRowsRevision, {"%title%"});

    CHECK(delta.at("items").empty());
    CHECK(wireValue(delta, "revision") == asDigits(kRowsRevision));
}

// What a client polling a quiet playlist gets every tick, so it carries no dictionary to hold a
// place for a row that is not there.
TEST_CASE(
    "a delta with no changed rows carries no dictionaries rather than an empty one per "
    "column") {
    FakePlayer foobar;
    holdingChangedRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto delta = deltaOf(server, kRowsRevision, {"%artist%", "%title%"});
    const auto columns = dictionariesIn(delta);

    CHECK(delta.at("items").empty());
    CHECK(columns.empty());
}

TEST_CASE("a structure generation the playlist has moved past is refused rather than patched") {
    FakePlayer foobar;
    holdingChangedRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    checkRefused(server, changesPath(kPlaylistId, kRowsStructure + 1, kChangedSince, {"%title%"}),
                 409);
}

TEST_CASE("a revision older than the retained window is refused rather than patched") {
    FakePlayer foobar;
    holdingChangedRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    checkRefused(server, changesPath(kPlaylistId, kRowsStructure, kOldestRetained - 1, {"%title%"}),
                 410);
}

// What a client patching rows does on every poll: it holds the two counters the page it is
// patching answered and hands them straight back. A client that read them as numbers hands back
// kThroughADouble for both, so the request that was meant to fetch a few changed rows is told the
// playlist was restructured and that its revision fell out of the window, and it reloads the
// whole playlist instead. That is the difference a digit makes here.
TEST_CASE("the two counters a page answered are read back at the values it answered") {
    FakePlayer foobar;
    holdingChangedRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto page = pageOf(server, kPlaylistId, 0, playlistRows().size(), {"%title%"});
    const auto structure = counterIn(page, "structure");
    const auto since = counterIn(page, "revision");

    const auto response = get(server, changesPath(kPlaylistId, structure, since, {"%title%"}));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(json::parse(response->body).at("items").empty());

    const auto rounded = std::to_string(kThroughADouble);
    checkRefused(server, changesPath(kPlaylistId, rounded, since, {"%title%"}), 409);
    checkRefused(server, changesPath(kPlaylistId, structure, rounded, {"%title%"}), 410);
}

TEST_CASE(
    "a request for changes the component can judge for itself is a 400 and never reaches "
    "the player") {
    FakePlayer foobar;
    holdingChangedRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto columns = "&columns=" + encoded("%title%");
    const std::string asked =
        "structure=" + std::to_string(kRowsStructure) + "&since=" + std::to_string(kChangedSince);

    struct Request {
        std::string id;
        std::string query;
    };

    for (const auto& request : {
             Request{kPlaylistId, "structure=" + std::to_string(kRowsStructure) + columns},
             Request{kPlaylistId, asked},
             // An empty parameter is still a declared one. `since` is refused because its
             // reading would otherwise take an empty string for zero; `structure` is refused
             // for failing to parse as a whole number at all.
             Request{kPlaylistId,
                     "structure=" + std::to_string(kRowsStructure) + "&since=" + columns},
             Request{kPlaylistId, "structure=&since=" + std::to_string(kChangedSince) + columns},
             Request{kPlaylistId,
                     "structure=twelve&since=" + std::to_string(kChangedSince) + columns},
             Request{kPlaylistId,
                     "structure=" + std::to_string(kRowsStructure) + "&since=yesterday" + columns},
             Request{kPlaylistId,
                     "structure=" + std::to_string(kRowsStructure) + "&since=-1" + columns},
             Request{kPlaylistId, "structure=99999999999999999999&since=" +
                                      std::to_string(kChangedSince) + columns},
             Request{"------------------------------------", asked + columns},
         }) {
        INFO("id: ", request.id, " query: ", request.query);
        checkRefused(server, "/api/playlists/" + request.id + "/items/changes?" + request.query,
                     400);
    }

    CHECK(foobar.total() == 0);
}

TEST_CASE(
    "a column set past either cap is refused on both row routes and never reaches the player") {
    FakePlayer foobar;
    holdingChangedRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    std::vector<std::string> tooMany;
    for (size_t column = 0; column <= kMaxColumns; ++column)
        tooMany.push_back("%field" + std::to_string(column) + "%");

    const std::vector<std::string> tooLong = {std::string(kMaxColumnLength + 1, 'x')};

    struct Refusal {
        std::vector<std::string> columns;
        std::string error;
    };

    for (const auto& refusal :
         {Refusal{tooMany, "too many columns"}, Refusal{tooLong, "unacceptable column"}}) {
        for (const auto& path :
             {itemsPath(kPlaylistId, 0, 10, refusal.columns),
              changesPath(kPlaylistId, kRowsStructure, kChangedSince, refusal.columns)}) {
            INFO("path: ", path.substr(0, 80));
            const auto response = get(server, path);

            REQUIRE(response);
            CHECK(response->status == 400);
            CHECK(json::parse(response->body)["error"] == refusal.error);
        }
    }

    CHECK(foobar.total() == 0);
}

// The stray row, so that a row is played by where it sits in the playlist rather than by
// anything the media library knows about it. Where playback then goes is GET /api/state's to
// report, published by the player's own callback: state_route_test.cpp holds that half.
TEST_CASE("playing a row hands the player the playlist it is in and the position it sits at") {
    FakePlayer foobar;
    holdingRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response = post(server, playPath(kPlaylistId, std::to_string(kStrayRow)), "");

    REQUIRE(response);
    INFO("status: ", response->status);
    CHECK(accepted(response));

    CHECK(foobar.count(Call::playRow) == 1);
    REQUIRE(foobar.playing());
    CHECK(foobar.playing()->playlistId == kPlaylistId);
    CHECK(foobar.playing()->index == kStrayRow);
}

TEST_CASE(
    "a play request the component can judge for itself is a 400 and never reaches the "
    "player") {
    FakePlayer foobar;
    holdingRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    struct Request {
        std::string id;
        std::string index;
    };

    for (const auto& request : {
             Request{kPlaylistId, "two"},
             Request{kPlaylistId, "-1"},
             Request{kPlaylistId, "1.5"},
             Request{kPlaylistId, "4294967296"},
             // Right length and right alphabet, so the router hands it over and this
             // component's own check is what refuses it.
             Request{"------------------------------------", "0"},
         }) {
        INFO("id: ", request.id, " index: ", request.index);
        const auto response = post(server, playPath(request.id, request.index), "");

        REQUIRE(response);
        CHECK(response->status == 400);
        if (response->status == 400)
            CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(foobar.count(Call::playRow) == 0);
}

TEST_CASE(
    "playing from a playlist the player does not hold is a 404, and a row past that "
    "playlist's end is a 400") {
    struct Case {
        std::string id;
        std::string index;
        int status;
    };

    for (const auto& expected : {Case{kUnknownPlaylistId, "3", 404},
                                 Case{kPlaylistId, std::to_string(playlistRows().size()), 400}}) {
        INFO("playlist: ", expected.id, ", row: ", expected.index);
        FakePlayer foobar;
        holdingRows(foobar);
        const TestServer server(servingSettings(), foobar.player());

        const auto response = post(server, playPath(expected.id, expected.index), "");

        REQUIRE(response);
        CHECK(response->status == expected.status);
        if (response->status == expected.status)
            CHECK(json::parse(response->body)["error"].is_string());

        CHECK(foobar.count(Call::playRow) == 1);
        CHECK_FALSE(foobar.playing());
    }
}

// No library is handed to this server on purpose. A create with no set has nothing to resolve
// against the media library, so it is the same shape as emptying the component's own playlist
// rather than the same shape as a fill.
TEST_CASE("a create with no set answers a playlist at the end of the list, holding nothing") {
    FakePlayer foobar;
    holdingForACreate(foobar);
    const auto before = foobar.playlists().size();
    const TestServer server(servingSettings(), foobar.player());

    const auto response = post(server, kCreatePlaylist, createBody());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto made = json::parse(response->body);
    CHECK(made["title"] == kNewTitle);
    CHECK(made["itemCount"] == 0);
    CHECK(made["index"] == before);

    const auto listed = listingOf(server).at("playlists");
    REQUIRE(listed.size() == before + 1);
    CHECK(listed.back().at("id") == made["id"]);

    CHECK(foobar.writes() == 1);
}

// The playlist exists and holds its rows at the same instant, because the alternative is a
// create followed by a fill: two requests, and a window in which a user's playlist list has an
// empty playlist in it that nobody asked for. Counting every write the player offers is what
// tells the one job from the two.
TEST_CASE(
    "a create filled from library rows asks the player for one job, not a create and a "
    "fill") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForACreate(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto response = post(
        server, kCreatePlaylist,
        createBody({{"structure", library.state().structure}, {"ordinals", json::array({3, 1})}}));

    REQUIRE(response);
    REQUIRE(response->status == 200);

    CHECK(foobar.writes() == 1);
    CHECK(foobar.count(Call::createPlaylist) == 1);

    const auto made = json::parse(response->body);
    CHECK(made["title"] == kNewTitle);
    CHECK(made["itemCount"] == 2);
    CHECK(foobar.titlesOf(made["id"].get<std::string>()) == theFilledTracks());
}

TEST_CASE("a create filled from a source playlist's rows asks the player for one job as well") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForACreate(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto response =
        post(server, kCreatePlaylist,
             createBody({{kSourceField, kPlaylistId},
                         {"runs", json::array({json::array({1, 2}), json::array({4, 1})})}}));

    REQUIRE(response);
    REQUIRE(response->status == 200);

    CHECK(foobar.writes() == 1);

    const auto made = json::parse(response->body);
    CHECK(made["itemCount"] == 3);
    CHECK(foobar.titlesOf(made["id"].get<std::string>()) ==
          std::vector<std::string>{"Rock B", "Rock C", "Rock E"});
}

// A client draws the new playlist from this answer and then keeps it on the poll, so an answer
// that is not the listing's own entry leaves one row in the sidebar drawn from different fields
// from every row beside it. Pinned as a set rather than field by field, so the two cannot drift.
TEST_CASE("a create answers the entry GET /api/playlists gives for the playlist it made") {
    FakePlayer foobar;
    holdingForACreate(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response = post(server, kCreatePlaylist, createBody());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto made = json::parse(response->body);
    REQUIRE(made.contains("id"));

    const auto listed = entryFor(listingOf(server), made.at("id").get<std::string>());

    CHECK(keysOf(made) == keysOf(listed));
    CHECK(made == listed);
}

TEST_CASE("a create is refused by its title before the player is asked anything") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForACreate(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    struct Title {
        std::string name;
        std::optional<json> value;
    };

    for (const auto& title :
         {Title{"missing", std::nullopt}, Title{"empty", json("")},
          Title{"unprintable", json("Road\ntrip")},
          Title{"a character longer than a title may be", json(std::string(kMaxTitle + 1, 'a'))}}) {
        INFO("title: ", title.name);

        json body{{"structure", library.state().structure}, {"ordinals", json::array({0})}};
        if (title.value)
            body["title"] = *title.value;

        const auto response = post(server, kCreatePlaylist, body.dump());

        REQUIRE(response);
        CHECK(response->status == 400);
        if (response->status == 400)
            CHECK(json::parse(response->body)["error"] == describe(PlaylistRefusal::badTitle));
    }

    CHECK(foobar.writes() == 0);
}

// The set is a fill's body, so a client that fixed one for the fill route has fixed it for the
// create. Driving the same set at both is what holds the two grammars together: a create that
// grew its own reading of a run, or its own message for an ordinal past the end, is a second
// thing for a caller to learn.
TEST_CASE(
    "a set a create cannot read is refused exactly as the fill route refuses it, and the "
    "player is never asked") {
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;

    FakePlayer foobar(&library);
    holdingForACreate(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    struct BadSet {
        std::string name;
        json set;
    };

    const std::vector<BadSet> sets{
        {"an ordinal past the end of the library",
         json{{"structure", structure}, {"ordinals", json::array({kLibraryTracks})}}},
        {"runs reaching past the end of the library",
         json{{"structure", structure}, {"runs", json::array({json::array({0, 99})})}}},
        {"two selection forms at once", json{{"structure", structure},
                                             {"ordinals", json::array({0})},
                                             {"runs", json::array({json::array({0, 1})})}}},
        {"no selection form at all", json{{"structure", structure}}},
        {"no structure to resolve the set against", json{{"ordinals", json::array({0})}}},
        {"a field neither schema declares",
         json{{"structure", structure}, {"ordinals", json::array({0})}, {"replace", true}}}};

    for (const auto& bad : sets) {
        INFO("set: ", bad.name);

        const auto filled = post(server, userFill(), bad.set.dump());
        const auto made = post(server, kCreatePlaylist, createBody(bad.set));

        REQUIRE(filled);
        REQUIRE(made);

        CHECK(filled->status == 400);
        CHECK(made->status == filled->status);
        CHECK(json::parse(made->body)["error"] == json::parse(filled->body)["error"]);
    }

    // The other half of the grammar has no fill route to be held against: only a create takes
    // a source playlist. Right length and right alphabet, so the id reaches this component's
    // own check rather than the router's.
    const auto sourced = post(server, kCreatePlaylist,
                              createBody({{kSourceField, "------------------------------------"},
                                          {"runs", json::array({json::array({0, 1})})}}));

    REQUIRE(sourced);
    CHECK(sourced->status == 400);
    if (sourced->status == 400)
        CHECK(json::parse(sourced->body)["error"] == describe(PlaylistRefusal::badId));

    CHECK(foobar.writes() == 0);
}

TEST_CASE(
    "renaming a playlist hands the player its id and the new title, and the list answers "
    "the new one") {
    FakePlayer foobar;
    holdingThreePlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response = post(server, playlistPath(kPlaylistId), renameBody(kNewTitle));

    REQUIRE(response);
    CHECK(accepted(response));

    CHECK(foobar.askedAbout(Call::renamePlaylist) == std::vector<std::string>{kPlaylistId});

    CHECK(titleOf(server, kPlaylistId) == kNewTitle);
    CHECK(titleOf(server, kSecondPlaylistId) == "Ordinary playlist");
}

TEST_CASE("deleting a playlist takes it out of the list the player answers with") {
    FakePlayer foobar;
    holdingThreePlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response = server.client().Delete(playlistPath(kPlaylistId));

    REQUIRE(response);
    CHECK(accepted(response));

    CHECK(foobar.askedAbout(Call::removePlaylist) == std::vector<std::string>{kPlaylistId});

    CHECK(idsIn(listingOf(server)) ==
          std::vector<std::string>{kSecondPlaylistId, kThirdPlaylistId});
}

// The route that has already taken a player down. foobar2000 keeps a queued entry whose whole
// playlist is deleted rather than dropping it, and reading the infinite position it leaves
// behind as an index crashes the player: ARCHITECTURE.md, *Facts about the player*. So there is
// nothing here for a client or for this component to clear first. That the player itself
// survives one is the live check's half rather than this one's.
TEST_CASE("deleting a playlist asks the play queue nothing, before or after") {
    FakePlayer foobar;
    holdingThreePlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response = server.client().Delete(playlistPath(kPlaylistId));

    REQUIRE(response);
    CHECK(accepted(response));

    CHECK(foobar.count(Call::removePlaylist) == 1);
    CHECK(queueCalls(foobar) == 0);

    CHECK(idsIn(listingOf(server)).size() == 2);
    CHECK(queueCalls(foobar) == 0);
}

TEST_CASE(
    "moving a playlist hands the player its id and the index to move it to, and the list "
    "answers the new order") {
    FakePlayer foobar;
    holdingThreePlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto last = static_cast<uint32_t>(foobar.playlists().size() - 1);
    const auto response = post(server, movePath(kPlaylistId), moveBody(last));

    REQUIRE(response);
    CHECK(accepted(response));

    CHECK(foobar.askedAbout(Call::movePlaylist) == std::vector<std::string>{kPlaylistId});

    const auto listed = listingOf(server);
    CHECK(idsIn(listed) ==
          std::vector<std::string>{kSecondPlaylistId, kThirdPlaylistId, kPlaylistId});
    CHECK(entryFor(listed, kPlaylistId).at("index") == last);
}

TEST_CASE("a move to one past the end of the list is a 400 and moves nothing") {
    FakePlayer foobar;
    holdingThreePlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto before = idsIn(listingOf(server));
    const auto pastEnd = static_cast<uint32_t>(foobar.playlists().size());

    const auto response = post(server, movePath(kPlaylistId), moveBody(pastEnd));

    REQUIRE(response);
    CHECK(response->status == 400);
    CHECK(json::parse(response->body)["error"].is_string());

    CHECK(foobar.count(Call::movePlaylist) == 1);
    CHECK(idsIn(listingOf(server)) == before);
}

TEST_CASE(
    "an unknown playlist id is a 404 on each of the three edits, and the player is what "
    "says so") {
    for (const auto& edit : playlistEdits()) {
        INFO("edit: ", edit.name);

        FakePlayer foobar;
        holdingThreePlaylists(foobar);
        const TestServer server(servingSettings(), foobar.player());

        const auto before = idsIn(listingOf(server));
        const auto response = edit.send(server, kUnknownPlaylistId);

        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(foobar.count(edit.call) == 1);

        CHECK(idsIn(listingOf(server)) == before);
    }
}

TEST_CASE(
    "a request each of the three edits can judge for itself is refused before the player "
    "is asked") {
    FakePlayer foobar;
    holdingThreePlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());
    const auto before = idsIn(listingOf(server));

    struct Body {
        std::string name;
        std::string text;
    };

    // Held against the create's rather than checked against a rule of its own: both routes take
    // a title, and a client that fixed one has fixed the other.
    const std::vector<Body> titles{
        {"a body that is not JSON", "not json"},
        {"no title at all", json::object().dump()},
        {"an empty title", renameBody("")},
        {"an unprintable title", renameBody("Road\ntrip")},
        {"a title one character too long", renameBody(std::string(kMaxTitle + 1, 'a'))}};

    for (const auto& body : titles) {
        INFO("title: ", body.name);

        const auto renamed = post(server, playlistPath(kPlaylistId), body.text);
        const auto created = post(server, kCreatePlaylist, body.text);

        REQUIRE(renamed);
        REQUIRE(created);

        CHECK(renamed->status == created->status);
        CHECK(json::parse(renamed->body)["error"] == json::parse(created->body)["error"]);
    }

    const std::vector<Body> indices{
        {"a body that is not JSON", "not json"},
        {"no index at all", json::object().dump()},
        {"an index that is not a number", json{{kMoveIndexField, "2"}}.dump()},
        {"a negative index", json{{kMoveIndexField, -1}}.dump()}};

    for (const auto& body : indices) {
        INFO("index: ", body.name);

        const auto response = post(server, movePath(kPlaylistId), body.text);

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    // Right length and right alphabet, so the router has a route for it and this component's own
    // check is what refuses it rather than a missing route.
    for (const auto& edit : playlistEdits()) {
        INFO("edit: ", edit.name);

        const auto response = edit.send(server, "------------------------------------");

        REQUIRE(response);
        CHECK(response->status == 400);
    }

    CHECK(foobar.writes() == 0);
    CHECK(idsIn(listingOf(server)) == before);
    CHECK(titleOf(server, kPlaylistId) == "#Jean Rock");
}

// All three request schemas are additionalProperties: false, and the move is the one that holds
// its body to them. A create carrying a set is held to them too, by the fill's own grammar; a
// create carrying none reads its title and looks at nothing else, which is the hole this covers
// along with the rename's. What a client loses is the report that a field it sent is not read.
TEST_CASE(
    "a field none of the three edits declares is refused, and nothing is renamed, moved or "
    "made") {
    FakePlayer foobar;
    holdingEveryWriteTarget(foobar);
    const TestServer server(servingSettings(), foobar.player());

    struct Sent {
        std::string name;
        std::string path;
        json body;
    };

    const std::vector<Sent> routes{
        {"renaming", playlistPath(kPlaylistId), {{"title", kNewTitle}}},
        {"creating with no set", kCreatePlaylist, {{"title", kNewTitle}}},
        {"moving", movePath(kSecondPlaylistId), {{kMoveIndexField, 0}}}};

    const std::vector<std::pair<std::string, json>> undeclared{{"junk", 1}, {"replace", true}};

    for (const auto& route : routes) {
        for (const auto& field : undeclared) {
            INFO("route: ", route.name, ", field: ", field.first);

            const auto response =
                post(server, route.path, withField(route.body.dump(), field.first, field.second));

            REQUIRE(response);
            CHECK(response->status == 400);
            CHECK(errorOf(*response) == describe(PlaylistRefusal::malformedBody));
        }
    }

    CHECK(foobar.writes() == 0);
}

TEST_CASE(
    "a copy appends a source playlist's rows to the end of the target, ascending whatever "
    "order the runs named them in") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response =
        post(server, copyPath(kPlaylistId), copyBody(kSecondPlaylistId, unorderedRuns()).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    CHECK(heldTitles(server, kPlaylistId) ==
          json::array({"First", "Second", "Third", "Fourth", "Source A", "Source B", "Source D"}));

    CHECK(heldTitles(server, kSecondPlaylistId) ==
          json::array({"Source A", "Source B", "Source C", "Source D", "Source E"}));
}

// The two things an undo is built from. A client's *Add to playlist* toast removes exactly the rows
// this answer names, against exactly the generation it answers, so a copy answering a bare 204
// leaves that undo with nothing to address. The copy names no generation of its own on the way in:
// it appends, so there is no position for one to protect.
TEST_CASE("a copy answers where the rows landed and the generation the target is now at") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto before = generationOf(server, kPlaylistId);

    const auto response =
        post(server, copyPath(kPlaylistId), copyBody(kSecondPlaylistId, unorderedRuns()).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    REQUIRE(answered.contains("positions"));
    CHECK(answered.at("positions") == json::array({4, 5, 6}));

    const auto generation = counterIn(answered, "structure");
    CHECK(generation == generationOf(server, kPlaylistId));
    CHECK(generation != before);
}

// See ARCHITECTURE.md, *Facts about the player*, on why the answer to a copy makes that read
// unnecessary.
TEST_CASE("a copy asks the player once, with no item count read before or after it") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response =
        post(server, copyPath(kPlaylistId), copyBody(kSecondPlaylistId, unorderedRuns()).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    CHECK(foobar.count(Call::copyRows) == 1);
    CHECK(foobar.total() == 1);
}

// `runs` naming nothing is what decodeSelection already takes everywhere else: a named form that
// expands to no rows is a client with nothing selected, and a form left out altogether is the
// refusal.
TEST_CASE("a copy naming no rows is accepted and appends nothing") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto before = heldTitles(server, kPlaylistId);

    const auto response =
        post(server, copyPath(kPlaylistId), copyBody(kSecondPlaylistId, json::array()).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    REQUIRE(answered.contains("positions"));
    CHECK(answered.at("positions").empty());

    CHECK(heldTitles(server, kPlaylistId) == before);
}

TEST_CASE(
    "a removal takes the rows the runs named out of the playlist and answers the generation "
    "they left behind") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response =
        post(server, removeRowsPath(kPlaylistId),
             removeRowsBody(kRowsStructure, json::array({json::array({1, 2})})).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    CHECK(heldTitles(server, kPlaylistId) == json::array({"First", "Fourth"}));

    const auto generation = counterIn(json::parse(response->body), "structure");
    CHECK(generation == generationOf(server, kPlaylistId));
    CHECK(generation != std::to_string(kRowsStructure));
}

TEST_CASE(
    "a removal against a generation the playlist has moved past is a 409 and removes "
    "nothing") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto before = heldTitles(server, kPlaylistId);

    const auto response =
        post(server, removeRowsPath(kPlaylistId),
             removeRowsBody(kRowsStructure - 1, json::array({json::array({1, 2})})).dump());

    REQUIRE(response);
    CHECK(response->status == 409);
    CHECK(json::parse(response->body)["error"] == describe(PlayerOutcome::rowsMoved));

    CHECK(heldTitles(server, kPlaylistId) == before);

    const auto generation = generationOf(server, kPlaylistId);
    CHECK(generation == std::to_string(kRowsStructure));
}

// An undo names the generation the page it was read from answered, verbatim. What stands between
// the two on a client is JSON.parse: read as a number, every generation this playlist can reach
// comes back as kThroughADouble, a value it has never stood at, and the undo is refused every
// time.
TEST_CASE(
    "a removal against the generation a page answered is accepted, and against the value a "
    "double makes of it is not") {
    SUBCASE("the generation handed back exactly as it arrived") {
        FakePlayer foobar;
        holdingTwoPlaylists(foobar);
        const TestServer server(servingSettings(), foobar.player());

        const auto page = pageOf(server, kPlaylistId, 0, kEveryHeldRow, {"%title%"});

        const auto response = post(server, removeRowsPath(kPlaylistId),
                                   json{{"structure", counterIn(page, "structure")},
                                        {"runs", json::array({json::array({1, 2})})}}
                                       .dump());

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(heldTitles(server, kPlaylistId) == json::array({"First", "Fourth"}));
    }

    SUBCASE("the generation after a trip through a double") {
        FakePlayer foobar;
        holdingTwoPlaylists(foobar);
        const TestServer server(servingSettings(), foobar.player());

        const auto response = post(server, removeRowsPath(kPlaylistId),
                                   json{{"structure", std::to_string(kThroughADouble)},
                                        {"runs", json::array({json::array({1, 2})})}}
                                       .dump());

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(heldTitles(server, kPlaylistId) ==
              json::array({"First", "Second", "Third", "Fourth"}));
    }
}

// A lock belongs to whichever component installed it, and running into one is nothing a client
// did wrong. A 500 tells that client this component broke; a 409 tells it the playlist would not
// take the edit, which is what happened and what its user can be told. Which edits meet a lock at
// all is lockableWrites(); the mask itself is foobar2000's and only a real playlist answers it.
TEST_CASE("an edit the player refuses for a locked playlist is a 409 rather than a 500") {
    for (const auto& write : lockableWrites()) {
        INFO("write: ", write.name);

        FakePlayer foobar;
        holdingTwoPlaylists(foobar);
        foobar.lock(kPlaylistId);
        const TestServer server(servingSettings(), foobar.player());

        const auto response = write.send(server);

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(json::parse(response->body)["error"] == describe(PlayerOutcome::playlistLocked));

        CHECK(foobar.writes() == 1);
        REQUIRE(foobar.playlist(kPlaylistId));
        CHECK(foobar.playlist(kPlaylistId)->title == "Road trip");
        CHECK(foobar.titlesOf(kPlaylistId) == roadTripTitles());
    }
}

// The same lock, met by the route above's neighbour. A copy and a fill both add rows, so both
// meet playlist_lock's filter_add, and a client told 409 by one and 200 by the other has no way
// to know which answer to believe. The refusal reads identically for that reason.
TEST_CASE("a fill into a locked playlist is the 409 a copy into one is") {
    Library library;
    buildLibrary(library);

    for (const auto& target : targets(library.state().structure)) {
        INFO("target: ", target.name);

        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        foobar.lock(target.id);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(json::parse(response->body)["error"] == describe(PlayerOutcome::playlistLocked));

        CHECK(foobar.count(Call::fill) == 1);
        CHECK(foobar.titlesOf(target.id) == alreadyHeld());
    }
}

// The undo on Jean's toast is built from the positions a fill answered, so positions for rows
// that never landed ask the player to remove rows past the end of a playlist. A refusal names
// none, whatever the player reported adding on its way to refusing.
TEST_CASE("a fill the player refused answers no positions") {
    struct Refusal {
        PlayerOutcome outcome;
        int status;
    };

    Library library;
    buildLibrary(library);

    for (const auto& refusal :
         {Refusal{PlayerOutcome::playlistLocked, 409}, Refusal{PlayerOutcome::noSuchPlaylist, 404},
          Refusal{PlayerOutcome::playerRefused, 500}, Refusal{PlayerOutcome::timedOut, 504}}) {
        INFO("outcome: ", describe(refusal.outcome));

        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        foobar.refuse(Call::fill, refusal.outcome);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto response = post(server, userFill(), userBody(library.state().structure));

        REQUIRE(response);
        CHECK(response->status == refusal.status);
        CHECK(json::parse(response->body).count("positions") == 0);
    }
}

TEST_CASE(
    "a copy the component can judge for itself is refused exactly as a create from the same "
    "source is, and the player is never asked") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    struct BadCopy {
        std::string name;
        json set;
    };

    const std::vector<BadCopy> sets{
        {"runs that are not pairs",
         json{{kSourceField, kSecondPlaylistId}, {"runs", json::array({1, 2})}}},
        {"a run whose count is not a number",
         json{{kSourceField, kSecondPlaylistId}, {"runs", json::array({json::array({0, "2"})})}}},
        {"a run starting before the first row",
         json{{kSourceField, kSecondPlaylistId}, {"runs", json::array({json::array({-1, 2})})}}},
        {"a source that is not a playlist id this component issued",
         json{{kSourceField, "------------------------------------"},
              {"runs", json::array({json::array({0, 1})})}}}};

    for (const auto& bad : sets) {
        INFO("set: ", bad.name);

        const auto copied = post(server, copyPath(kPlaylistId), bad.set.dump());
        const auto made = post(server, kCreatePlaylist, createBody(bad.set));

        REQUIRE(copied);
        REQUIRE(made);

        CHECK(copied->status == 400);
        CHECK(copied->status == made->status);
        CHECK(json::parse(copied->body)["error"] == json::parse(made->body)["error"]);
    }

    // A source is what a copy is for, so a body that names none is refused rather than read as a
    // copy of the target onto itself.
    for (const std::string& body :
         {std::string("not json"), json{{"runs", json::array({json::array({0, 1})})}}.dump()}) {
        INFO("body: ", body);

        const auto response = post(server, copyPath(kPlaylistId), body);

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(foobar.writes() == 0);
    CHECK(heldTitles(server, kPlaylistId) == json::array({"First", "Second", "Third", "Fourth"}));
}

TEST_CASE(
    "a removal the component can judge for itself is refused exactly as a fill of the same "
    "set is, and the player is never asked") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    struct BadSet {
        std::string name;
        json set;
    };

    const std::vector<BadSet> sets{
        {"runs that are not pairs", json{{"runs", json::array({0})}}},
        {"a run whose count is not a number", json{{"runs", json::array({json::array({0, "2"})})}}},
        {"a run starting before the first row",
         json{{"runs", json::array({json::array({-1, 2})})}}},
        {"no set at all", json::object()},
        {"a field neither schema declares",
         json{{"runs", json::array({json::array({0, 1})})}, {"replace", true}}}};

    for (const auto& bad : sets) {
        INFO("set: ", bad.name);

        const auto removed = post(server, removeRowsPath(kPlaylistId),
                                  withGeneration(bad.set, kRowsStructure).dump());
        const auto filled =
            post(server, userFill(), withStructure(bad.set, library.state().structure).dump());

        REQUIRE(removed);
        REQUIRE(filled);

        CHECK(removed->status == 400);
        CHECK(removed->status == filled->status);
        CHECK(json::parse(removed->body)["error"] == json::parse(filled->body)["error"]);
    }

    // A body naming no generation at all, which both routes refuse in the same words. How each
    // one spells the generation it does take is where they part company, and the two cases below
    // this one hold that.
    for (const std::string& body : {std::string("not json"), json::object().dump()}) {
        INFO("body: ", body);

        const auto removed = post(server, removeRowsPath(kPlaylistId), body);
        const auto filled = post(server, userFill(), body);

        REQUIRE(removed);
        REQUIRE(filled);

        CHECK(removed->status == 400);
        CHECK(removed->status == filled->status);
        CHECK(json::parse(removed->body)["error"] == json::parse(filled->body)["error"]);
    }

    CHECK(foobar.writes() == 0);
    CHECK(heldTitles(server, kPlaylistId) == json::array({"First", "Second", "Third", "Fourth"}));
}

TEST_CASE(
    "a removal names a generation as a run of decimal digits, and anything else is a 400 "
    "the player never sees") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    struct BadGeneration {
        std::string name;
        json value;
    };

    const std::vector<BadGeneration> generations{
        {"a JSON number, which is the spelling a fill takes", json(kRowsStructure)},
        {"digits behind a sign", json("-" + std::to_string(kRowsStructure))},
        {"digits with a fraction after them", json(std::to_string(kRowsStructure) + ".0")},
        {"a word", json("twelve")},
        {"an empty string", json("")},
        {"null", json(nullptr)},
        {"more digits than 64 bits hold", json("99999999999999999999")},
    };

    for (const auto& bad : generations) {
        INFO("structure: ", bad.name);

        const auto response = post(
            server, removeRowsPath(kPlaylistId),
            json{{"structure", bad.value}, {"runs", json::array({json::array({1, 2})})}}.dump());

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(foobar.count(Call::removeRows) == 0);
    CHECK(heldTitles(server, kPlaylistId) == json::array({"First", "Second", "Third", "Fourth"}));
}

// The guard on the field that did not move. A fill resolves media library ordinals against the
// library's own generation, which is inside 2^53 and is a number; a removal names one playlist's
// counter, which is not. One parser taught both spellings would pass every case about a removal
// and lose the refusal a fill depends on, so the fill is driven here from the other side.
TEST_CASE("a fill's structure is still a number and refuses the digits a removal takes") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto sentAsDigits = post(server, userFill(),
                                   json{{"structure", std::to_string(library.state().structure)},
                                        {"ordinals", json::array({0})}}
                                       .dump());

    REQUIRE(sentAsDigits);
    CHECK(sentAsDigits->status == 400);
    CHECK(foobar.count(Call::fill) == 0);

    const auto sentAsANumber =
        post(server, userFill(),
             json{{"structure", library.state().structure}, {"ordinals", json::array({0})}}.dump());

    REQUIRE(sentAsANumber);
    INFO("status: ", sentAsANumber->status);
    CHECK(accepted(sentAsANumber));
    CHECK(foobar.count(Call::fill) == 1);
}

TEST_CASE(
    "a row edit naming a playlist the player does not hold is a 404, and the player is what "
    "says so") {
    for (const auto& edit : rowEdits()) {
        INFO("edit: ", edit.name);

        FakePlayer foobar;
        holdingTwoPlaylists(foobar);
        const TestServer server(servingSettings(), foobar.player());

        const auto response = edit.send(server, kUnknownPlaylistId);

        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(foobar.count(edit.call) == 1);
    }

    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response =
        post(server, copyPath(kPlaylistId), copyBody(kUnknownPlaylistId, unorderedRuns()).dump());

    REQUIRE(response);
    CHECK(response->status == 404);
    CHECK(foobar.count(Call::copyRows) == 1);
    CHECK(heldTitles(server, kPlaylistId) == json::array({"First", "Second", "Third", "Fourth"}));
}

namespace {

FakeRow byArtist(const std::string& title, const std::string& artist) {
    FakeRow row = titled(title);
    row.fields["%artist%"] = artist;
    return row;
}

// Sorted by artist the rows run Second, Fourth, Third, First: neither the order they are held in,
// nor the order their titles sort to, nor the reverse of either.
void holdingRowsByArtist(FakePlayer& player) {
    player.add(userPlaylist(kPlaylistId, "Road trip", kRowsStructure),
               {byArtist("First", "Delta"), byArtist("Second", "Alpha"),
                byArtist("Third", "Charlie"), byArtist("Fourth", "Bravo")});
}

bool publishedAsARefusal(const std::string& error) {
    const auto published = publishedEnum("PlaylistRefusal", "error");
    return std::find(published.begin(), published.end(), error) != published.end();
}

struct RowOrderEdit {
    std::string name;
    std::string path;
    json body;
    Call call;
};

std::vector<RowOrderEdit> rowOrderEdits() {
    return {{"moving rows", moveRowsPath(kPlaylistId),
             moveRowsBody(kRowsStructure, firstTwoRows(), 2), Call::moveRows},
            {"sorting rows", sortRowsPath(kPlaylistId), sortRowsBody(kRowsStructure, "%title%"),
             Call::sortRows}};
}

}  // namespace

TEST_CASE(
    "a move lands the first named row at `to`, counted without the named rows, and keeps them "
    "in the order the playlist held them") {
    struct Move {
        std::string name;
        json set;
        uint32_t to;
        json titles;
    };

    const std::vector<Move> moves{
        // Two rows moved out of four leave two, so two is the end.
        {"runs, to the end", firstTwoRows(), 2,
         json::array({"Third", "Fourth", "First", "Second"})},
        // Named last row first: a move landing them in the order named puts Fourth ahead.
        {"ordinals named out of the playlist's order", json{{"ordinals", json::array({3, 0})}}, 1,
         json::array({"Second", "First", "Fourth", "Third"})}};

    for (const auto& move : moves) {
        INFO("move: ", move.name);

        FakePlayer foobar;
        holdingTwoPlaylists(foobar);
        const TestServer server(servingSettings(), foobar.player());

        const auto response = post(server, moveRowsPath(kPlaylistId),
                                   moveRowsBody(kRowsStructure, move.set, move.to).dump());

        REQUIRE(response);
        REQUIRE(response->status == 200);

        CHECK(heldTitles(server, kPlaylistId) == move.titles);

        const auto generation = counterIn(json::parse(response->body), "structure");
        CHECK(generation == generationOf(server, kPlaylistId));
        CHECK(generation != std::to_string(kRowsStructure));

        CHECK(foobar.count(Call::moveRows) == 1);
    }
}

// Whether a drop that changes nothing is sent at all is the client's call. The component's part
// is to answer it as it answers any other move rather than refuse it or answer without the player.
TEST_CASE("a move that leaves every row where it was is answered like any other move") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response = post(
        server, moveRowsPath(kPlaylistId),
        moveRowsBody(kRowsStructure, json{{"runs", json::array({json::array({1, 2})})}}, 1).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    CHECK(counterIn(json::parse(response->body), "structure") == generationOf(server, kPlaylistId));
    CHECK(heldTitles(server, kPlaylistId) == json(roadTripTitles()));
    CHECK(foobar.count(Call::moveRows) == 1);
}

// Only the player knows how many rows the playlist holds, so it is what refuses these; the
// promise is that the refusal is a 400 and that nothing moved on the way to it.
TEST_CASE(
    "a move naming a row or a landing past the end of the playlist is a 400 and moves nothing") {
    struct PastTheEnd {
        std::string name;
        json set;
        uint32_t to;
    };

    const std::vector<PastTheEnd> moves{
        {"a row one past the last", json{{"ordinals", json::array({1, 4})}}, 0},
        {"a landing one past the rows left", firstTwoRows(), 3},
        {"a landing at the playlist's own length", json{{"ordinals", json::array({0})}}, 4}};

    for (const auto& move : moves) {
        INFO("move: ", move.name);

        FakePlayer foobar;
        holdingTwoPlaylists(foobar);
        const TestServer server(servingSettings(), foobar.player());

        const auto response = post(server, moveRowsPath(kPlaylistId),
                                   moveRowsBody(kRowsStructure, move.set, move.to).dump());

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(errorOf(*response) == describe(PlayerOutcome::positionPastEnd));

        CHECK(heldTitles(server, kPlaylistId) == json(roadTripTitles()));
        CHECK(generationOf(server, kPlaylistId) == std::to_string(kRowsStructure));
    }
}

TEST_CASE(
    "a sort puts the whole playlist in ascending order of what the pattern formats, and answers "
    "where each row came from") {
    FakePlayer foobar;
    holdingRowsByArtist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response =
        post(server, sortRowsPath(kPlaylistId), sortRowsBody(kRowsStructure, "%artist%").dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    CHECK(heldTitles(server, kPlaylistId) == json::array({"Second", "Fourth", "Third", "First"}));

    const auto answered = json::parse(response->body);

    // The old position of the row now at each new position. Read the other way round it is
    // 3, 0, 2, 1, so a client re-keying by an inverted order is caught.
    REQUIRE(answered.contains("order"));
    CHECK(answered.at("order") == json::array({1, 3, 2, 0}));

    const auto generation = counterIn(answered, "structure");
    CHECK(generation == generationOf(server, kPlaylistId));
    CHECK(generation != std::to_string(kRowsStructure));

    CHECK(foobar.count(Call::sortRows) == 1);
}

TEST_CASE(
    "a move or a sort against a generation the playlist has moved past is a 409 and changes "
    "nothing") {
    for (const auto& edit : rowOrderEdits()) {
        INFO("edit: ", edit.name);

        FakePlayer foobar;
        holdingTwoPlaylists(foobar);
        const TestServer server(servingSettings(), foobar.player());

        auto body = edit.body;
        body["structure"] = std::to_string(kRowsStructure - 1);

        const auto response = post(server, edit.path, body.dump());

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(errorOf(*response) == describe(PlayerOutcome::rowsMoved));

        CHECK(heldTitles(server, kPlaylistId) == json(roadTripTitles()));
        CHECK(generationOf(server, kPlaylistId) == std::to_string(kRowsStructure));
    }
}

// A moved generation and a lock share 409 and are told apart by the sentence alone, since one is
// answered by reading the playlist again and the other only at the player. No refusal carries an
// order, which a client would otherwise re-key the rows it holds by.
TEST_CASE(
    "what the player answers a move or a sort maps onto the status and sentence a client acts on") {
    struct Refusal {
        PlayerOutcome outcome;
        int status;
    };

    for (const auto& edit : rowOrderEdits()) {
        for (const auto& refusal :
             {Refusal{PlayerOutcome::rowsMoved, 409}, Refusal{PlayerOutcome::playlistLocked, 409},
              Refusal{PlayerOutcome::ownPlaylist, 403},
              Refusal{PlayerOutcome::positionPastEnd, 400},
              Refusal{PlayerOutcome::noSuchPlaylist, 404},
              Refusal{PlayerOutcome::playerRefused, 500}, Refusal{PlayerOutcome::timedOut, 504}}) {
            INFO("edit: ", edit.name, ", outcome: ", describe(refusal.outcome));

            FakePlayer foobar;
            holdingTwoPlaylists(foobar);
            foobar.refuse(edit.call, refusal.outcome);
            const TestServer server(servingSettings(), foobar.player());

            const auto response = post(server, edit.path, edit.body.dump());

            REQUIRE(response);
            CHECK(response->status == refusal.status);
            CHECK(errorOf(*response) == describe(refusal.outcome));
            CHECK(json::parse(response->body).count("order") == 0);
            CHECK(foobar.count(edit.call) == 1);
        }
    }
}

TEST_CASE(
    "a move or a sort names a generation as a run of decimal digits, and anything else is a 400 "
    "the player never sees") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    struct BadGeneration {
        std::string name;
        json value;
    };

    const std::vector<BadGeneration> generations{
        {"a JSON number, which is the spelling a fill takes", json(kRowsStructure)},
        {"digits behind a sign", json("-" + std::to_string(kRowsStructure))},
        {"digits with a fraction after them", json(std::to_string(kRowsStructure) + ".0")},
        {"a word", json("twelve")},
        {"an empty string", json("")},
        {"null", json(nullptr)},
        {"more digits than 64 bits hold", json("99999999999999999999")},
    };

    for (const auto& edit : rowOrderEdits()) {
        for (const auto& bad : generations) {
            INFO("edit: ", edit.name, ", structure: ", bad.name);

            auto body = edit.body;
            body["structure"] = bad.value;

            const auto response = post(server, edit.path, body.dump());

            REQUIRE(response);
            CHECK(response->status == 400);
            CHECK(publishedAsARefusal(errorOf(*response)));
        }

        INFO("edit: ", edit.name, ", structure: none");

        auto body = edit.body;
        body.erase("structure");

        const auto response = post(server, edit.path, body.dump());

        REQUIRE(response);
        CHECK(response->status == 400);
    }

    CHECK(foobar.writes() == 0);
    CHECK(heldTitles(server, kPlaylistId) == json(roadTripTitles()));
}

TEST_CASE(
    "a move names its rows exactly as a removal does, as runs or as a plain list, and is refused "
    "in the removal's words where it does not") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    struct BadSet {
        std::string name;
        json set;
    };

    const std::vector<BadSet> sets{
        {"runs that are not pairs", json{{"runs", json::array({0})}}},
        {"a run starting before the first row",
         json{{"runs", json::array({json::array({-1, 2})})}}},
        {"both runs and a plain list",
         json{{"runs", json::array({json::array({0, 1})})}, {"ordinals", json::array({0})}}},
        {"no set at all", json::object()},
        {"a field neither schema declares",
         json{{"runs", json::array({json::array({0, 1})})}, {"replace", true}}}};

    for (const auto& bad : sets) {
        INFO("set: ", bad.name);

        const auto moved = post(server, moveRowsPath(kPlaylistId),
                                moveRowsBody(kRowsStructure, bad.set, 0).dump());
        const auto removed = post(server, removeRowsPath(kPlaylistId),
                                  withGeneration(bad.set, kRowsStructure).dump());

        REQUIRE(moved);
        REQUIRE(removed);

        CHECK(moved->status == 400);
        CHECK(moved->status == removed->status);
        CHECK(errorOf(*moved) == errorOf(*removed));
        CHECK(keysOf(moved->body) == Keys{"error", "detail"});
    }

    CHECK(foobar.writes() == 0);
    CHECK(heldTitles(server, kPlaylistId) == json(roadTripTitles()));
}

// A bitset is a removal's third form and not a move's: contract/openapi.yaml declares only runs
// and ordinals on MovePlaylistRowsRequest.
TEST_CASE(
    "a move with no whole `to`, with a bitset or with a field of its own undeclared is a 400") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto withTo = [](const json& to) {
        auto body = moveRowsBody(kRowsStructure, firstTwoRows(), 0);
        body["to"] = to;
        return body.dump();
    };

    auto noTo = moveRowsBody(kRowsStructure, firstTwoRows(), 0);
    noTo.erase("to");

    struct BadBody {
        std::string name;
        std::string text;
    };

    const std::vector<BadBody> bodies{
        {"a body that is not JSON", "not json"},
        {"no to at all", noTo.dump()},
        {"a negative to", withTo(-1)},
        {"a to written as digits", withTo("1")},
        {"a to with a fraction", withTo(1.5)},
        {"a to past 32 bits", withTo(uint64_t{1} << 32U)},
        {"a bitset", moveRowsBody(kRowsStructure, json{{"bitset", "Aw=="}}, 0).dump()},
        {"a pattern, which is the sort's field",
         moveRowsBody(kRowsStructure,
                      json{{"runs", json::array({json::array({0, 2})})}, {"pattern", "%title%"}}, 0)
             .dump()}};

    for (const auto& bad : bodies) {
        INFO("body: ", bad.name);

        const auto response = post(server, moveRowsPath(kPlaylistId), bad.text);

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(publishedAsARefusal(errorOf(*response)));
        CHECK(keysOf(response->body) == Keys{"error", "detail"});
    }

    CHECK(foobar.writes() == 0);
    CHECK(heldTitles(server, kPlaylistId) == json(roadTripTitles()));
}

TEST_CASE(
    "a sort's pattern is refused missing, empty, not text or past 4096 bytes, and taken at 4096") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto withPattern = [](const json& pattern) {
        auto body = sortRowsBody(kRowsStructure, "");
        body["pattern"] = pattern;
        return body.dump();
    };

    auto noPattern = sortRowsBody(kRowsStructure, "");
    noPattern.erase("pattern");

    struct BadBody {
        std::string name;
        std::string text;
    };

    const std::vector<BadBody> bodies{
        {"a body that is not JSON", "not json"},
        {"no pattern at all", noPattern.dump()},
        {"an empty pattern", withPattern("")},
        {"a pattern that is a number", withPattern(3)},
        {"a pattern one byte past the bound", withPattern(std::string(kLongestPattern + 1, 'a'))},
        {"runs, which are the move's field", [] {
             auto body = sortRowsBody(kRowsStructure, "%title%");
             body.update(firstTwoRows());
             return body.dump();
         }()}};

    for (const auto& bad : bodies) {
        INFO("body: ", bad.name);

        const auto response = post(server, sortRowsPath(kPlaylistId), bad.text);

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(publishedAsARefusal(errorOf(*response)));
        CHECK(keysOf(response->body) == Keys{"error", "detail"});
    }

    CHECK(foobar.writes() == 0);

    const auto atTheBound =
        post(server, sortRowsPath(kPlaylistId), withPattern(std::string(kLongestPattern, 'a')));

    REQUIRE(atTheBound);
    CHECK(atTheBound->status == 200);
    CHECK(foobar.count(Call::sortRows) == 1);
}

// Each refusal is cheaper than the one after it and says less about the playlist: the setting
// before anything is read, the id before the body is parsed, the body before a token is spent,
// and the budget before the player is asked. The budget is the one every playlist write draws on,
// so a rename spends it.
TEST_CASE(
    "a move and a sort refuse in the order every row edit does: the setting, the id, the body, "
    "the budget, then the player") {
    const std::string badId = "------------------------------------";

    for (const auto& edit : rowOrderEdits()) {
        INFO("edit: ", edit.name);

        const auto pathFor = [&edit](const std::string& id) {
            auto path = edit.path;
            path.replace(path.find(kPlaylistId), std::string(kPlaylistId).size(), id);
            return path;
        };

        {
            FakePlayer foobar;
            holdingTwoPlaylists(foobar);
            const TestServer server(readOnlyPlaylists(), foobar.player());

            const auto response = post(server, pathFor(badId), "not json");

            REQUIRE(response);
            CHECK(response->status == 403);
            CHECK(errorOf(*response) == describe(PlayerOutcome::writesDisabled));
            CHECK(foobar.count(edit.call) == 0);
        }

        FakePlayer foobar;
        holdingTwoPlaylists(foobar);
        const TestServer server(servingSettings(), foobar.player());

        const auto badIdAndBody = post(server, pathFor(badId), "not json");
        REQUIRE(badIdAndBody);
        CHECK(badIdAndBody->status == 400);
        CHECK(errorOf(*badIdAndBody) == describe(PlaylistRefusal::badId));

        constexpr int kEnoughToSpendAnyBudget = 100;
        bool spent = false;
        for (int attempt = 0; attempt < kEnoughToSpendAnyBudget && !spent; ++attempt) {
            const auto renamed =
                post(server, playlistPath(kSecondPlaylistId), renameBody("Everything"));
            REQUIRE(renamed);
            spent = renamed->status == 429;
        }
        REQUIRE(spent);

        const auto badBody = post(server, edit.path, "not json");
        REQUIRE(badBody);
        CHECK(badBody->status == 400);
        CHECK(errorOf(*badBody) == describe(PlaylistRefusal::malformedBody));

        // The player would answer this one 404, so a 429 says the budget was weighed first.
        const auto overBudget = post(server, pathFor(kUnknownPlaylistId), edit.body.dump());
        REQUIRE(overBudget);
        CHECK(overBudget->status == 429);
        CHECK(overBudget->get_header_value("Retry-After") == "1");

        CHECK(foobar.count(edit.call) == 0);
        CHECK(heldTitles(server, kPlaylistId) == json(roadTripTitles()));
    }
}

TEST_CASE("creating passes the whole request through to the player") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response = post(server, "/api/autoplaylists",
                               R"({"title": "#Jean Indie", "key": "folder:genre:Indie",
                                   "query": "%genre% IS Indie", "forceSort": true})");

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(json::parse(response->body)["id"] == FakePlayer::madeId(0));

    REQUIRE(foobar.count(Call::createAutoPlaylist) == 1);
    const auto made = foobar.playlist(FakePlayer::madeId(0));
    REQUIRE(made);
    REQUIRE(made->managed);
    CHECK(made->managed->title == "#Jean Indie");
    CHECK(made->managed->key == "folder:genre:Indie");
    CHECK(made->managed->query == "%genre% IS Indie");
    CHECK(made->managed->forceSort);
}

TEST_CASE("a request the component can judge for itself never reaches the player") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    for (const char* body : {"not json", R"({"query": "%genre% IS Rock"})",
                             R"({"title": "#Jean Rock"})", R"({"title": "", "query": "a"})"}) {
        INFO("body: ", body);
        const auto response = post(server, "/api/autoplaylists", body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(foobar.count(Call::createAutoPlaylist) == 0);
}

TEST_CASE("what the player says about a playlist maps onto a status a client can act on") {
    struct Case {
        PlayerOutcome outcome;
        int status;
    };

    for (const auto& expected :
         {Case{PlayerOutcome::queryInvalid, 400}, Case{PlayerOutcome::keyRefused, 400},
          Case{PlayerOutcome::notAnAutoPlaylist, 409}, Case{PlayerOutcome::noSuchPlaylist, 404},
          Case{PlayerOutcome::keyInUse, 409}, Case{PlayerOutcome::tooMany, 409},
          Case{PlayerOutcome::playerRefused, 500}, Case{PlayerOutcome::timedOut, 504},
          Case{PlayerOutcome::unavailable, 503}}) {
        FakePlayer foobar;
        holdingAnAutoPlaylist(foobar);
        foobar.refuse(Call::createAutoPlaylist, expected.outcome);
        const TestServer server(servingSettings(), foobar.player());

        const auto response = post(server, "/api/autoplaylists", kCreate);

        INFO("outcome: ", describe(expected.outcome));
        REQUIRE(response);
        CHECK(response->status == expected.status);
    }
}

TEST_CASE("a component with no player refuses honestly rather than pretending it did the work") {
    const TestServer server;

    for (const auto& response :
         {server.client().Get("/api/playlists"), post(server, "/api/autoplaylists", kCreate),
          post(server, "/api/autoplaylists/preview", R"({"query": "a"})"),
          server.client().Delete(std::string("/api/autoplaylists/") + kPlaylistId)}) {
        REQUIRE(response);
        CHECK(response->status == 503);
    }
}

// A create, a rename, a delete and a move all answer PlayerOutcome::unavailable when there is
// no seam behind them, and that outcome's message is the autoplaylist one. It sends a player
// owner to maxAutoPlaylists in config.json over a request that named no autoplaylist.
TEST_CASE("a playlist write with nothing behind it does not blame autoplaylists") {
    const TestServer server;

    for (const auto& write : playlistAndRowWrites()) {
        INFO("write: ", write.name);

        const auto response = write.send(server);

        REQUIRE(response);
        CHECK(response->status == 503);

        const auto error = errorOf(*response);
        INFO("error: ", error);
        CHECK(error != describe(PlayerOutcome::unavailable));
        CHECK(error.find("autoplaylist") == std::string::npos);
    }
}

TEST_CASE("updating and removing address one playlist by its id") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto updated = post(server, std::string("/api/autoplaylists/") + kPlaylistId,
                              R"({"query": "%genre% IS Jazz"})");

    REQUIRE(updated);
    CHECK(updated->status == 200);
    CHECK(foobar.askedAbout(Call::updateAutoPlaylist) == std::vector<std::string>{kPlaylistId});
    REQUIRE(foobar.playlist(kPlaylistId));
    CHECK(foobar.playlist(kPlaylistId)->managed->query == "%genre% IS Jazz");

    const auto removed = server.client().Delete(std::string("/api/autoplaylists/") + kPlaylistId);

    REQUIRE(removed);
    CHECK(removed->status == 200);
    CHECK(json::parse(removed->body)["removed"] == true);
    CHECK(json::parse(removed->body)["id"] == kPlaylistId);
    CHECK(foobar.askedAbout(Call::removeAutoPlaylist) == std::vector<std::string>{kPlaylistId});
    CHECK_FALSE(foobar.playlist(kPlaylistId));
}

TEST_CASE("an autoplaylist this component did not make takes an update and stays unrecorded") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    foobar.add(foreignAutoPlaylist());
    const TestServer server(servingSettings(), foobar.player());

    const auto response = post(server, autoPlaylistPath(kForeignAutoPlaylistId),
                               R"({"title": "Late jazz", "query": "%genre% IS Jazz"})");

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(answered["id"] == kForeignAutoPlaylistId);
    CHECK(answered["title"] == "Late jazz");
    CHECK(answered["isAutoPlaylist"] == true);
    CHECK(answered["managed"].is_null());

    const auto listing = listingOf(server);
    const auto listed = entryFor(listing, kForeignAutoPlaylistId);
    CHECK(listed["title"] == "Late jazz");
    CHECK(listed["isAutoPlaylist"] == true);
    CHECK(listed["managed"].is_null());

    CHECK(entryFor(listing, kPlaylistId)["managed"]["key"] == "folder:genre:Rock");
}

// A key is how a client recognises a playlist Jean made, so one accepted on a stranger's
// autoplaylist would have Jean claim it. An empty key claims nothing.
TEST_CASE(
    "a key sent to update an autoplaylist this component did not make is refused, and one sent "
    "to update its own is recorded") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    foobar.add(foreignAutoPlaylist());
    const TestServer server(servingSettings(), foobar.player());
    const auto before = listingOf(server);

    SUBCASE("a key on a stranger's autoplaylist is a 400 and changes nothing") {
        const auto response =
            post(server, autoPlaylistPath(kForeignAutoPlaylistId),
                 R"({"title": "Claimed", "key": "folder:genre:Jazz", "query": "%genre% IS Jazz"})");

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body) ==
              json{{"error", "unacceptable key"},
                   {"detail", "a key names a playlist this component made"}});
        CHECK(listingOf(server) == before);
    }

    SUBCASE("an empty key on a stranger's autoplaylist is no key") {
        const auto response =
            post(server, autoPlaylistPath(kForeignAutoPlaylistId),
                 R"({"title": "Unclaimed", "key": "", "query": "%genre% IS Jazz"})");

        REQUIRE(response);
        CHECK(response->status == 200);

        const auto listed = entryFor(listingOf(server), kForeignAutoPlaylistId);
        CHECK(listed["title"] == "Unclaimed");
        CHECK(listed["managed"].is_null());
    }

    SUBCASE("a key on one this component made is recorded as before") {
        const auto response = post(server, autoPlaylistPath(kPlaylistId),
                                   R"({"key": "folder:genre:Jazz", "query": "%genre% IS Jazz"})");

        REQUIRE(response);
        CHECK(response->status == 200);

        const auto managed = entryFor(listingOf(server), kPlaylistId)["managed"];
        CHECK(managed["key"] == "folder:genre:Jazz");
        CHECK(managed["query"] == "%genre% IS Jazz");
    }
}

// The limit is on what this component made, so an update that recorded a stranger's autoplaylist
// as its own would spend a create the install still has.
TEST_CASE("updating an autoplaylist this component did not make spends nothing of the limit") {
    auto settings = servingSettings();
    settings.maxAutoPlaylists = 2;

    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    foobar.add(foreignAutoPlaylist());
    const TestServer server(settings, foobar.player());

    const auto updated =
        post(server, autoPlaylistPath(kForeignAutoPlaylistId), R"({"query": "%genre% IS Jazz"})");
    REQUIRE(updated);
    REQUIRE(updated->status == 200);

    const auto created = post(server, "/api/autoplaylists", kCreate);
    REQUIRE(created);
    CHECK(created->status == 200);

    const auto held = foobar.playlists().size();
    const auto refused = post(server, "/api/autoplaylists", kCreate);
    REQUIRE(refused);
    CHECK(refused->status == 409);
    CHECK(json::parse(refused->body) ==
          json{{"error", describe(PlayerOutcome::tooMany)},
               {"detail", "this install allows 2 and already has 2"}});
    CHECK(foobar.playlists().size() == held);
}

TEST_CASE("a cap of zero refuses a create before the player is asked") {
    auto settings = servingSettings();
    settings.maxAutoPlaylists = 0;

    FakePlayer foobar;
    const TestServer server(settings, foobar.player());

    const auto refused = post(server, "/api/autoplaylists", kCreate);
    REQUIRE(refused);
    CHECK(refused->status == 503);
    CHECK(json::parse(refused->body)["error"] == describe(PlayerOutcome::unavailable));
    CHECK(foobar.count(Call::createAutoPlaylist) == 0);
}

// Lowering the cap must not strand what the component already made: a client can still edit
// each one and delete it to get back under.
TEST_CASE("the autoplaylist cap refuses only a create: at zero, at the cap and over it") {
    auto jazz = rock();
    jazz.id = kAutoPlaylistId;
    jazz.managed->key = "folder:genre:Jazz";

    for (const auto& [cap, refusal] : {std::pair{0, 503}, std::pair{2, 409}, std::pair{1, 409}}) {
        INFO("maxAutoPlaylists: ", cap);
        auto settings = servingSettings();
        settings.maxAutoPlaylists = cap;

        FakePlayer foobar;
        holdingAnAutoPlaylist(foobar);
        foobar.add(jazz);
        const TestServer server(settings, foobar.player());

        const auto created = post(server, "/api/autoplaylists", kCreate);
        REQUIRE(created);
        CHECK(created->status == refusal);
        CHECK(idsIn(listingOf(server)).size() == 2);

        const auto updated = post(server, autoPlaylistPath(kPlaylistId),
                                  R"({"title": "#Jean Rock again", "query": "%genre% IS Rock"})");
        REQUIRE(updated);
        CHECK(updated->status == 200);
        CHECK(titleOf(server, kPlaylistId) == "#Jean Rock again");

        const auto removed = server.client().Delete(autoPlaylistPath(kAutoPlaylistId));
        REQUIRE(removed);
        CHECK(removed->status == 200);
        CHECK(idsIn(listingOf(server)) == std::vector<std::string>{kPlaylistId});
    }
}

TEST_CASE(
    "updating an autoplaylist with a query the player cannot compile is a 400 that changes "
    "nothing") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto title = titleOf(server, kPlaylistId);
    const auto refused = post(server, autoPlaylistPath(kPlaylistId),
                              R"({"title": "#Jean Nonsense", "query": "bad"})");

    REQUIRE(refused);
    CHECK(refused->status == 400);
    CHECK(json::parse(refused->body)["error"] == describe(PlayerOutcome::queryInvalid));
    CHECK(titleOf(server, kPlaylistId) == title);
}

TEST_CASE("an autoplaylist this component did not make is deleted as one it made is") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    foobar.add(foreignAutoPlaylist());
    const TestServer server(servingSettings(), foobar.player());

    for (const std::string id : {kForeignAutoPlaylistId, kPlaylistId}) {
        INFO("id: ", id);

        const auto response = server.client().Delete(autoPlaylistPath(id));

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(json::parse(response->body) == json{{"removed", true}, {"id", id}});

        const auto ids = idsIn(listingOf(server));
        CHECK(std::find(ids.begin(), ids.end(), id) == ids.end());
    }
}

// foobar2000's playlist_lock filters removing a playlist whichever call asks, so a lock another
// component holds refuses the autoplaylist delete in the words the plain delete refuses it in.
TEST_CASE("a locked autoplaylist is refused deletion with the 409 the plain delete answers") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    foobar.add(foreignAutoPlaylist());
    foobar.add(userPlaylist(kThirdPlaylistId, "Locked playlist", kOrdinaryStructure));
    for (const std::string id : {kPlaylistId, kForeignAutoPlaylistId, kThirdPlaylistId})
        foobar.lock(id);
    const TestServer server(servingSettings(), foobar.player());

    const auto plain = server.client().Delete(playlistPath(kThirdPlaylistId));
    REQUIRE(plain);
    REQUIRE(plain->status == 409);
    REQUIRE(errorOf(*plain) == describe(PlayerOutcome::playlistLocked));

    for (const std::string id : {kForeignAutoPlaylistId, kPlaylistId}) {
        INFO("id: ", id);

        const auto response = server.client().Delete(autoPlaylistPath(id));

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(json::parse(response->body) == json::parse(plain->body));
    }

    CHECK(idsIn(listingOf(server)) ==
          std::vector<std::string>{kPlaylistId, kForeignAutoPlaylistId, kThirdPlaylistId});
}

// pfc::GUID_from_text reads an unknown character as zero and never reports failure, so a
// nonsense id would otherwise become a well-formed GUID that matches something one day.
TEST_CASE("an id that is not one we issued never reaches the player") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    // Wrong shape entirely, so the router has no route for them at all.
    for (const char* id : {"nonsense", "45837D74-FA4F-415C-BBA9-BF2DB8F0DC04", "../../etc"}) {
        INFO("id: ", id);
        const auto response = server.client().Delete(std::string("/api/autoplaylists/") + id);
        REQUIRE(response);
        CHECK(response->status == 404);
    }

    // Right length and right alphabet, so this one reaches our own check and is refused by
    // name rather than as a missing route.
    const auto response =
        server.client().Delete("/api/autoplaylists/------------------------------------");

    REQUIRE(response);
    CHECK(response->status == 400);

    CHECK(foobar.count(Call::removeAutoPlaylist) == 0);
}

// A client calls this while somebody is still typing.
TEST_CASE("previewing a query answers 200 whether or not the query parses") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto good = post(server, "/api/autoplaylists/preview", R"({"query": "%genre% IS Rock"})");

    REQUIRE(good);
    CHECK(good->status == 200);
    CHECK(json::parse(good->body)["valid"] == true);
    CHECK(json::parse(good->body)["matches"] == kRockMatches);
    CHECK(json::parse(good->body)["libraryEnabled"] == true);

    const auto bad = post(server, "/api/autoplaylists/preview", R"({"query": "bad"})");

    REQUIRE(bad);
    CHECK(bad->status == 200);
    CHECK(json::parse(bad->body)["valid"] == false);
    CHECK(json::parse(bad->body)["error"] == "Query syntax error");
}

TEST_CASE(
    "a preview asked for rows answers the matching tracks as ordinals in its library "
    "generation") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response =
        post(server, "/api/autoplaylists/preview", R"({"query": "%genre% IS Rock", "rows": true})");

    REQUIRE(response);
    CHECK(response->status == 200);

    const auto body = json::parse(response->body);
    CHECK(keysOf(body) ==
          Keys{"valid", "error", "matches", "libraryEnabled", "structure", "ordinals"});
    CHECK(body.at("valid") == true);
    CHECK(body.at("error") == "");
    CHECK(body.at("matches") == kRockMatches);
    CHECK(body.at("libraryEnabled") == true);

    // A number, as GET /state's library.structure is, so a client compares the two directly.
    CHECK(body.at("structure").is_number_unsigned());
    CHECK(body.at("structure") == kPreviewedStructure);
    CHECK(body.at("ordinals") == json(rockOrdinals()));

    CHECK(foobar.previewsAskingRows() == std::vector<bool>{true});
}

// A client that has no rows to draw is not handed a body that grows with the library, and the
// player is not asked to walk it.
TEST_CASE("a preview not asked for rows answers the four fields it always has") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    for (const char* body :
         {R"({"query": "%genre% IS Rock"})", R"({"query": "%genre% IS Rock", "rows": false})"}) {
        INFO("body: ", body);

        const auto response = post(server, "/api/autoplaylists/preview", body);

        REQUIRE(response);
        CHECK(response->status == 200);

        const auto answer = json::parse(response->body);
        CHECK(keysOf(answer) == Keys{"valid", "error", "matches", "libraryEnabled"});
        CHECK(answer.at("valid") == true);
        CHECK(answer.at("matches") == kRockMatches);
        CHECK(answer.at("libraryEnabled") == true);
    }

    CHECK(foobar.previewsAskingRows() == std::vector<bool>{false, false});
}

// A query somebody is still typing is an ordinary answer with rows asked for as without.
TEST_CASE("a preview asked for rows of a query that does not parse answers 200 naming no track") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response =
        post(server, "/api/autoplaylists/preview", R"({"query": "bad", "rows": true})");

    REQUIRE(response);
    CHECK(response->status == 200);

    const auto body = json::parse(response->body);
    CHECK(body.at("valid") == false);
    CHECK(body.at("error") == "Query syntax error");
    CHECK(body.at("matches") == 0);

    // contract/openapi.yaml leaves open whether these two are absent here or present with no
    // ordinal in them. Either way they travel together, and no track is named.
    CHECK(body.contains("structure") == body.contains("ordinals"));
    if (body.contains("ordinals"))
        CHECK(body.at("ordinals") == json::array());

    CHECK(foobar.previewsAskingRows() == std::vector<bool>{true});
}

TEST_CASE("a preview whose rows is not true or false is refused before the player") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    for (const char* rows : {R"("true")", "1", "null"}) {
        INFO("rows: ", rows);

        const auto response =
            post(server, "/api/autoplaylists/preview",
                 std::string(R"({"query": "%genre% IS Rock", "rows": )") + rows + "}");

        REQUIRE(response);
        CHECK(response->status == 400);

        const auto body = json::parse(response->body);
        CHECK(body.at("error") == "malformed request");
        CHECK(body.at("detail").get<std::string>().find("rows") != std::string::npos);
    }

    CHECK(foobar.count(Call::previewQuery) == 0);
}

// "preview" cannot match the id pattern, so this holds whatever order the routes are in.
TEST_CASE("previewing is not mistaken for a playlist id") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    post(server, "/api/autoplaylists/preview", R"({"query": "%genre% IS Rock"})");

    CHECK(foobar.count(Call::updateAutoPlaylist) == 0);
}

TEST_CASE("a client stuck in a loop is slowed down rather than obeyed") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    clearLog();
    const TestServer server(servingSettings(), foobar.player());

    std::vector<httplib::Result> replies;
    std::generate_n(std::back_inserter(replies), 60,
                    [&server] { return post(server, "/api/autoplaylists", kCreate); });

    const auto refused =
        std::count_if(replies.begin(), replies.end(),
                      [](const httplib::Result& r) { return r && r->status == 429; });

    // The limit refuses work; it does not drop callers.
    CHECK(std::all_of(replies.begin(), replies.end(),
                      [](const httplib::Result& r) { return static_cast<bool>(r); }));
    CHECK(refused > 0);
    CHECK(foobar.count(Call::createAutoPlaylist) < 60);

    const auto first429 =
        std::find_if(replies.begin(), replies.end(),
                     [](const httplib::Result& r) { return r && r->status == 429; });
    REQUIRE(first429 != replies.end());
    CHECK((*first429)->get_header_value("Retry-After") == "1");
    CHECK(json::parse((*first429)->body)["error"].is_string());

    // A line for the burst rather than one per refusal, which would be the same flood written
    // to a disk.
    const auto lines = loggedLines();
    const auto complaints = std::count_if(lines.begin(), lines.end(), [](const std::string& line) {
        return line.find("refusing playlist changes") != std::string::npos;
    });

    CHECK(complaints == 1);

    // Reading changes nothing, so it is not limited and a different route cannot spend it.
    const auto listed = server.client().Get("/api/playlists");
    REQUIRE(listed);
    CHECK(listed->status == 200);
}

// Somebody typing a query into an editor that does not debounce asks for a preview per keystroke,
// and never meets this. A client stuck in a loop runs a whole-library query on the player's main
// thread each time, and does.
constexpr int kPreviewBurst = 30;
constexpr int kPreviewsPastTheBudget = 10;

namespace {

httplib::Result previewRock(const TestServer& server) {
    return post(server, "/api/autoplaylists/preview", R"({"query": "%genre% IS Rock"})");
}

}  // namespace

TEST_CASE("a client looping on previews stops reaching the player") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());
    clearLog();

    std::vector<httplib::Result> replies;
    std::generate_n(std::back_inserter(replies), kPreviewBurst + kPreviewsPastTheBudget,
                    [&server] { return previewRock(server); });

    CHECK(foobar.count(Call::previewQuery) == kPreviewBurst);

    for (auto reply = replies.begin() + kPreviewBurst; reply != replies.end(); ++reply) {
        REQUIRE(*reply);
        CHECK((*reply)->status == 429);
        CHECK((*reply)->get_header_value("Retry-After") == "1");
        CHECK(errorOf(**reply) == describe(PlaylistRefusal::tooFast));
    }

    CHECK(errorLinesContaining("refusing query previews") == 1);
}

// A preview changes nothing, so a client trying queries must not use up the budget a playlist
// edit spends, nor be refused a preview because it has been editing.
TEST_CASE("previewing and changing playlists spend separate budgets") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());

    SUBCASE("a client previewing past its budget can still make a playlist") {
        for (int attempt = 0; attempt < kPreviewBurst + kPreviewsPastTheBudget; ++attempt)
            previewRock(server);

        const auto created = post(server, "/api/autoplaylists", kCreate);
        REQUIRE(created);
        CHECK(created->status == 200);
    }

    SUBCASE("a client changing playlists past its budget can still preview") {
        constexpr int kPastThePlaylistBudget = 40;
        for (int attempt = 0; attempt < kPastThePlaylistBudget; ++attempt)
            post(server, "/api/autoplaylists", kCreate);

        const auto previewed = previewRock(server);
        REQUIRE(previewed);
        CHECK(previewed->status == 200);
    }
}

TEST_CASE(
    "a client looping on playlist writes is logged once per burst, in the words it always was") {
    FakePlayer foobar;
    holdingAnAutoPlaylist(foobar);
    const TestServer server(servingSettings(), foobar.player());
    clearLog();

    std::vector<int> statuses;
    std::generate_n(std::back_inserter(statuses), 60, [&server] {
        const auto reply = post(server, "/api/autoplaylists", kCreate);
        return reply ? reply->status : 0;
    });

    const auto refused = std::count(statuses.begin(), statuses.end(), 429);
    REQUIRE(static_cast<size_t>(refused) > refusalBursts(statuses));

    const std::string complaint =
        "refusing playlist changes: they are arriving faster than this component will make them, "
        "which usually means a client is looping";

    const auto lines = loggedLines();
    CHECK(errorLinesContaining("") == refusalBursts(statuses));
    CHECK(std::all_of(lines.begin(), lines.end(), [&complaint](const std::string& line) {
        return line.rfind("[error] ", 0) != 0 || line == "[error] " + complaint;
    }));
}

// One budget covers every playlist write, as contract/openapi.yaml says, so a client looping any
// one of them is refused. The create is the one that spent nothing: a loop on it made playlists
// as fast as foobar2000 would take them.
TEST_CASE("a client looping any playlist or row write is slowed down rather than obeyed") {
    // Past kPlaylistBurst, and the server's clock stands still, so the last ten are refused.
    constexpr int kBurst = 40;

    for (const auto& write : playlistAndRowWrites()) {
        INFO("write: ", write.name);

        FakePlayer foobar;
        holdingEveryWriteTarget(foobar);
        const TestServer server(servingSettings(), foobar.player());

        std::vector<httplib::Result> replies;
        std::generate_n(std::back_inserter(replies), kBurst,
                        [&server, &write] { return write.send(server); });

        // The limit refuses work; it does not drop callers.
        CHECK(std::all_of(replies.begin(), replies.end(),
                          [](const httplib::Result& reply) { return static_cast<bool>(reply); }));

        const auto refused = std::count_if(
            replies.begin(), replies.end(),
            [](const httplib::Result& reply) { return reply && reply->status == 429; });

        // Each route sets its own Retry-After, so one carrying the limit and still leaving a
        // client with nothing to back off by is a state this can reach.
        const auto actionable =
            std::count_if(replies.begin(), replies.end(), [](const httplib::Result& reply) {
                return reply && reply->status == 429 &&
                       reply->get_header_value("Retry-After") == "1" && !errorOf(*reply).empty();
            });

        CHECK(refused > 0);
        CHECK(actionable == refused);
        CHECK(foobar.writes() < kBurst);
    }
}

TEST_CASE("an install that allows no autoplaylists says so before a client offers to make one") {
    SUBCASE("the default install can create, and says how many") {
        const TestServer server(servingSettings());
        const auto capabilities = server.client().Get("/api/capabilities");
        REQUIRE(capabilities);
        const auto body = json::parse(capabilities->body);

        CHECK(body["canCreateAutoPlaylists"] == true);
        CHECK(body["maxAutoPlaylists"] == Settings().maxAutoPlaylists);
    }

    SUBCASE("a cap of zero reads as off rather than as a limit of zero to discover") {
        auto settings = servingSettings();
        settings.maxAutoPlaylists = 0;

        const TestServer server(settings);
        const auto capabilities = server.client().Get("/api/capabilities");
        REQUIRE(capabilities);
        const auto body = json::parse(capabilities->body);

        CHECK(body["canCreateAutoPlaylists"] == false);
        CHECK(body["maxAutoPlaylists"] == 0);
    }
}

TEST_CASE("creating an autoplaylist needs both a cap to spend and writable playlists") {
    const auto offered = [](bool writePlaylists, int maxAutoPlaylists) {
        auto settings = servingSettings();
        settings.writePlaylists = writePlaylists;
        settings.maxAutoPlaylists = maxAutoPlaylists;

        return capabilitiesUnder(settings)["canCreateAutoPlaylists"];
    };

    CHECK(offered(true, 4) == true);
    CHECK(offered(false, 4) == false);
    CHECK(offered(true, 0) == false);
    CHECK(offered(false, 0) == false);
}

TEST_CASE("GET /api/capabilities says whether this install permits playlist writes") {
    SUBCASE("a config nobody narrowed permits them") {
        CHECK(capabilitiesUnder(servingSettings())["canWritePlaylists"] == true);
    }

    SUBCASE("read-only is published, rather than left for a client to learn from a refusal") {
        auto settings = servingSettings();
        settings.writePlaylists = false;

        CHECK(capabilitiesUnder(settings)["canWritePlaylists"] == false);
    }
}

// A client reads this once and draws the player from it, so one of these dropped later is a
// client back on the poll for something that cannot change while the player runs.
TEST_CASE("one read of GET /api/capabilities answers everything static a player UI needs") {
    const auto body = capabilitiesUnder(servingSettings());

    const std::vector<std::string> published = {
        "playerName", "playerVersion",     "volumeMin",      "volumeMax",
        "volumeUnit", "canWritePlaylists", "canChangeOutput"};

    for (const std::string& field : published) {
        INFO("field: ", field);
        REQUIRE(body.contains(field));
    }

    // The fader maps this range onto its curve, so a range that is not the player's own is
    // wrong along the slider's whole length. foobar2000 answers decibels from a negative floor
    // up to zero, and the unit is what lets a client label it without knowing that.
    CHECK(body["volumeMin"].get<double>() < body["volumeMax"].get<double>());
    CHECK_FALSE(body["volumeUnit"].get<std::string>().empty());

    // foo_jean loads in foobar2000 alone, so the name is here for the player to say which one
    // it is rather than for a client to assume.
    CHECK_FALSE(body["playerName"].get<std::string>().empty());
    CHECK_FALSE(body["playerVersion"].get<std::string>().empty());
}

// A client draws the playback-mode control from this and can send any name back, so a mode
// offered here that GET /state cannot publish, or one the player cannot be put into, is a
// control that refuses the moment somebody uses it.
TEST_CASE(
    "GET /api/capabilities offers the playback modes in Jean's names, as the player lists them") {
    const auto body = capabilitiesReporting(reportedOrders());

    CHECK(body["playbackModes"] == offeredModes());

    for (const std::string& order : reportedOrders()) {
        INFO("order: ", order);
        CHECK(body.dump().find(order) == std::string::npos);
    }
}

TEST_CASE("a playback order this component has no name for is not offered at all") {
    auto reported = reportedOrders();
    reported.emplace_back(kOrderAddedByAComponent);

    const auto body = capabilitiesReporting(reported);

    CHECK(body["playbackModes"] == offeredModes());
    CHECK(body.dump().find(kOrderAddedByAComponent) == std::string::npos);
}

// The offer is what this player answers rather than what foobar2000 usually answers, so a client
// never draws a control for a mode this install cannot be put into.
TEST_CASE(
    "an order the player does not report is not offered, even though Jean has a name for it") {
    const auto body = capabilitiesReporting({"Default", "Random"});

    CHECK(body["playbackModes"] == std::vector<std::string>{"inOrder", "random"});
}

TEST_CASE("a player reporting no playback orders offers an empty list rather than no key") {
    const auto body = capabilitiesReporting({});

    REQUIRE(body.contains("playbackModes"));
    REQUIRE(body["playbackModes"].is_array());
    CHECK(body["playbackModes"].empty());
}

// Driven from config text rather than from the Settings struct: the key a player owner writes
// and the name a client reads are one decision, and setting the field directly pins half of it.
TEST_CASE("GET /api/capabilities publishes what this install permits, off its own config.json") {
    const auto permitting = [](const char* config) {
        return capabilitiesUnder(parseSettings(config));
    };

    SUBCASE("a config nobody narrowed permits both") {
        CHECK(permitting("{}")["canWritePlaylists"] == true);
        CHECK(permitting("{}")["canChangeOutput"] == true);
    }

    SUBCASE("each one narrows on its own and leaves the other alone") {
        CHECK(permitting(R"({"writePlaylists": false})")["canWritePlaylists"] == false);
        CHECK(permitting(R"({"writePlaylists": false})")["canChangeOutput"] == true);

        CHECK(permitting(R"({"changeOutput": false})")["canChangeOutput"] == false);
        CHECK(permitting(R"({"changeOutput": false})")["canWritePlaylists"] == true);
    }
}

// The set is whatever the client built from its own export; what is missing is the thing to
// resolve it against, and a client told the wrong one retries with a set that cannot land either.
TEST_CASE("a fill with nothing to resolve a set against names what is missing, not the set") {
    FakePlayer foobar;
    holdingForAFill(foobar);
    Library unbuilt;

    const auto refused = [&foobar](Library* library, const std::string& error) {
        const TestServer server(servingSettings(), foobar.player(), library);

        for (const auto& target : targets(kUnresolvableStructure)) {
            INFO("target: ", target.name);

            const auto response = post(server, target.path, target.body);

            REQUIRE(response);
            CHECK(response->status == 503);
            CHECK(json::parse(response->body)["error"] == error);
        }
    };

    SUBCASE("an install that does not serve the library at all") {
        refused(nullptr, "the media library is not available");
    }

    SUBCASE("a library whose first snapshot has not been built yet") {
        refused(&unbuilt, describe(DeltaOutcome::notBuilt));
    }

    CHECK(foobar.count(Call::resolveOwn) == 0);
    CHECK(foobar.count(Call::fill) == 0);
}

TEST_CASE(
    "a fill with no player behind it is a 503 naming what is missing, like every other write") {
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), Player{}, &library);

    const std::map<std::string, std::string> expected = {
        {"the scratch role", "the component's own playlists are not available"},
        {"a user's playlist", "playlist changes are not available"}};

    for (const auto& target : targets(kUnresolvableStructure)) {
        INFO("target: ", target.name);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        CHECK(response->status == 503);
        CHECK(errorOf(*response) == expected.at(target.name));
    }
}

TEST_CASE("a fill resolved against a generation the library has moved past inserts nothing") {
    Library library;
    buildLibrary(library);
    const uint64_t exported = library.state().structure;

    moveLibraryStructure(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    for (const auto& target : targets(exported)) {
        INFO("target: ", target.name);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        CHECK(response->status == 409);

        CHECK(json::parse(response->body)["error"] == describe(DeltaOutcome::structureChanged));
    }

    CHECK(foobar.titlesOf(kScratchPlaylistId) == alreadyHeld());
    CHECK(foobar.titlesOf(kPlaylistId) == alreadyHeld());
}

// Play all and Shuffle all always reach the end of the library, so one deletion at the desktop
// is enough to hit this from a client holding an otherwise valid export.
TEST_CASE("a fill whose ordinals were valid against a larger library answers 409 once it shrinks") {
    Library library;
    buildLibrary(library);
    const uint64_t exported = library.state().structure;

    buildLibrary(library, kLibraryTracks - 6);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    for (const auto& target : targets(exported)) {
        INFO("target: ", target.name);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        CHECK(response->status == 409);

        CHECK(json::parse(response->body)["error"] == describe(DeltaOutcome::structureChanged));
    }

    CHECK(foobar.titlesOf(kScratchPlaylistId) == alreadyHeld());
    CHECK(foobar.titlesOf(kPlaylistId) == alreadyHeld());
}

// Jean titles the scratch after the view it is filling it with, and reads that title back off the
// playlist to say what is playing. So the title is a claim about the rows: a playlist retitled for
// a view it was then refused the rows for is a wrong answer to every reader of it, and a playlist
// left under the first view it ever held is a stale one. The title travels with the rows for that
// reason, and the two arrive in the same main-thread work item as the generation check.
TEST_CASE("the title a fill carries lands with its rows and never ahead of them") {
    Library library;
    buildLibrary(library);
    const uint64_t exported = library.state().structure;

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto made = post(server, kScratchFill, ownBody("#Jean [all music]", exported));
    REQUIRE(made);
    REQUIRE(made->status == 200);
    REQUIRE(titleOf(server, kScratchPlaylistId) == "#Jean [all music]");

    SUBCASE("a second view retitles the playlist it filled") {
        const auto landed = post(server, kScratchFill, ownBody("#Jean Indie Rock", exported));

        REQUIRE(landed);
        REQUIRE(landed->status == 200);
        CHECK(titleOf(server, kScratchPlaylistId) == "#Jean Indie Rock");
    }

    SUBCASE("a view refused for a moved generation leaves the title where it was") {
        moveLibraryStructure(library);

        const auto refused = post(server, kScratchFill, ownBody("#Jean Indie Rock", exported));

        REQUIRE(refused);
        REQUIRE(refused->status == 409);
        CHECK(titleOf(server, kScratchPlaylistId) == "#Jean [all music]");
    }
}

// The scratch is one of foobar2000's own playlists and somebody at the player may close its tab
// whenever they like. Nothing in Jean is told, and no route here can delete it, so a fill is the
// only thing that ever finds the role pointing at nothing: it resolves the role again, every time,
// rather than holding on to the GUID the last one answered.
TEST_CASE("a fill remakes a scratch deleted at the player and lands its rows in the new one") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto first =
        post(server, kScratchFill, ownBody(kScratchTitle, library.state().structure));
    REQUIRE(first);
    REQUIRE(first->status == 200);
    REQUIRE(json::parse(first->body)["playlistId"] == kScratchPlaylistId);

    foobar.removeAtThePlayer(kScratchPlaylistId);

    const auto again =
        post(server, kScratchFill, ownBody(kScratchTitle, library.state().structure));

    const auto remade = FakePlayer::madeId(0);
    REQUIRE(again);
    CHECK(again->status == 200);
    CHECK(json::parse(again->body)["playlistId"] == remade);
    CHECK(foobar.count(Call::resolveOwn) == 2);
    CHECK(foobar.titlesOf(remade) == theFilledTracks());

    const auto found = foundByRole(server);
    REQUIRE(found.size() == 1);
    CHECK(found.front()["id"] == remade);
    CHECK(found.front()["title"] == kScratchTitle);
}

// Jean hides the scratch by its role and reads no title to do it, so the title is left doing one
// job: telling whoever is looking at foobar2000's own tabs that this playlist is Jean's. A title
// that says nothing of the kind is rewritten to say it rather than refused, since refusing would
// bake one client's own naming convention into a title the contract promises to leave alone. The
// promise is kept by what gets written onto the playlist that carries the role, never by a status.
TEST_CASE("a fill leaves the scratch under no title that hides whose playlist it is") {
    Library library;
    buildLibrary(library);

    for (const std::string& asked : {std::string("#Jean [all music]"), std::string("Party mix")}) {
        INFO("title the fill asked for: ", asked);

        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto response = post(server, kScratchFill, ownBody(asked, library.state().structure));
        REQUIRE(response);
        CHECK(response->status == 200);

        const auto found = foundByRole(server);
        REQUIRE(found.size() == 1);

        const auto title = found.front().at("title").get<std::string>();
        INFO("titled at the player: ", title);
        CHECK(title.substr(0, kJeanPrefix.size()) == kJeanPrefix);
    }
}

// What the case above leaves open, and what the contract states nowhere: the separator between
// the prefix and the title asked for is one space, and "already prefixed" is an exact match,
// case included. A lowercase #jean is therefore prefixed again rather than left alone. This is
// what ships, and it is here so that a reader who would rather it were case-insensitive changes
// it deliberately instead of by tidying.
TEST_CASE("the scratch's title is prefixed on an exact-case match and separated by one space") {
    Library library;
    buildLibrary(library);

    struct Titling {
        std::string asked;
        std::string atThePlayer;
    };

    for (const auto& titling :
         {Titling{"Party mix", "#Jean Party mix"}, Titling{"#Jean Party mix", "#Jean Party mix"},
          Titling{"#jean mix", "#Jean #jean mix"}}) {
        INFO("title the fill asked for: ", titling.asked);

        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto response =
            post(server, kScratchFill, ownBody(titling.asked, library.state().structure));

        REQUIRE(response);
        REQUIRE(response->status == 200);

        const auto found = foundByRole(server);
        REQUIRE(found.size() == 1);
        CHECK(found.front().at("title") == titling.atThePlayer);
    }
}

// kMaxTitle bounds the request and not the tab. It is this component's own number rather than
// anything foobar2000 imposes, and a tab title takes the six characters the prefix adds without
// complaint, so a title at the bound is accepted and the playlist ends up longer than it.
// Shrinking the accepted title by the prefix instead would refuse titles that work today.
TEST_CASE("a title at the bound is accepted and reaches the player with the prefix on top of it") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const std::string asked(kMaxTitle, 'a');
    const auto response = post(server, kScratchFill, ownBody(asked, library.state().structure));

    REQUIRE(response);
    CHECK(response->status == 200);

    const auto found = foundByRole(server);
    REQUIRE(found.size() == 1);

    const auto title = found.front().at("title").get<std::string>();
    std::string expected{kJeanPrefix};
    expected += ' ';
    expected += asked;
    CHECK(title == expected);
    CHECK(title.size() > kMaxTitle);
}

TEST_CASE("each fill operation addresses its own kind of playlist") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    SUBCASE("the scratch role fills the playlist that role resolved to") {
        const auto response =
            post(server, kScratchFill, ownBody(kScratchTitle, library.state().structure));

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(foobar.count(Call::resolveOwn) == 1);
        CHECK(foobar.askedAbout(Call::fill) == std::vector<std::string>{kScratchPlaylistId});
        CHECK(foobar.titlesOf(kScratchPlaylistId) == theFilledTracks());
        CHECK(titleOf(server, kScratchPlaylistId) == kScratchTitle);
    }

    SUBCASE("a user's playlist is filled by the GUID it was asked for, resolving no role") {
        const auto response = post(server, userFill(), userBody(library.state().structure));

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(foobar.count(Call::resolveOwn) == 0);
        CHECK(foobar.askedAbout(Call::fill) == std::vector<std::string>{kPlaylistId});
    }
}

TEST_CASE("a role the contract does not name is refused rather than made") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    for (const std::string& role : {std::string("library"), std::string("Scratch"),
                                    std::string("queue2"), std::string(kPlaylistId)}) {
        INFO("role: ", role);

        const auto response = post(server, "/api/playlists/own/" + role + "/items",
                                   ownBody(kScratchTitle, library.state().structure));

        REQUIRE(response);
        CHECK(response->status == 400);
    }

    CHECK(foobar.count(Call::resolveOwn) == 0);
    CHECK(foobar.count(Call::fill) == 0);
}

// The play queue is this component's own, read and written through /api/queue, and the playlist
// a client used to hold library tracks in went with the role that resolved it. A client still
// sending the old fill is told the role is not one of ours, rather than left filling a playlist
// that will never be queued from, emptied or deleted, and that shows up in foobar2000's own tabs
// for as long as the install lasts.
TEST_CASE("the queue role is gone, and neither verb on it reaches the player") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto filled = post(server, kQueueFill, ownBody(kScratchTitle, library.state().structure));
    const auto emptied = server.client().Delete(kQueueFill);
    const auto invented = post(server, "/api/playlists/own/library/items",
                               ownBody(kScratchTitle, library.state().structure));

    REQUIRE(filled);
    REQUIRE(emptied);
    REQUIRE(invented);

    CHECK(filled->status == 400);
    CHECK(emptied->status == 400);

    // One mistake, one refusal: a client naming a role this component does not have. There is
    // nothing more specific to say about `queue` than about any other word.
    CHECK(json::parse(filled->body) == json::parse(invented->body));
    CHECK(json::parse(emptied->body) == json::parse(invented->body));

    CHECK(foobar.writes() == 0);
    CHECK(foobar.titlesOf(kScratchPlaylistId) == alreadyHeld());
    CHECK(foobar.titlesOf(kPlaylistId) == alreadyHeld());
}

TEST_CASE("the scratch playlist is emptied before a fill and every other target is appended to") {
    Library library;
    buildLibrary(library);

    for (const auto& target : targets(library.state().structure)) {
        INFO("target: ", target.name);

        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        CHECK(response->status == 200);
        REQUIRE(foobar.count(Call::fill) == 1);
        CHECK(foobar.titlesOf(target.id) == filled(target));
    }
}

// Both fill schemas publish `additionalProperties: false`, and `replace` is the field that costs:
// a fill empties the playlist or appends to it according to the target, so a client sending it
// would be told nothing while the component appended. `items` is here because the rule is
// every field the contract does not declare rather than `replace` in particular.
TEST_CASE("a field neither fill schema declares is refused, and nothing is inserted") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const std::vector<std::pair<std::string, json>> undeclared{
        {"replace", true}, {"items", json::array({"Artist/Album/1.flac"})}};

    for (const auto& target : targets(library.state().structure)) {
        for (const auto& field : undeclared) {
            INFO("target: ", target.name, ", field: ", field.first);

            const auto response =
                post(server, target.path, withField(target.body, field.first, field.second));

            REQUIRE(response);
            CHECK(response->status == 400);

            // The envelope was wrong rather than the set, which is the other refusal a client
            // switches on here: it would send a caller looking at ordinals it sent correctly.
            CHECK(json::parse(response->body)["error"] == "malformed request");
        }
    }

    // Resolving a role makes the playlist if it is not there, so a refusal that reaches the player
    // leaves a `#Jean` playlist behind for a request that was never acceptable.
    CHECK(foobar.count(Call::resolveOwn) == 0);
    CHECK(foobar.count(Call::fill) == 0);
}

TEST_CASE("a title is declared on the component's own playlist and undeclared on a user's") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    SUBCASE("the component's own role takes one") {
        const auto scratch =
            post(server, kScratchFill, ownBody(kScratchTitle, library.state().structure));
        REQUIRE(scratch);
        CHECK(scratch->status == 200);

        CHECK(foobar.count(Call::fill) == 1);
        CHECK(titleOf(server, kScratchPlaylistId) == kScratchTitle);
    }

    SUBCASE("a user's playlist is refused rather than retitled") {
        const auto response =
            post(server, userFill(),
                 withField(userBody(library.state().structure), "title", "#Jean Scratch"));

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"] == "malformed request");
        CHECK(foobar.count(Call::fill) == 0);
    }
}

// FillOwnPlaylistRequest.title carries the same limit as an autoplaylist's: a line break in
// it would be a line break in a foobar2000 playlist tab, and 256 characters is the same cap
// parseAutoPlaylist holds a title to. Both routes take a title from the same check for
// exactly that reason.
TEST_CASE("a title on the component's own playlist is held to the limit an autoplaylist's is") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    SUBCASE("a control character is refused rather than reaching the player") {
        const auto response =
            post(server, kScratchFill,
                 withField(ownBody(kScratchTitle, library.state().structure), "title", "a\nb"));

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"] == "unacceptable title");
        CHECK(foobar.count(Call::resolveOwn) == 0);
        CHECK(foobar.count(Call::fill) == 0);
    }

    SUBCASE("longer than 256 characters is refused rather than truncated") {
        const auto response = post(server, kScratchFill,
                                   withField(ownBody(kScratchTitle, library.state().structure),
                                             "title", std::string(257, 'a')));

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"] == "unacceptable title");
        CHECK(foobar.count(Call::fill) == 0);
    }
}

// What the answer is for: a client that has queued a set learns where its rows went instead of
// reading the playlist back and matching rows to refs, which is the linear re-match Jean does
// today. Filling a playlist that already holds rows is what tells a real position apart from the
// ordinals handed back, or from a count that always starts at zero.
TEST_CASE("a fill answers the positions the rows landed at rather than the ordinals it was given") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    SUBCASE("an append lands after the rows the playlist already held") {
        for (const auto& target :
             appendTargets(structure, json{{"ordinals", json::array({3, 1, 6})}})) {
            INFO("target: ", target.name);

            FakePlayer foobar(&library);
            holdingForAFill(foobar);
            const TestServer server(servingSettings(), foobar.player(), &library);

            const auto response = post(server, target.path, target.body);

            REQUIRE(response);
            REQUIRE(response->status == 200);
            CHECK(json::parse(response->body)["positions"] == json::array({5, 6, 7}));
        }
    }

    SUBCASE("a replace lands at zero, because the scratch is emptied before it is filled") {
        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto response = post(server, kScratchFill, ownBody(kScratchTitle, structure));

        REQUIRE(response);
        REQUIRE(response->status == 200);
        CHECK(json::parse(response->body)["positions"] == json::array({0, 1}));
    }

    SUBCASE("a set given as runs answers one position per row the runs expand to") {
        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto body =
            naming(userBody(structure),
                   json{{"runs", json::array({json::array({0, 2}), json::array({5, 1})})}});

        const auto response = post(server, userFill(), body);

        REQUIRE(response);
        REQUIRE(response->status == 200);
        CHECK(json::parse(response->body)["positions"] == json::array({5, 6, 7}));
    }
}

// One field, two sources. The `own` route answers the id the role resolved to, which the client
// never named and has no other way to learn, and the `{id}` route answers the id the request
// carried. A client addresses a row as a playlist and an index, so the positions are worth
// nothing beside the wrong playlist.
TEST_CASE("a fill answers the id of the playlist the rows landed in") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    for (const auto& target : targets(structure)) {
        INFO("target: ", target.name);

        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        REQUIRE(response->status == 200);
        CHECK(json::parse(response->body)["playlistId"] == target.id);
    }
}

TEST_CASE(
    "a fill answers exactly the playlist, its generation, the positions and what it skipped, "
    "from either route") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    for (const auto& target : targets(structure)) {
        INFO("target: ", target.name);

        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        REQUIRE(response->status == 200);
        CHECK(keysOf(response->body) == Keys{"playlistId", "structure", "positions", "skipped"});
    }
}

// A fill answers the target's own structure generation exactly as a copy does, so an undo can
// name it rather than reading the playlist list to learn one that may already have moved. The
// value is nineteen digits, past where a JSON number stays exact, and it has to survive the trip
// with every one of them intact and move again on a second insert rather than repeat.
TEST_CASE("a fill answers the generation the target landed at, whole and moving on every insert") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    for (const auto& target : targets(structure)) {
        INFO("target: ", target.name);

        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto first = post(server, target.path, target.body);
        REQUIRE(first);
        REQUIRE(first->status == 200);
        const auto firstGeneration = counterIn(json::parse(first->body), "structure");
        CHECK(firstGeneration == std::to_string(kRowsStructure + 1));

        const auto second = post(server, target.path, target.body);
        REQUIRE(second);
        REQUIRE(second->status == 200);
        const auto secondGeneration = counterIn(json::parse(second->body), "structure");

        CHECK(secondGeneration == std::to_string(kRowsStructure + 2));
        CHECK(secondGeneration != firstGeneration);
    }
}

TEST_CASE(
    "with writePlaylists off, every write but the component's own is refused and never "
    "reaches the player") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingEveryWriteTarget(foobar);
    const TestServer server(readOnlyPlaylists(), foobar.player(), &library);

    for (const auto& write : playlistWrites(library.state().structure)) {
        INFO("write: ", write.name);

        const auto response = write.send(server);

        REQUIRE(response);
        CHECK(response->status == 403);

        CHECK(errorOf(*response) == describe(PlayerOutcome::writesDisabled));
    }

    CHECK(foobar.writes() == 0);
}

// Taking a plain playlist over would have foobar2000 replace its rows with a query's results, so
// both autoplaylist routes refuse one and change nothing. The setting's 403 is decided before the
// player is asked, whatever the target; this refusal is something only the player can report, and
// naming the setting in it sends a player owner to config.json to turn on something already on.
TEST_CASE(
    "an autoplaylist route refuses a plain playlist as not an autoplaylist and leaves it as it "
    "was, in words other than the setting's") {
    const auto names = [](const std::string& message, const std::string& what) {
        return message.find(what) != std::string::npos;
    };

    for (const auto& edit : autoPlaylistEdits()) {
        INFO("edit: ", edit.name);

        FakePlayer gated;
        holdingTwoPlaylists(gated);
        gated.add(foreignAutoPlaylist());
        const TestServer refusing(readOnlyPlaylists(), gated.player());

        for (const std::string id : {kPlaylistId, kForeignAutoPlaylistId}) {
            INFO("id: ", id);
            const auto bySetting = edit.send(refusing, id);
            REQUIRE(bySetting);
            CHECK(bySetting->status == 403);
            CHECK(errorOf(*bySetting) == describe(PlayerOutcome::writesDisabled));
        }
        CHECK(gated.writes() == 0);

        FakePlayer asked;
        holdingTwoPlaylists(asked);
        const TestServer writing(servingSettings(), asked.player());
        const auto before = listingOf(writing);

        const auto byKind = edit.send(writing, kPlaylistId);
        REQUIRE(byKind);
        CHECK(byKind->status == 409);
        CHECK(json::parse(byKind->body) ==
              json{{"error", "that playlist is not an autoplaylist"}, {"detail", ""}});

        CHECK(listingOf(writing) == before);
        CHECK(heldTitles(writing, kPlaylistId) == json(roadTripTitles()));

        const auto kind = errorOf(*byKind);

        CHECK_FALSE(names(kind, "writePlaylists"));
        CHECK_FALSE(names(kind, "config.json"));

        const auto published = publishedEnum("PlaylistFailed", "error");
        CHECK(std::find(published.begin(), published.end(), kind) != published.end());
    }
}

// The setting protects the user's music, and the scratch holds none: it is how Jean plays a set.
// A setting that stopped that is the setting doing the wrong thing, so the role is driven in
// both states rather than only in the one that shipped.
TEST_CASE("the component's own playlist fills whether writePlaylists is on or off") {
    Library library;
    buildLibrary(library);

    for (const bool writePlaylists : {true, false}) {
        INFO("writePlaylists: ", writePlaylists);

        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        const TestServer server(writePlaylists ? servingSettings() : readOnlyPlaylists(),
                                foobar.player(), &library);

        const auto response =
            post(server, kScratchFill, ownBody(kScratchTitle, library.state().structure));

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(foobar.titlesOf(kScratchPlaylistId) == theFilledTracks());
    }
}

// The scratch is Jean's own working space, addressed by role and never by GUID. An edit reaching
// it by GUID would rename, delete or empty the playlist somebody is listening from, so the switch
// being on does not buy one: the refusal is structural rather than the setting's.
TEST_CASE(
    "an edit addressing the component's own scratch playlist is refused whether "
    "writePlaylists is on or off") {
    for (const bool writePlaylists : {true, false}) {
        INFO("writePlaylists: ", writePlaylists);
        const auto settings = writePlaylists ? servingSettings() : readOnlyPlaylists();

        for (const auto& edit : playlistEdits()) {
            INFO("edit: ", edit.name);

            FakePlayer foobar;
            holdingThreePlaylists(foobar);
            foobar.add(scratchEntry());
            const TestServer server(settings, foobar.player());

            const auto before = idsIn(listingOf(server));

            const auto response = edit.send(server, kScratchPlaylistId);

            REQUIRE(response);
            CHECK(response->status == 403);
            namesTheRole(*response, writePlaylists);

            // Two reads because the three edits move different things: the order of the ids
            // carries a delete and a move, and the title carries a rename.
            CHECK(idsIn(listingOf(server)) == before);
            CHECK(titleOf(server, kScratchPlaylistId) == scratchEntry().title);
        }

        for (const auto& edit : rowEdits()) {
            INFO("edit: ", edit.name);

            FakePlayer foobar;
            holdingTwoPlaylists(foobar);
            holdingTheScratch(foobar);
            const TestServer server(settings, foobar.player());

            const auto before = heldTitles(server, kScratchPlaylistId);

            const auto response = edit.send(server, kScratchPlaylistId);

            REQUIRE(response);
            CHECK(response->status == 403);
            namesTheRole(*response, writePlaylists);

            CHECK(heldTitles(server, kScratchPlaylistId) == before);
        }
    }
}

TEST_CASE(
    "an autoplaylist route addressing the scratch is refused as the component's own whether "
    "writePlaylists is on or off") {
    for (const bool writePlaylists : {true, false}) {
        INFO("writePlaylists: ", writePlaylists);
        const auto settings = writePlaylists ? servingSettings() : readOnlyPlaylists();

        for (const auto& edit : autoPlaylistEdits()) {
            INFO("edit: ", edit.name);

            FakePlayer foobar;
            holdingTwoPlaylists(foobar);
            holdingTheScratch(foobar);
            const TestServer server(settings, foobar.player());

            const auto before = listingOf(server);
            const auto rows = heldTitles(server, kScratchPlaylistId);

            const auto response = edit.send(server, kScratchPlaylistId);

            REQUIRE(response);
            CHECK(response->status == 403);
            namesTheRole(*response, writePlaylists);

            CHECK(listingOf(server) == before);
            CHECK(heldTitles(server, kScratchPlaylistId) == rows);
        }
    }
}

// The sixth way in, and the one a fill route cannot refuse from inside the seam: the role route
// resolves the role itself and then hands the same seam that GUID, so what refuses this has to
// be the route. A client holding the id this component reports its role on would otherwise
// replace the rows of the playlist Jean is playing a set from.
TEST_CASE("a fill addressing the scratch by its id is refused, and the role route still fills it") {
    Library library;
    buildLibrary(library);

    for (const bool writePlaylists : {true, false}) {
        INFO("writePlaylists: ", writePlaylists);

        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        const TestServer server(writePlaylists ? servingSettings() : readOnlyPlaylists(),
                                foobar.player(), &library);

        const auto first =
            post(server, kScratchFill, ownBody(kScratchTitle, library.state().structure));
        REQUIRE(first);
        REQUIRE(first->status == 200);

        const auto rows = foobar.titlesOf(kScratchPlaylistId);
        const auto fills = foobar.count(Call::fill);

        const auto byId =
            post(server, "/api/playlists/" + std::string(kScratchPlaylistId) + "/items",
                 userBody(library.state().structure));

        REQUIRE(byId);
        CHECK(byId->status == 403);
        namesTheRole(*byId, writePlaylists);
        CHECK(foobar.count(Call::fill) == fills);
        CHECK(foobar.titlesOf(kScratchPlaylistId) == rows);

        const auto again =
            post(server, kScratchFill, ownBody(kScratchTitle, library.state().structure));

        REQUIRE(again);
        CHECK(again->status == 200);
        CHECK(json::parse(again->body)["playlistId"] == kScratchPlaylistId);
        CHECK(foobar.count(Call::fill) == fills + 1);
        CHECK(foobar.titlesOf(kScratchPlaylistId) == rows);
    }
}

// The third answer the role read can give, and the one that decides whether the scratch is safe
// while the component is struggling: not "this is the scratch" and not "this is not", but the
// player never said. A fill let through here is a client with the scratch's GUID replacing the
// rows Jean is playing from, at exactly the moment nothing else is working. The status is the
// read's own, because 403 would claim the component knew whose playlist this was.
TEST_CASE(
    "a fill by id whose role the component could not read is refused with the read's own "
    "outcome") {
    struct Unanswered {
        PlayerOutcome outcome;
        int status;
    };

    Library library;
    buildLibrary(library);

    for (const auto& read : {Unanswered{PlayerOutcome::timedOut, 504},
                             Unanswered{PlayerOutcome::playerRefused, 500}}) {
        INFO("outcome: ", describe(read.outcome));

        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        foobar.refuse(Call::readRole, read.outcome);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto response = post(server, userFill(), userBody(library.state().structure));

        REQUIRE(response);
        CHECK(response->status == read.status);
        CHECK(foobar.count(Call::fill) == 0);
        CHECK(foobar.titlesOf(kPlaylistId) == alreadyHeld());
    }
}

// Whether one playlist is the scratch is a question about that playlist alone. Listing every
// playlist to answer it costs a main-thread walk the size of the player's list on every fill.
TEST_CASE("a fill by id asks the player about that one playlist and never lists them all") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto response = post(server, userFill(), userBody(library.state().structure));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(foobar.count(Call::listPlaylists) == 0);
    CHECK(foobar.askedAbout(Call::readRole) == std::vector<std::string>{kPlaylistId});
    CHECK(foobar.count(Call::fill) == 1);
}

// The asymmetry the refusal above turns on, and the rule it rests on: the scratch may not be
// addressed as the thing being changed, and may always be read from. Jean plays a search through
// the scratch, so *Add to playlist* and *Save as playlist* over those results both read its rows
// and write somebody else's playlist. A refusal that looked at the GUID wherever it appeared
// would take both away, which is why the two routes that carry a source are driven here.
TEST_CASE("a copy whose source is the scratch lands the rows in the playlist it names") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    holdingTheScratch(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response =
        post(server, copyPath(kPlaylistId),
             copyBody(kScratchPlaylistId, json::array({json::array({0, 2})})).dump());

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(foobar.count(Call::copyRows) == 1);

    CHECK(heldTitles(server, kPlaylistId) ==
          json::array({"First", "Second", "Third", "Fourth", "Result A", "Result B"}));
}

// The other half of that rule, and the one *Save as playlist* rides on: a create takes a source
// playlist and runs of its positions, so the results Jean played through the scratch reach a
// playlist of the user's in one request.
TEST_CASE(
    "a create whose source is the scratch fills the new playlist and leaves the scratch "
    "standing") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    holdingTheScratch(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto before = heldTitles(server, kScratchPlaylistId);

    const auto response = post(server, kCreatePlaylist,
                               createBody({{kSourceField, kScratchPlaylistId},
                                           {"runs", json::array({json::array({0, 2})})}}));

    REQUIRE(response);
    CHECK(response->status == 200);
    const auto made = json::parse(response->body);
    CHECK(made["itemCount"] == 2);
    CHECK(foobar.titlesOf(made["id"].get<std::string>()) ==
          std::vector<std::string>{"Result A", "Result B"});

    CHECK(heldTitles(server, kScratchPlaylistId) == before);
}

TEST_CASE(
    "an install that never set writePlaylists permits every write the setting would "
    "refuse") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingEveryWriteTarget(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    for (const auto& write : playlistWrites(library.state().structure)) {
        INFO("write: ", write.name);

        const auto response = write.send(server);

        REQUIRE(response);
        CHECK(response->status == write.whenAccepted);
    }

    CHECK(foobar.count(Call::createAutoPlaylist) == 1);
    CHECK(foobar.count(Call::updateAutoPlaylist) == 1);
    CHECK(foobar.count(Call::removeAutoPlaylist) == 1);
    CHECK(foobar.count(Call::fill) == 1);

    CHECK(foobar.count(Call::createPlaylist) == 1);
    CHECK(foobar.count(Call::renamePlaylist) == 1);
    CHECK(foobar.count(Call::movePlaylist) == 1);
    CHECK(foobar.count(Call::removePlaylist) == 1);
    CHECK(foobar.count(Call::copyRows) == 1);
    CHECK(foobar.count(Call::removeRows) == 1);
    CHECK(foobar.count(Call::moveRows) == 1);
    CHECK(foobar.count(Call::sortRows) == 1);

    CHECK(foobar.titlesOf(kPlaylistId) ==
          std::vector<std::string>{"First", "Fourth", "Second", "Third", builtTrackTitle(3),
                                   builtTrackTitle(1), "Source A", "Source B", "Source D"});
}

TEST_CASE("what refuses a fill is the setting and never the playlist's title") {
    Library library;
    buildLibrary(library);

    for (const std::string& title : {std::string("#Jean Queue"), std::string("Road trip")}) {
        for (const bool writePlaylists : {true, false}) {
            INFO("title: ", title, ", writePlaylists: ", writePlaylists);

            FakePlayer foobar(&library);
            foobar.add(userPlaylist(kPlaylistId, title, kRowsStructure));
            const TestServer server(writePlaylists ? servingSettings() : readOnlyPlaylists(),
                                    foobar.player(), &library);

            const auto response = post(server, userFill(), userBody(library.state().structure));

            REQUIRE(response);
            CHECK(response->status == (writePlaylists ? 200 : 403));
            CHECK(foobar.count(Call::fill) == (writePlaylists ? 1 : 0));
        }
    }
}

// "It holds nothing afterwards" is half the promise: an empty that deleted the playlist and made
// another would satisfy that, lose the playlist the player is playing from, and take foobar2000
// down with it wherever the play queue pointed into the one it deleted.
TEST_CASE("emptying the role takes its playlist's rows and leaves the playlist itself standing") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto response = server.client().Delete(kScratchFill);

    REQUIRE(response);
    INFO("status: ", response->status);
    CHECK(accepted(response));

    CHECK(foobar.titlesOf(kScratchPlaylistId).empty());
    CHECK(foobar.count(Call::removePlaylist) == 0);
    CHECK(foobar.count(Call::removeAutoPlaylist) == 0);

    const auto found = foundByRole(server);
    REQUIRE(found.size() == 1);
    CHECK(found.front()["id"] == kScratchPlaylistId);

    // A user's playlist is not this request's to take rows from either, whatever it holds.
    CHECK(foobar.titlesOf(kPlaylistId) == alreadyHeld());
}

// One 503, two subsystems behind it. A player that cannot reach the component's own playlists
// has said nothing about autoplaylists, and a message naming those sends a player owner to
// maxAutoPlaylists over a playlist no limit governs.
TEST_CASE("an empty the player cannot serve names its own playlists rather than autoplaylists") {
    const TestServer server;

    const auto response = server.client().Delete(kScratchFill);

    REQUIRE(response);
    CHECK(response->status == 503);

    const std::string error = json::parse(response->body)["error"];
    CHECK(error != describe(PlayerOutcome::unavailable));
    CHECK(error.find("autoplaylist") == std::string::npos);
}

// The scratch holds no music of the user's: it is how Jean plays a set, emptied and refilled for
// every view. A setting meant to protect a user's playlists has nothing to say about it.
TEST_CASE("the component's own playlist empties whether writePlaylists is on or off") {
    Library library;
    buildLibrary(library);

    for (const bool writePlaylists : {true, false}) {
        INFO("writePlaylists: ", writePlaylists);

        FakePlayer foobar(&library);
        holdingForAFill(foobar);
        const TestServer server(writePlaylists ? servingSettings() : readOnlyPlaylists(),
                                foobar.player(), &library);

        const auto response = server.client().Delete(kScratchFill);

        REQUIRE(response);
        INFO("status: ", response->status);
        CHECK(accepted(response));
        CHECK(foobar.titlesOf(kScratchPlaylistId).empty());
    }
}

TEST_CASE("a role the contract does not name is refused on an empty exactly as it is on a fill") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    for (const std::string& role : {std::string("library"), std::string("Scratch"),
                                    std::string("queue2"), std::string(kPlaylistId)}) {
        INFO("role: ", role);
        const auto path = "/api/playlists/own/" + role + "/items";

        const auto emptied = server.client().Delete(path);
        const auto filled = post(server, path, ownBody(kScratchTitle, library.state().structure));

        REQUIRE(emptied);
        REQUIRE(filled);

        CHECK(emptied->status == 400);
        CHECK(emptied->status == filled->status);
        CHECK(json::parse(emptied->body)["error"] == json::parse(filled->body)["error"]);
    }

    CHECK(foobar.titlesOf(kScratchPlaylistId) == alreadyHeld());
    CHECK(foobar.writes() == 0);
}

TEST_CASE("the contract publishes a 403 on exactly the writes the setting can refuse") {
    const auto published = publishedRoutes();

    const auto answers403 = [&published](const std::string& name) {
        const auto found = std::find_if(
            published.begin(), published.end(),
            [&name](const SpecRoute& route) { return route.method + " " + route.path == name; });

        REQUIRE_MESSAGE(found != published.end(), "contract/openapi.yaml publishes no ", name);
        return found->statuses.count(403) == 1;
    };

    for (const std::string& name :
         {std::string("POST /autoplaylists"), std::string("POST /autoplaylists/{id}"),
          std::string("DELETE /autoplaylists/{id}"), std::string("POST /playlists/{id}/items"),
          std::string("POST /playlists/{id}/items/move"),
          std::string("POST /playlists/{id}/items/sort")}) {
        INFO("route: ", name);
        CHECK(answers403(name));
    }

    CHECK(answers403("POST /playlists/own/{role}/items"));
    CHECK(answers403("DELETE /playlists/own/{role}/items"));
}

TEST_CASE("the contract publishes a 429 on every write the playlist limit can refuse") {
    const auto published = publishedRoutes();

    const auto statusesOf = [&published](const std::string& name) {
        const auto found = std::find_if(
            published.begin(), published.end(),
            [&name](const SpecRoute& route) { return route.method + " " + route.path == name; });

        REQUIRE_MESSAGE(found != published.end(), "contract/openapi.yaml publishes no ", name);
        return found->statuses;
    };

    for (const std::string& name :
         {std::string("POST /playlists"), std::string("POST /playlists/{id}"),
          std::string("DELETE /playlists/{id}"), std::string("POST /playlists/{id}/move"),
          std::string("POST /playlists/{id}/items/copy"),
          std::string("POST /playlists/{id}/items/remove"),
          std::string("POST /playlists/{id}/items/move"),
          std::string("POST /playlists/{id}/items/sort")}) {
        INFO("route: ", name);
        CHECK(statusesOf(name).count(429) == 1);
    }

    // Reading spends nothing, so a client may page a playlist while another is being written.
    CHECK(statusesOf("GET /playlists").count(429) == 0);
    CHECK(statusesOf("GET /playlists/{id}/items").count(429) == 0);
}

TEST_CASE("with controlPlayback off, playing a row and both scratch routes are 403") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(parseSettings(R"({"controlPlayback": false})"), foobar.player(),
                            &library);

    std::set<std::string> sentences;
    const auto refused = [&sentences](const char* name, const httplib::Result& response) {
        INFO(std::string(name));
        REQUIRE(response);
        CHECK(response->status == 403);

        const auto error = errorOf(*response);
        CHECK_FALSE(error.empty());
        sentences.insert(error);
    };

    refused("play a row", post(server, playPath(kPlaylistId, "0"), ""));
    refused("fill the scratch",
            post(server, kScratchFill, ownBody(kScratchTitle, library.state().structure)));
    refused("empty the scratch", server.client().Delete(kScratchFill));

    CHECK(foobar.writes() == 0);
    CHECK(foobar.titlesOf(kScratchPlaylistId) == alreadyHeld());

    REQUIRE(sentences.size() == 1);
    CHECK(sentences.begin()->find("controlPlayback") != std::string::npos);
}

// Playing a row is playback rather than a playlist write, so a guard copied from writesRefused
// onto the play route would break every read-only install's play button.
TEST_CASE("with writePlaylists off and controlPlayback on, playing a row reaches the player") {
    FakePlayer foobar;
    holdingRows(foobar);
    const TestServer server(parseSettings(R"({"writePlaylists": false, "controlPlayback": true})"),
                            foobar.player());

    const auto response = post(server, playPath(kPlaylistId, "3"), "");

    REQUIRE(response);
    CHECK(response->status == 204);
    CHECK(foobar.count(Call::playRow) == 1);
}

namespace {

constexpr char kDuplicatesField[] = "duplicates";

std::vector<FakeRow> libraryTracks(const std::vector<uint32_t>& ordinals) {
    std::vector<FakeRow> rows;
    std::transform(ordinals.begin(), ordinals.end(), std::back_inserter(rows), libraryTrack);
    return rows;
}

std::vector<std::string> libraryTitles(const std::vector<uint32_t>& ordinals) {
    std::vector<std::string> titles;
    std::transform(ordinals.begin(), ordinals.end(), std::back_inserter(titles), builtTrackTitle);
    return titles;
}

const std::vector<uint32_t>& ordinalsRoadTripHolds() {
    static const std::vector<uint32_t> ordinals = {1, 6, 2};
    return ordinals;
}

void holdingLibraryTracks(FakePlayer& player) {
    player.add(userPlaylist(kPlaylistId, "Road trip", kRowsStructure),
               libraryTracks(ordinalsRoadTripHolds()));
}

std::string fillBody(uint64_t structure, const json& set) {
    return naming(userBody(structure), set);
}

std::string skippingFill(uint64_t structure, const json& set) {
    return withField(fillBody(structure, set), kDuplicatesField, "skip");
}

std::vector<std::string> sourceSharingTwoTitles() {
    return {"Source A", "Second", "Source C", "Fourth", "Source E"};
}

void holdingASourceSharingTwoTracks(FakePlayer& player) {
    player.add(userPlaylist(kPlaylistId, "Road trip", kRowsStructure),
               titledRows(roadTripTitles()));
    player.add(userPlaylist(kSecondPlaylistId, "Everything", kSourceStructure),
               titledRows(sourceSharingTwoTitles()));
}

json skippingCopy(const std::string& sourceId, const json& runs) {
    auto body = copyBody(sourceId, runs);
    body[kDuplicatesField] = "skip";
    return body;
}

std::vector<json> unlistedDuplicates() {
    return {"replace", "Skip", "", true, 1, nullptr, json::array({"skip"})};
}

}  // namespace

// What the field is for: *Add to playlist* over a selection that overlaps the playlist asks about
// the overlap rather than doubling it, and it can only ask about tracks the answer named. The
// `ordinals` form is the one that can carry an order, so the skipped ones are checked out of
// ascending order here.
TEST_CASE(
    "a fill skipping duplicates inserts only the tracks the playlist did not hold and names "
    "the rest in the order they were asked for") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingLibraryTracks(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto before = generationOf(server, kPlaylistId);

    const auto response = post(
        server, userFill(),
        skippingFill(library.state().structure, json{{"ordinals", json::array({6, 3, 1, 5})}}));

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(answered.at("positions") == json::array({3, 4}));
    CHECK(answered.at("skipped") == json::array({6, 1}));

    CHECK(foobar.titlesOf(kPlaylistId) == libraryTitles({1, 6, 2, 3, 5}));

    const auto generation = counterIn(answered, "structure");
    CHECK(generation == generationOf(server, kPlaylistId));
    CHECK(generation != before);
}

TEST_CASE("a set given as runs names what it skipped in ascending ordinal order") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingLibraryTracks(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto set = json{{"runs", json::array({json::array({5, 2}), json::array({0, 3})})}};
    const auto response = post(server, userFill(), skippingFill(library.state().structure, set));

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(answered.at("positions") == json::array({3, 4}));
    CHECK(answered.at("skipped") == json::array({1, 2, 6}));
    CHECK(foobar.titlesOf(kPlaylistId) == libraryTitles({1, 6, 2, 0, 5}));
}

TEST_CASE("a fill skipping duplicates of which the playlist holds none inserts every track") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingLibraryTracks(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto response =
        post(server, userFill(),
             skippingFill(library.state().structure, json{{"ordinals", json::array({7, 0})}}));

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(answered.at("positions") == json::array({3, 4}));
    CHECK(answered.at("skipped") == json::array());
    CHECK(foobar.titlesOf(kPlaylistId) == libraryTitles({1, 6, 2, 7, 0}));
}

// The generation is the one an undo would name, and nothing happened for an undo to take back:
// a generation that moved here would also make every client holding the playlist read it again
// for no change.
TEST_CASE(
    "a fill skipping duplicates all of which the playlist holds is a 200 that inserts nothing "
    "and leaves the generation where it stood") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingLibraryTracks(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto before = generationOf(server, kPlaylistId);

    const auto response =
        post(server, userFill(),
             skippingFill(library.state().structure, json{{"ordinals", json::array({2, 1})}}));

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(answered.at("playlistId") == kPlaylistId);
    CHECK(answered.at("positions") == json::array());
    CHECK(answered.at("skipped") == json::array({2, 1}));
    CHECK(counterIn(answered, "structure") == before);

    CHECK(generationOf(server, kPlaylistId) == before);
    CHECK(foobar.titlesOf(kPlaylistId) == libraryTitles(ordinalsRoadTripHolds()));
}

TEST_CASE("a fill saying `add`, or saying nothing, inserts a track the playlist already holds") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    const auto set = json{{"ordinals", json::array({6, 3})}};

    for (const auto& body :
         {fillBody(structure, set), withField(fillBody(structure, set), kDuplicatesField, "add")}) {
        INFO("body: ", body);

        FakePlayer foobar(&library);
        holdingLibraryTracks(foobar);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto response = post(server, userFill(), body);

        REQUIRE(response);
        REQUIRE(response->status == 200);

        const auto answered = json::parse(response->body);
        CHECK(answered.at("positions") == json::array({3, 4}));
        CHECK(answered.at("skipped") == json::array());
        CHECK(foobar.titlesOf(kPlaylistId) == libraryTitles({1, 6, 2, 6, 3}));
    }
}

// Only what the playlist held beforehand counts. A request deduplicated against itself would
// drop a repeat somebody asked for and have no ordinal position to name it by.
TEST_CASE("a track a fill names twice is inserted twice, or skipped twice, under `skip`") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingLibraryTracks(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto response = post(
        server, userFill(),
        skippingFill(library.state().structure, json{{"ordinals", json::array({4, 6, 4, 6})}}));

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(answered.at("positions") == json::array({3, 4}));
    CHECK(answered.at("skipped") == json::array({6, 6}));
    CHECK(foobar.titlesOf(kPlaylistId) == libraryTitles({1, 6, 2, 4, 4}));
}

// A row retagged at the player still holds the file it held, so a title that no longer matches
// is not a new track.
TEST_CASE("a track the playlist holds under different tags is still a duplicate") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingLibraryTracks(foobar);

    auto retagged = libraryTrack(6);
    retagged.fields["%title%"] = "Retagged at the player";
    foobar.retag(kPlaylistId, {{1, retagged}});

    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto response =
        post(server, userFill(),
             skippingFill(library.state().structure, json{{"ordinals", json::array({6})}}));

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(answered.at("positions") == json::array());
    CHECK(answered.at("skipped") == json::array({6}));
}

TEST_CASE("the same file's other subsong is a different track and is inserted") {
    Library library;
    buildLibrary(library);

    auto otherSubsong = libraryTrack(4);
    otherSubsong.subsong = 2;

    FakePlayer foobar(&library);
    foobar.add(userPlaylist(kPlaylistId, "Road trip", kRowsStructure), {otherSubsong});
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto response =
        post(server, userFill(),
             skippingFill(library.state().structure, json{{"ordinals", json::array({4})}}));

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(answered.at("positions") == json::array({1}));
    CHECK(answered.at("skipped") == json::array());
}

TEST_CASE("a copy skipping duplicates appends only the rows whose track the target did not hold") {
    FakePlayer foobar;
    holdingASourceSharingTwoTracks(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto before = generationOf(server, kPlaylistId);

    const auto response = post(server, copyPath(kPlaylistId),
                               skippingCopy(kSecondPlaylistId, unorderedRuns()).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(answered.at("positions") == json::array({4}));
    CHECK(answered.at("skipped") == json::array({1, 3}));

    CHECK(heldTitles(server, kPlaylistId) ==
          json::array({"First", "Second", "Third", "Fourth", "Source A"}));
    CHECK(foobar.titlesOf(kSecondPlaylistId) == sourceSharingTwoTitles());

    const auto generation = counterIn(answered, "structure");
    CHECK(generation == generationOf(server, kPlaylistId));
    CHECK(generation != before);
}

TEST_CASE("a copy skipping duplicates of which the target holds none appends every row") {
    FakePlayer foobar;
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto response = post(server, copyPath(kPlaylistId),
                               skippingCopy(kSecondPlaylistId, unorderedRuns()).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(answered.at("positions") == json::array({4, 5, 6}));
    CHECK(answered.at("skipped") == json::array());
    CHECK(heldTitles(server, kPlaylistId) ==
          json::array({"First", "Second", "Third", "Fourth", "Source A", "Source B", "Source D"}));
}

TEST_CASE(
    "a copy skipping duplicates all of which the target holds is a 200 that appends nothing "
    "and leaves the generation where it stood") {
    FakePlayer foobar;
    holdingASourceSharingTwoTracks(foobar);
    const TestServer server(servingSettings(), foobar.player());

    const auto before = generationOf(server, kPlaylistId);

    const auto runs = json::array({json::array({3, 1}), json::array({1, 1})});
    const auto response =
        post(server, copyPath(kPlaylistId), skippingCopy(kSecondPlaylistId, runs).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(keysOf(response->body) == Keys{"structure", "positions", "skipped"});
    CHECK(answered.at("positions") == json::array());
    CHECK(answered.at("skipped") == json::array({1, 3}));
    CHECK(counterIn(answered, "structure") == before);

    CHECK(generationOf(server, kPlaylistId) == before);
    CHECK(foobar.titlesOf(kPlaylistId) == roadTripTitles());
}

TEST_CASE("a copy saying `add`, or saying nothing, appends a row the target already holds") {
    auto adding = copyBody(kSecondPlaylistId, unorderedRuns());
    adding[kDuplicatesField] = "add";

    for (const auto& body : {copyBody(kSecondPlaylistId, unorderedRuns()), adding}) {
        INFO("body: ", body.dump());

        FakePlayer foobar;
        holdingASourceSharingTwoTracks(foobar);
        const TestServer server(servingSettings(), foobar.player());

        const auto response = post(server, copyPath(kPlaylistId), body.dump());

        REQUIRE(response);
        REQUIRE(response->status == 200);

        const auto answered = json::parse(response->body);
        CHECK(keysOf(response->body) == Keys{"structure", "positions", "skipped"});
        CHECK(answered.at("positions") == json::array({4, 5, 6}));
        CHECK(answered.at("skipped") == json::array());
        CHECK(foobar.titlesOf(kPlaylistId) == std::vector<std::string>{"First", "Second", "Third",
                                                                       "Fourth", "Source A",
                                                                       "Second", "Fourth"});
    }
}

// `runs` cannot name one position twice, so the repeat a copy can carry is a source holding one
// track at two positions.
TEST_CASE("a track the source holds twice is appended twice under `skip`") {
    FakePlayer foobar;
    foobar.add(userPlaylist(kPlaylistId, "Road trip", kRowsStructure),
               titledRows(roadTripTitles()));
    foobar.add(userPlaylist(kSecondPlaylistId, "Everything", kSourceStructure),
               titledRows({"Twice", "Twice", "Second"}));
    const TestServer server(servingSettings(), foobar.player());

    const auto response =
        post(server, copyPath(kPlaylistId),
             skippingCopy(kSecondPlaylistId, json::array({json::array({0, 3})})).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(answered.at("positions") == json::array({4, 5}));
    CHECK(answered.at("skipped") == json::array({2}));
    CHECK(foobar.titlesOf(kPlaylistId) ==
          std::vector<std::string>{"First", "Second", "Third", "Fourth", "Twice", "Twice"});
}

// A value this component guessed at would insert or skip against what the client meant, and
// neither can be seen from the status alone.
TEST_CASE("a `duplicates` the contract does not list is a 400, and the player is never asked") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    foobar.add(userPlaylist(kSecondPlaylistId, "Everything", kSourceStructure),
               titledRows(sourceTitles()));
    const TestServer server(servingSettings(), foobar.player(), &library);

    for (const auto& value : unlistedDuplicates()) {
        INFO("duplicates: ", value.dump());

        const auto filled =
            post(server, userFill(),
                 withField(userBody(library.state().structure), kDuplicatesField, value));

        REQUIRE(filled);
        CHECK(filled->status == 400);
        CHECK(json::parse(filled->body)["error"] == "malformed request");

        auto body = copyBody(kSecondPlaylistId, unorderedRuns());
        body[kDuplicatesField] = value;
        const auto copied = post(server, copyPath(kPlaylistId), body.dump());

        REQUIRE(copied);
        CHECK(copied->status == 400);
        CHECK(json::parse(copied->body)["error"] == "malformed request");
    }

    CHECK(foobar.total() == 0);
    CHECK(foobar.titlesOf(kPlaylistId) == alreadyHeld());
}

// The scratch is emptied before it is filled, so there is nothing for a fill of it to be a
// duplicate of, and `FillOwnPlaylistRequest` does not declare the field. A value the other
// route takes is refused here like any other undeclared field.
TEST_CASE("the component's own playlist refuses `duplicates`, whichever value it carries") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingForAFill(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    for (const char* value : {"skip", "add"}) {
        INFO("duplicates: ", value);

        const auto response = post(
            server, kScratchFill,
            withField(ownBody(kScratchTitle, library.state().structure), kDuplicatesField, value));

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"] == "malformed request");
    }

    CHECK(foobar.total() == 0);
    CHECK(foobar.titlesOf(kScratchPlaylistId) == alreadyHeld());
}

TEST_CASE("a fill of the component's own playlist always answers an empty `skipped`") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    foobar.add(scratchEntry(), libraryTracks({3, 1}));
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto response =
        post(server, kScratchFill, ownBody(kScratchTitle, library.state().structure));

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    CHECK(answered.at("positions") == json::array({0, 1}));
    CHECK(answered.at("skipped") == json::array());
}

// The lock is asked before the rows are. A 200 here would tell a client the playlist takes
// rows, and the next add, of a track it does not hold, would be the one to find out it does not.
TEST_CASE("a locked target is a 409 even where every track named would have been skipped") {
    SUBCASE("a fill") {
        Library library;
        buildLibrary(library);

        FakePlayer foobar(&library);
        holdingLibraryTracks(foobar);
        foobar.lock(kPlaylistId);
        const TestServer server(servingSettings(), foobar.player(), &library);

        const auto response =
            post(server, userFill(),
                 skippingFill(library.state().structure, json{{"ordinals", json::array({2, 1})}}));

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(json::parse(response->body)["error"] == describe(PlayerOutcome::playlistLocked));
        CHECK(json::parse(response->body).count("skipped") == 0);
        CHECK(foobar.titlesOf(kPlaylistId) == libraryTitles(ordinalsRoadTripHolds()));
    }

    SUBCASE("a copy") {
        FakePlayer foobar;
        holdingASourceSharingTwoTracks(foobar);
        foobar.lock(kPlaylistId);
        const TestServer server(servingSettings(), foobar.player());

        const auto runs = json::array({json::array({3, 1}), json::array({1, 1})});
        const auto response =
            post(server, copyPath(kPlaylistId), skippingCopy(kSecondPlaylistId, runs).dump());

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(json::parse(response->body)["error"] == describe(PlayerOutcome::playlistLocked));
        CHECK(json::parse(response->body).count("skipped") == 0);
        CHECK(foobar.titlesOf(kPlaylistId) == roadTripTitles());
    }
}

// A create takes the fields a fill and a copy take and makes a playlist that holds nothing
// yet, so `CreatePlaylistRequest` declares no `duplicates` for either of its sets.
TEST_CASE("a create refuses `duplicates` with either set, and makes nothing") {
    Library library;
    buildLibrary(library);

    FakePlayer foobar(&library);
    holdingTwoPlaylists(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    auto fromTheLibrary = json::parse(userBody(library.state().structure));
    fromTheLibrary["title"] = "Made";

    auto fromAPlaylist = copyBody(kSecondPlaylistId, unorderedRuns());
    fromAPlaylist["title"] = "Made";

    for (auto body : {fromTheLibrary, fromAPlaylist}) {
        INFO("body: ", body.dump());
        body[kDuplicatesField] = "skip";

        const auto response = post(server, "/api/playlists", body.dump());

        REQUIRE(response);
        CHECK(response->status == 400);
    }

    CHECK(foobar.count(Call::createPlaylist) == 0);
}
