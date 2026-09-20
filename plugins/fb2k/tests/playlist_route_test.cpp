// The playlist routes over a real socket, the autoplaylists and the two fills. playlists_test.cpp
// covers the decisions behind them; what these add is that a refused request never reaches the
// player at all, and what a route asked of the player when it did.

#include "third_party/doctest.h"

#include "core/library.h"
#include "core/settings.h"
#include "support/log_capture.h"
#include "support/spec.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cstdint>
#include <functional>
#include <iterator>
#include <map>
#include <numeric>
#include <optional>
#include <set>
#include <string>
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
    playlist.beefwebId = "p3";
    playlist.index = 2;
    playlist.title = "#Jean Rock";
    playlist.itemCount = 412;
    playlist.isAutoPlaylist = true;
    playlist.structure = kRockStructure;
    playlist.revision = kRockRevision;
    playlist.managed = spec;
    return playlist;
}

struct PlayerLog {
    int creates = 0;
    int updates = 0;
    int removals = 0;
    AutoPlaylistSpec lastSpec;
    std::string lastId;
    PlaylistOutcome answer = PlaylistOutcome::done;
};

PlaylistResult answering(const PlayerLog* log) {
    PlaylistResult result;
    result.outcome = log->answer;
    result.playlist = rock();
    return result;
}

Player recordingPlayer(PlayerLog* log) {
    Player player;

    player.listPlaylists = [] { return PlaylistsResult{PlaylistOutcome::done, {rock()}}; };

    player.createAutoPlaylist = [log](const AutoPlaylistSpec& spec) {
        log->creates++;
        log->lastSpec = spec;
        return answering(log);
    };

    player.updateAutoPlaylist = [log](const std::string& id, const AutoPlaylistSpec& spec) {
        log->updates++;
        log->lastId = id;
        log->lastSpec = spec;
        return answering(log);
    };

    player.removeAutoPlaylist = [log](const std::string& id) {
        log->removals++;
        log->lastId = id;
        return answering(log);
    };

    player.previewQuery = [](const std::string& query) {
        PreviewResult preview;
        preview.valid = query != "bad";
        preview.error = preview.valid ? "" : "Query syntax error";
        preview.matches = preview.valid ? 412 : 0;
        preview.libraryEnabled = true;
        return preview;
    };

    return player;
}

json capabilitiesOf(const Settings& settings) {
    const TestServer server(settings);
    const auto response = server.client().Get("/api/capabilities", TestServer::bearer());

    REQUIRE(response);
    return json::parse(response->body);
}

json capabilitiesReporting(std::vector<std::string> orders) {
    Player player = servingPlayer();
    player.playbackOrders = std::move(orders);

    const TestServer server(servingSettings(), player);
    const auto response = server.client().Get("/api/capabilities", TestServer::bearer());

    REQUIRE(response);
    return json::parse(response->body);
}

// Three of the playback orders a stock foobar2000 reports, out of its own listing order so that
// the list a client draws can be told from a list built by walking a table of names. The whole
// set, and the Jean name each order carries, is pinned in tests/playback_modes_test.cpp; these
// cases are about which of them an install can offer, which is the other question.
const std::vector<std::string> kReportedOrders = {"Shuffle (albums)", "Default", "Repeat (track)"};
const std::vector<std::string> kOfferedModes = {"shuffleAlbums", "inOrder", "repeatOne"};

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

std::string nameOf(OwnPlaylistRole) {
    return "scratch";
}

constexpr char kRemadePlaylistId[] = "33333333-3333-3333-3333-333333333333";

struct FillLog {
    std::vector<std::string> roles;
    std::string title;

    int fills = 0;
    std::string filled;
    bool replace = false;

    int deletes = 0;

    std::vector<uint32_t> inserted;
    uint64_t structure = 1;
    std::map<std::string, size_t> held;
    std::map<std::string, std::string> titles;
    std::map<std::string, std::string> playlists{{"scratch", kScratchPlaylistId}};
    std::string beefwebId = "p4";
    std::string listedTitle;

    const std::string& idFor(OwnPlaylistRole role) {
        auto& id = playlists[nameOf(role)];
        if (id.empty())
            id = kRemadePlaylistId;

        return id;
    }
};

// Stands in for fb2k/playlists.cpp: a role resolves to the playlist carrying its marker, and a
// set resolved against a generation the player has moved past is refused rather than inserted.
Player fillingPlayer(FillLog* log) {
    Player player;

    player.ownPlaylist = [log](OwnPlaylistRole role, const std::string& title) {
        log->roles.push_back(nameOf(role));
        log->title = title;

        PlaylistAnnotation playlist;
        playlist.id = log->idFor(role);
        playlist.beefwebId = log->beefwebId;

        // A playlist made for a role carries its title from the start, which is what keeps it out
        // of the sidebar for the poll that finds it.
        auto& named = log->titles[playlist.id];
        if (named.empty())
            named = title;

        playlist.title = named;

        PlaylistResult result;
        result.playlist = playlist;
        return result;
    };

    player.emptyOwnPlaylist = [log](OwnPlaylistRole role) {
        PlaylistAnnotation playlist;
        playlist.id = log->idFor(role);
        playlist.beefwebId = log->beefwebId;

        log->held[playlist.id] = 0;

        PlaylistResult result;
        result.playlist = playlist;
        return result;
    };

    // The seam's one delete, and the only way anything in core/ can destroy a playlist. The fake
    // answers it rather than leaving it null, so a route that emptied a playlist by deleting it
    // is caught having done so instead of crashing on the way.
    player.removeAutoPlaylist = [log](const std::string& id) {
        log->deletes++;
        log->held.erase(id);

        for (auto& playlist : log->playlists)
            if (playlist.second == id)
                playlist.second.clear();

        PlaylistResult result;
        result.playlist.id = id;
        return result;
    };

    player.fill = [log](const std::string& playlistId, const std::string& title, uint64_t structure,
                        const std::vector<uint32_t>& ordinals, bool replace) {
        log->fills++;
        log->filled = playlistId;
        log->replace = replace;

        if (structure != log->structure)
            return FillResult{PlaylistOutcome::structureMoved, {}, ""};

        if (!title.empty())
            log->titles[playlistId] = title;

        log->inserted.insert(log->inserted.end(), ordinals.begin(), ordinals.end());

        auto& held = log->held[playlistId];
        if (replace)
            held = 0;

        std::vector<size_t> positions(ordinals.size());
        std::iota(positions.begin(), positions.end(), held);
        held += ordinals.size();

        return FillResult{PlaylistOutcome::done, std::move(positions), ""};
    };

    return player;
}

constexpr size_t kHeldRows = 5;

FillLog holding(uint64_t structure) {
    FillLog log;
    log.structure = structure;

    for (const char* id : {kScratchPlaylistId, kPlaylistId})
        log.held[id] = kHeldRows;

    return log;
}

// Somebody closing the tab in foobar2000. No route of this component's can do it, since the
// scratch is refused as a target of an edit whatever writePlaylists says, so this is the only
// way the role is ever left pointing at nothing.
void scratchDeletedAtThePlayer(FillLog& log) {
    auto& id = log.playlists[nameOf(OwnPlaylistRole::scratch)];

    log.titles.erase(id);
    log.held.erase(id);
    id.clear();
}

constexpr size_t kLibraryTracks = 8;

void buildLibrary(Library& library, size_t trackCount = kLibraryTracks) {
    LibraryBuilder builder({"%title%"}, trackCount);
    auto& sink = builder.sink();

    for (size_t index = 0; index < trackCount; ++index) {
        const auto ordinal = std::to_string(index);
        sink.row(index, {"Artist/Album/", ordinal + ".flac", "0", "Track " + ordinal});
    }

    library.replace(builder.finish());
}

std::string ownBody(const std::string& title, uint64_t structure) {
    return R"({"title": ")" + title + R"(", "structure": )" + std::to_string(structure) +
           R"(, "ordinals": [3, 1]})";
}

std::string userBody(uint64_t structure) {
    return R"({"structure": )" + std::to_string(structure) + R"(, "ordinals": [3, 1]})";
}

constexpr uint64_t kHeldStructure = 1;

struct Target {
    std::string name;
    std::string path;
    std::string body;
    bool replaces;
    std::string id;
};

std::vector<Target> targets(uint64_t structure) {
    return {
        {"the scratch role", kScratchFill, ownBody(kScratchTitle, structure), true,
         kScratchPlaylistId},
        {"a user's playlist", userFill(), userBody(structure), false, kPlaylistId}};
}

// Whether an empty answers a document like a fill does or a bare 204 like DELETE /stream/hold is
// the contract's to settle. What a caller depends on either way is that the rows went.
bool accepted(const httplib::Result& response) {
    constexpr int kRedirected = 300;
    return response && response->status >= 200 && response->status < kRedirected;
}

Settings readOnlyPlaylists() {
    auto settings = servingSettings();
    settings.writePlaylists = false;
    return settings;
}

Player fillingPlayerListing(FillLog* log) {
    auto player = fillingPlayer(log);

    player.listPlaylists = [log] {
        PlaylistAnnotation playlist;
        playlist.id = kPlaylistId;
        playlist.beefwebId = "p3";
        playlist.title = log->listedTitle;
        return PlaylistsResult{PlaylistOutcome::done, {playlist}};
    };

    return player;
}

// Reports the component's own playlists under the titles they currently carry, and marks whichever
// one the scratch role resolved to with that role, so a test reads both back the way any client
// does.
Player namingPlayer(FillLog* log) {
    auto player = fillingPlayer(log);

    player.listPlaylists = [log] {
        const auto own = log->playlists[nameOf(OwnPlaylistRole::scratch)];

        std::vector<PlaylistAnnotation> playlists;
        std::transform(log->titles.begin(), log->titles.end(), std::back_inserter(playlists),
                       [&own](const std::pair<const std::string, std::string>& named) {
                           PlaylistAnnotation playlist;
                           playlist.id = named.first;
                           playlist.title = named.second;

                           if (playlist.id == own)
                               playlist.role = OwnPlaylistRole::scratch;

                           return playlist;
                       });

        return PlaylistsResult{PlaylistOutcome::done, std::move(playlists)};
    };

    return player;
}

std::string titleOf(const TestServer& server, const std::string& id) {
    const auto response = server.client().Get("/api/playlists", TestServer::bearer());
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
    const auto response = server.client().Get("/api/playlists", TestServer::bearer());
    REQUIRE(response);

    const auto body = json::parse(response->body);

    std::vector<json> scratch;
    for (const auto& playlist : body.at("playlists"))
        if (playlist.at("role") == "scratch")
            scratch.push_back(playlist);

    return scratch;
}

const std::string kJeanPrefix = "#Jean";

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

constexpr char kSecondPlaylistId[] = "22222222-2222-2222-2222-222222222222";

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

struct Row {
    std::map<std::string, std::string> fields;
    std::optional<std::string> libraryPath;
};

constexpr char kLibraryFolder[] = "Fictional Artist/Imaginary Album/";

Row libraryRow(const std::string& title, const std::string& file) {
    Row row;
    row.fields = {{"%title%", title}, {"%artist%", "Fictional Artist"}};
    row.libraryPath = kLibraryFolder + file;
    return row;
}

Row strayRow(const std::string& title) {
    Row row;
    row.fields = {{"%title%", title}, {"%artist%", "Somebody Else"}};
    return row;
}

constexpr size_t kStrayRow = 2;

std::vector<Row> playlistRows() {
    return {libraryRow("First", "01.flac"), libraryRow("Second", "02.flac"), strayRow("Dragged in"),
            libraryRow("Fourth", "04.flac"), libraryRow("Fifth", "05.flac")};
}

PlaylistRow formatted(const Row& row, const std::vector<std::string>& columns) {
    PlaylistRow answer;
    answer.libraryPath = row.libraryPath;

    std::transform(columns.begin(), columns.end(), std::back_inserter(answer.columns),
                   [&row](const std::string& column) {
                       const auto found = row.fields.find(column);
                       return found == row.fields.end() ? std::string(kUnresolved) : found->second;
                   });

    return answer;
}

// Stands in for fb2k/playlists.cpp.
Player rowReadingPlayer() {
    Player player = servingPlayer();

    player.readPlaylistRows = [](const std::string& playlistId, size_t offset, size_t count,
                                 const std::vector<std::string>& columns) {
        PlaylistRowsRead read;
        if (playlistId != kPlaylistId) {
            read.outcome = PlaylistOutcome::noSuchPlaylist;
            return read;
        }

        const auto rows = playlistRows();
        read.structure = kRowsStructure;
        read.revision = kRowsRevision;
        read.totalCount = rows.size();

        const auto first = std::min(offset, rows.size());
        const auto last = std::min(first + count, rows.size());

        std::transform(rows.begin() + static_cast<std::ptrdiff_t>(first),
                       rows.begin() + static_cast<std::ptrdiff_t>(last),
                       std::back_inserter(read.rows),
                       [&columns](const Row& row) { return formatted(row, columns); });

        return read;
    };

    return player;
}

Player countingRowReads(int* reads) {
    Player player = rowReadingPlayer();

    player.readPlaylistRows = [reads, read = player.readPlaylistRows](
                                  const std::string& playlistId, size_t offset, size_t count,
                                  const std::vector<std::string>& columns) {
        ++*reads;
        return read(playlistId, offset, count, columns);
    };

    return player;
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

std::map<uint32_t, Row> changedRows() {
    return {{1, libraryRow("Second, five stars", "02.flac")},
            {kStrayRow, strayRow("Dragged in, five stars")}};
}

// Two of the three carry one artist and all three carry different titles, so one response holds a
// column whose values repeat across changed rows beside a column whose values do not.
std::map<uint32_t, Row> rowsSharingAnArtist() {
    return {{1, libraryRow("Second, five stars", "02.flac")},
            {kStrayRow, strayRow("Dragged in, five stars")},
            {3, libraryRow("Fourth, five stars", "04.flac")}};
}

constexpr uint64_t kChangedSince = kRowsRevision - 1;
constexpr uint64_t kOldestRetained = kRowsRevision - 2;

Player changeReadingPlayer(std::map<uint32_t, Row> changed = changedRows()) {
    Player player = rowReadingPlayer();

    player.readChangedPlaylistRows = [changed = std::move(changed)](
                                         const std::string& playlistId, uint64_t structure,
                                         uint64_t since, const std::vector<std::string>& columns) {
        PlaylistChangesRead read;
        if (playlistId != kPlaylistId) {
            read.outcome = PlaylistOutcome::noSuchPlaylist;
            return read;
        }

        if (structure != kRowsStructure) {
            read.catchUp = DeltaOutcome::structureChanged;
            return read;
        }

        if (since < kOldestRetained) {
            read.catchUp = DeltaOutcome::revisionTooOld;
            return read;
        }

        read.revision = kRowsRevision;
        if (since >= kRowsRevision)
            return read;

        for (const auto& [position, row] : changed)
            read.rows.push_back({position, formatted(row, columns)});

        return read;
    };

    return player;
}

Player countingChangeReads(int* reads) {
    Player player = countingRowReads(reads);

    player.readChangedPlaylistRows = [reads, read = changeReadingPlayer().readChangedPlaylistRows](
                                         const std::string& playlistId, uint64_t structure,
                                         uint64_t since, const std::vector<std::string>& columns) {
        ++*reads;
        return read(playlistId, structure, since, columns);
    };

    return player;
}

std::string changesPath(const std::string& id, const std::string& structure,
                        const std::string& since, const std::vector<std::string>& columns) {
    auto path = "/api/playlists/" + id + "/items/changes?structure=" + structure +
                "&since=" + since;

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

struct PlayLog {
    int calls = 0;
    std::string playlistId;
    uint32_t index = 0;
    PlaylistOutcome answer = PlaylistOutcome::done;
};

Player playingPlayer(PlayLog* log) {
    Player player = rowReadingPlayer();

    player.playPlaylistRow = [log](const std::string& playlistId, uint32_t index) {
        log->calls++;
        log->playlistId = playlistId;
        log->index = index;
        return log->answer;
    };

    return player;
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

using Keys = std::set<std::string>;

Keys keysOf(const json& entry) {
    const auto fields = entry.items();

    Keys keys;
    std::transform(fields.begin(), fields.end(), std::inserter(keys, keys.end()),
                   [](const auto& field) { return field.key(); });
    return keys;
}

constexpr char kCreatePlaylist[] = "/api/playlists";

constexpr char kNewTitle[] = "Road trip";

constexpr char kSourceField[] = "source";

constexpr char kCreatedPlaylistId[] = "44444444-4444-4444-4444-444444444444";

// Neither number is zero and the two are equal, which is what PlaylistVersions answers for a
// playlist it has never seen. A route pinning either to a constant of its own is what this
// catches.
constexpr uint64_t kUntouchedVersion = 9204739866101318881ULL;

struct CreateLog {
    // Every call that changes the player, whichever one it was. A create that reached the
    // player twice, once to make the playlist and once to fill it, is what this counts.
    int jobs = 0;

    int creates = 0;
    std::string title;
    NewPlaylistRows rows;

    std::vector<PlaylistAnnotation> playlists{rock(), ordinary()};
    PlaylistOutcome answer = PlaylistOutcome::done;
};

// Stands in for fb2k/playlists.cpp: a create lands at the end of the player's list holding the
// rows the set named, and every other write the player offers is counted so that a create
// spending two of them is visible.
Player creatingPlayer(CreateLog* log) {
    Player player = servingPlayer();

    player.listPlaylists = [log] {
        return PlaylistsResult{PlaylistOutcome::done, log->playlists};
    };

    player.createPlaylist = [log](const std::string& title, const NewPlaylistRows& rows) {
        log->jobs++;
        log->creates++;
        log->title = title;
        log->rows = rows;

        if (log->answer != PlaylistOutcome::done)
            return playlistFailure(log->answer);

        PlaylistAnnotation made;
        made.id = kCreatedPlaylistId;
        made.index = static_cast<int>(log->playlists.size());
        made.title = title;
        made.itemCount = rows.ordinals.size() + rows.positions.size();
        made.structure = kUntouchedVersion;
        made.revision = kUntouchedVersion;

        log->playlists.push_back(made);

        PlaylistResult result;
        result.playlist = made;
        return result;
    };

    player.fill = [log](const std::string&, const std::string&, uint64_t,
                        const std::vector<uint32_t>&, bool) {
        log->jobs++;
        return FillResult{PlaylistOutcome::done, {}, ""};
    };

    player.ownPlaylist = [log](OwnPlaylistRole, const std::string&) {
        log->jobs++;
        return PlaylistResult{};
    };

    return player;
}

std::string createBody(const json& set = json::object()) {
    json body{{"title", kNewTitle}};
    body.update(set);
    return body.dump();
}

json listingOf(const TestServer& server) {
    const auto response = server.client().Get("/api/playlists", TestServer::bearer());

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

constexpr char kThirdPlaylistId[] = "55555555-5555-5555-5555-555555555555";

constexpr char kUnknownPlaylistId[] = "66666666-6666-6666-6666-666666666666";

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
std::vector<PlaylistAnnotation> threePlaylists() {
    auto first = rock();
    first.index = 0;

    auto second = ordinary();
    second.index = 1;

    auto third = ordinary();
    third.id = kThirdPlaylistId;
    third.title = "Third playlist";
    third.index = 2;

    return {first, second, third};
}

struct EditLog {
    int renames = 0;
    int removals = 0;
    int moves = 0;

    std::string lastId;
    std::string lastTitle;
    uint32_t lastIndex = 0;

    // Every call the component can make against the play queue, whichever one it was.
    int queueCalls = 0;

    std::vector<PlaylistAnnotation> playlists = threePlaylists();

    std::vector<PlaylistAnnotation>::iterator at(const std::string& id) {
        return std::find_if(
            playlists.begin(), playlists.end(),
            [&id](const PlaylistAnnotation& playlist) { return playlist.id == id; });
    }

    void renumber() {
        for (size_t position = 0; position < playlists.size(); ++position)
            playlists[position].index = static_cast<int>(position);
    }
};

// Stands in for fb2k/playlists.cpp: the player's own list, retitled, removed from and reordered
// in place, so each of the three edits is read back off GET /api/playlists the way a client
// reads it. A playlist carrying one of this component's roles is refused where its id is
// resolved, because that is the only place the role is readable without a second look at the
// player.
Player editingPlayer(EditLog* log) {
    Player player = servingPlayer();

    player.listPlaylists = [log] {
        return PlaylistsResult{PlaylistOutcome::done, log->playlists};
    };

    player.renamePlaylist = [log](const std::string& id, const std::string& title) {
        log->renames++;
        log->lastId = id;
        log->lastTitle = title;

        const auto found = log->at(id);
        if (found == log->playlists.end())
            return playlistFailure(PlaylistOutcome::noSuchPlaylist);

        if (found->role)
            return playlistFailure(PlaylistOutcome::ownPlaylist);

        found->title = title;

        PlaylistResult result;
        result.playlist = *found;
        return result;
    };

    player.removePlaylist = [log](const std::string& id) {
        log->removals++;
        log->lastId = id;

        const auto found = log->at(id);
        if (found == log->playlists.end())
            return playlistFailure(PlaylistOutcome::noSuchPlaylist);

        if (found->role)
            return playlistFailure(PlaylistOutcome::ownPlaylist);

        log->playlists.erase(found);
        log->renumber();

        PlaylistResult result;
        result.playlist.id = id;
        return result;
    };

    player.movePlaylist = [log](const std::string& id, uint32_t index) {
        log->moves++;
        log->lastId = id;
        log->lastIndex = index;

        const auto found = log->at(id);
        if (found == log->playlists.end())
            return playlistFailure(PlaylistOutcome::noSuchPlaylist);

        if (found->role)
            return playlistFailure(PlaylistOutcome::ownPlaylist);

        if (index >= log->playlists.size())
            return playlistFailure(PlaylistOutcome::positionPastEnd);

        const auto moved = *found;
        log->playlists.erase(found);
        log->playlists.insert(log->playlists.begin() + static_cast<std::ptrdiff_t>(index), moved);
        log->renumber();

        PlaylistResult result;
        result.playlist = log->playlists[index];
        return result;
    };

    return player;
}

Player countingQueueCalls(Player player, int* calls) {
    player.readQueue = [calls] {
        ++*calls;
        return QueueRead{};
    };

    player.queuePlaylistRows = [calls](const std::string&, const std::vector<uint32_t>&,
                                      std::optional<QueuePosition>) {
        ++*calls;
        return PlaylistOutcome::done;
    };

    player.queueLibraryTracks = [calls](uint64_t, const std::vector<uint32_t>&,
                                       std::optional<QueuePosition>) {
        ++*calls;
        return PlaylistOutcome::done;
    };

    player.moveQueueEntry = [calls](uint32_t, uint32_t, uint64_t) {
        ++*calls;
        return PlaylistOutcome::done;
    };

    player.removeQueueEntry = [calls](uint32_t, uint64_t) {
        ++*calls;
        return PlaylistOutcome::done;
    };

    player.clearQueue = [calls] {
        ++*calls;
        return PlaylistOutcome::done;
    };

    return player;
}

struct Edit {
    std::string name;
    std::function<httplib::Result(const TestServer&, const std::string& id)> send;
    std::function<int(const EditLog&)> calls;
};

// The three edits that address a playlist by its GUID rather than by its rows.
std::vector<Edit> playlistEdits() {
    return {{"renaming",
             [](const TestServer& server, const std::string& id) {
                 return post(server, playlistPath(id), renameBody(kNewTitle));
             },
             [](const EditLog& log) { return log.renames; }},
            {"deleting",
             [](const TestServer& server, const std::string& id) {
                 return server.client().Delete(playlistPath(id), TestServer::bearer());
             },
             [](const EditLog& log) { return log.removals; }},
            {"moving",
             [](const TestServer& server, const std::string& id) {
                 return post(server, movePath(id), moveBody(0));
             },
             [](const EditLog& log) { return log.moves; }}};
}

// Far enough from the target's that a copy answering the source playlist's generation, or the
// library's, is visible rather than equal by luck.
constexpr uint64_t kSourceStructure = kRowsStructure + 100;

struct Held {
    std::vector<std::string> titles;
    uint64_t structure = 0;
    std::optional<OwnPlaylistRole> role;
};

// The rows two playlists hold, by title, so a copy and a removal read back off the rows route the
// way a client reads them.
struct RowsLog {
    int copies = 0;
    int removals = 0;
    int fills = 0;

    // Every call this component can make against the player, whichever one it was. A copy that
    // read an item count before or after itself spends two of these.
    int calls = 0;

    std::map<std::string, Held> playlists{
        {kPlaylistId, {{"First", "Second", "Third", "Fourth"}, kRowsStructure, std::nullopt}},
        {kSecondPlaylistId,
         {{"Source A", "Source B", "Source C", "Source D", "Source E"}, kSourceStructure,
          std::nullopt}}};

    Held* at(const std::string& id) {
        const auto found = playlists.find(id);
        return found == playlists.end() ? nullptr : &found->second;
    }
};

bool namesARow(const Held& held, const std::vector<uint32_t>& positions) {
    return std::all_of(positions.begin(), positions.end(), [&held](uint32_t position) {
        return position < held.titles.size();
    });
}

// Stands in for fb2k/playlists.cpp: rows are held per playlist, both edits move only the
// generation of the playlist they changed, and a playlist carrying one of this component's roles
// is refused where its id is resolved rather than by a second look at the player.
Player rowEditingPlayer(RowsLog* log) {
    Player player = servingPlayer();

    player.listPlaylists = [log] {
        ++log->calls;

        std::vector<PlaylistAnnotation> playlists;
        for (const auto& [id, held] : log->playlists) {
            PlaylistAnnotation playlist;
            playlist.id = id;
            playlist.index = static_cast<int>(playlists.size());
            playlist.title = id == kPlaylistId ? "Road trip" : "Everything";
            playlist.itemCount = held.titles.size();
            playlist.role = held.role;
            playlist.structure = held.structure;
            playlist.revision = kRowsRevision;
            playlists.push_back(playlist);
        }

        return PlaylistsResult{PlaylistOutcome::done, std::move(playlists)};
    };

    player.readPlaylistRows = [log](const std::string& playlistId, size_t offset, size_t count,
                                    const std::vector<std::string>& columns) {
        ++log->calls;

        PlaylistRowsRead read;
        const auto* held = log->at(playlistId);
        if (!held) {
            read.outcome = PlaylistOutcome::noSuchPlaylist;
            return read;
        }

        read.structure = held->structure;
        read.revision = kRowsRevision;
        read.totalCount = held->titles.size();

        const auto first = std::min(offset, held->titles.size());
        const auto last = std::min(first + count, held->titles.size());

        std::transform(held->titles.begin() + static_cast<std::ptrdiff_t>(first),
                       held->titles.begin() + static_cast<std::ptrdiff_t>(last),
                       std::back_inserter(read.rows), [&columns](const std::string& title) {
                           Row row;
                           row.fields = {{"%title%", title}};
                           return formatted(row, columns);
                       });

        return read;
    };

    player.copyPlaylistRows = [log](const std::string& playlistId,
                                    const std::string& sourcePlaylistId,
                                    const std::vector<uint32_t>& positions) {
        ++log->calls;
        log->copies++;

        auto* target = log->at(playlistId);
        const auto* source = log->at(sourcePlaylistId);
        if (!target || !source)
            return RowsEdited{PlaylistOutcome::noSuchPlaylist, 0, {}};

        // The target only. A source is read rather than changed, so its role is no reason to
        // refuse: the two cases below drive that either way round.
        if (target->role)
            return RowsEdited{PlaylistOutcome::ownPlaylist, target->structure, {}};

        if (!namesARow(*source, positions))
            return RowsEdited{PlaylistOutcome::positionPastEnd, target->structure, {}};

        RowsEdited copied;
        for (const uint32_t position : positions) {
            copied.positions.push_back(target->titles.size());
            target->titles.push_back(source->titles[position]);
        }

        if (!positions.empty())
            target->structure++;

        copied.structure = target->structure;
        return copied;
    };

    player.removePlaylistRows = [log](const std::string& playlistId, uint64_t structure,
                                      const std::vector<uint32_t>& positions) {
        ++log->calls;
        log->removals++;

        auto* target = log->at(playlistId);
        if (!target)
            return RowsEdited{PlaylistOutcome::noSuchPlaylist, 0, {}};

        if (target->role)
            return RowsEdited{PlaylistOutcome::ownPlaylist, target->structure, {}};

        if (structure != target->structure)
            return RowsEdited{PlaylistOutcome::rowsMoved, target->structure, {}};

        if (!namesARow(*target, positions))
            return RowsEdited{PlaylistOutcome::positionPastEnd, target->structure, {}};

        // Descending, so taking one row out does not move the position of the next.
        auto descending = positions;
        std::sort(descending.begin(), descending.end(), std::greater<>());

        for (const uint32_t position : descending)
            target->titles.erase(target->titles.begin() + static_cast<std::ptrdiff_t>(position));

        if (!positions.empty())
            target->structure++;

        return RowsEdited{PlaylistOutcome::done, target->structure, {}};
    };

    // Answered rather than left null because the fill route is what a removal's grammar is held
    // against below: a body that parsed when it should not have is then caught by the count
    // instead of by a crash.
    player.fill = [log](const std::string&, const std::string&, uint64_t,
                        const std::vector<uint32_t>&, bool) {
        ++log->calls;
        log->fills++;
        return FillResult{PlaylistOutcome::done, {}, ""};
    };

    return player;
}

// The create is the one other route that takes a source playlist and `runs`, so a copy's grammar
// can be held against it on one server.
Player rowEditingPlayerCreating(RowsLog* log, CreateLog* creates) {
    auto player = rowEditingPlayer(log);
    player.createPlaylist = creatingPlayer(creates).createPlaylist;
    return player;
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

struct RowEdit {
    std::string name;
    std::function<httplib::Result(const TestServer&, const std::string& id)> send;
    std::function<int(const RowsLog&)> calls;
};

// The two edits that address a playlist's rows by position rather than the playlist by its GUID.
std::vector<RowEdit> rowEdits() {
    return {{"copying rows in",
             [](const TestServer& server, const std::string& id) {
                 return post(server, copyPath(id),
                             copyBody(kSecondPlaylistId, unorderedRuns()).dump());
             },
             [](const RowsLog& log) { return log.copies; }},
            {"removing rows",
             [](const TestServer& server, const std::string& id) {
                 return post(server, removeRowsPath(id),
                             removeRowsBody(kRowsStructure, unorderedRuns()).dump());
             },
             [](const RowsLog& log) { return log.removals; }}};
}

// The error an answer names, and nothing where it named none. Read rather than parsed straight,
// because a route that accepted the request answers 204 with no body at all, and a case driving a
// list of routes should fail on the status it was asked about rather than on a parse.
std::string errorIn(const httplib::Response& response) {
    if (response.body.empty())
        return {};

    const auto body = json::parse(response.body);
    const auto error = body.find("error");
    if (error == body.end() || !error->is_string())
        return {};

    return error->get<std::string>();
}

struct Write {
    std::string name;
    std::function<httplib::Result(const TestServer&)> send;

    // 200 where the route answers a document and 204 where it answers none. Which of the two
    // each route sends is settled by that route's own case.
    int whenAccepted = 200;
};

// Every write writePlaylists can refuse. kPlaylistId is reported as an autoplaylist this
// component made, so the update and the delete of one are aimed at its own records rather than
// at a stranger's playlist. The setting still refuses them: what it exempts is the scratch,
// which holds no music of the user's, and an autoplaylist holds theirs.
//
// The list is driven in order against one server, so the three playlist edits take a playlist
// each and the copy runs before the removal that shortens the playlist it reads from.
std::vector<Write> playlistWrites(uint64_t structure) {
    return {
        {"creating an autoplaylist",
         [](const TestServer& server) { return post(server, "/api/autoplaylists", kCreate); }},
        {"updating an autoplaylist",
         [](const TestServer& server) {
             return post(server, std::string("/api/autoplaylists/") + kPlaylistId,
                         R"({"query": "%genre% IS Jazz"})");
         }},
        {"deleting an autoplaylist",
         [](const TestServer& server) {
             return server.client().Delete(std::string("/api/autoplaylists/") + kPlaylistId,
                                           TestServer::bearer());
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
             return server.client().Delete(playlistPath(kThirdPlaylistId), TestServer::bearer());
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

// One log per fake the writes are spread across, so a write that reached the player is read off
// the same counter its own case reads.
struct WriteLog {
    PlayerLog autoPlaylists;
    FillLog fills;
    CreateLog creates;
    EditLog edits;
    RowsLog rows;
};

// Every write on one player, so the list above is driven against a single server.
Player writingPlayer(WriteLog* log) {
    Player player = recordingPlayer(&log->autoPlaylists);
    const Player filling = fillingPlayer(&log->fills);
    const Player creating = creatingPlayer(&log->creates);
    const Player editing = editingPlayer(&log->edits);
    const Player rowEditing = rowEditingPlayer(&log->rows);

    player.ownPlaylist = filling.ownPlaylist;
    player.fill = filling.fill;
    player.createPlaylist = creating.createPlaylist;
    player.renamePlaylist = editing.renamePlaylist;
    player.removePlaylist = editing.removePlaylist;
    player.movePlaylist = editing.movePlaylist;
    player.copyPlaylistRows = rowEditing.copyPlaylistRows;
    player.removePlaylistRows = rowEditing.removePlaylistRows;
    return player;
}

// With writePlaylists on, the role is the only thing that can refuse these, so the message names
// it. With the setting off, whether the setting or the role answers first is nothing the client
// can depend on and nothing this asks about. Reusing notOurs' message is what it catches: that one
// says the playlist was not created by foo_jean, and the scratch is the one that was.
void namesTheRole(const httplib::Response& response, bool writePlaylists) {
    if (!writePlaylists)
        return;

    CHECK(errorIn(response) == describe(PlaylistOutcome::ownPlaylist));
}

// The scratch under a title a user could have given a playlist of their own, so a route that
// found it by title rather than by the role it reports is caught doing so.
PlaylistAnnotation scratchEntry() {
    PlaylistAnnotation playlist;
    playlist.id = kScratchPlaylistId;
    playlist.index = 3;
    playlist.title = "Saturday";
    playlist.itemCount = kHeldRows;
    playlist.role = OwnPlaylistRole::scratch;
    playlist.structure = kRowsStructure;
    playlist.revision = kRowsRevision;
    return playlist;
}

// The same playlist among the rows two edits address by position. Long enough for the runs
// rowEdits() names, and at the generation its removal names.
Held scratchRows() {
    return {{"Result A", "Result B", "Result C", "Result D", "Result E"}, kRowsStructure,
            OwnPlaylistRole::scratch};
}

// foobar2000's playlist_lock carries a filter bit per edit, and these are the four of the six
// writes one can refuse: renaming, removing the playlist, adding rows and removing them. A
// create makes a playlist nothing has locked yet, and moving one within the list is announced to
// a lock rather than filtered by it.
std::vector<Write> lockableWrites() {
    return {{"renaming a playlist",
             [](const TestServer& server) {
                 return post(server, playlistPath(kPlaylistId), renameBody(kNewTitle));
             }},
            {"deleting a playlist",
             [](const TestServer& server) {
                 return server.client().Delete(playlistPath(kPlaylistId), TestServer::bearer());
             }},
            {"copying rows into a playlist",
             [](const TestServer& server) {
                 return post(server, copyPath(kPlaylistId),
                             copyBody(kSecondPlaylistId, unorderedRuns()).dump());
             }},
            {"removing rows from a playlist", [](const TestServer& server) {
                 return post(server, removeRowsPath(kPlaylistId),
                             removeRowsBody(kRowsStructure, unorderedRuns()).dump());
             }}};
}

// Stands in for fb2k/playlists.cpp against a playlist foobar2000 reports locked: the SDK answers
// false to each of these and nothing else says why, so the lock arrives as an outcome rather
// than as a status this side could work out.
Player lockedPlaylistPlayer(int* asked) {
    Player player = servingPlayer();

    player.listPlaylists = [] { return PlaylistsResult{PlaylistOutcome::done, {rock()}}; };

    player.renamePlaylist = [asked](const std::string&, const std::string&) {
        ++*asked;
        return playlistFailure(PlaylistOutcome::playlistLocked);
    };

    player.removePlaylist = [asked](const std::string&) {
        ++*asked;
        return playlistFailure(PlaylistOutcome::playlistLocked);
    };

    player.copyPlaylistRows = [asked](const std::string&, const std::string&,
                                      const std::vector<uint32_t>&) {
        ++*asked;
        return RowsEdited{PlaylistOutcome::playlistLocked, 0, {}};
    };

    player.removePlaylistRows = [asked](const std::string&, uint64_t,
                                        const std::vector<uint32_t>&) {
        ++*asked;
        return RowsEdited{PlaylistOutcome::playlistLocked, 0, {}};
    };

    return player;
}

// The same refusals for the route that inserts library rows, which reaches the player through
// fill rather than through copyPlaylistRows. foobar2000 takes an insert into a locked playlist
// and drops it without failing anything, so the positions a fill worked out ahead of the insert
// are no evidence that rows landed. They ride along with the refusal here for that reason.
Player refusingFillPlayer(FillLog* log, PlaylistOutcome outcome) {
    auto player = fillingPlayer(log);

    player.fill = [log, outcome](const std::string& playlistId, const std::string&, uint64_t,
                                 const std::vector<uint32_t>&, bool) {
        log->fills++;
        log->filled = playlistId;
        return FillResult{outcome, {53, 54, 55}, ""};
    };

    return player;
}

}  // namespace

TEST_CASE("GET /api/playlists answers each playlist by everything a client draws it from") {
    const TestServer server(servingSettings(), TestServer::listing([] {
                                return PlaylistsResult{PlaylistOutcome::done, {rock(), ordinary()}};
                            }));

    const auto response = server.client().Get("/api/playlists", TestServer::bearer());

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

                                return PlaylistsResult{PlaylistOutcome::done, {scratch, titled}};
                            }));

    const auto response = server.client().Get("/api/playlists", TestServer::bearer());

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

                                return PlaylistsResult{PlaylistOutcome::done, {rock(), scratch}};
                            }));

    const auto response = server.client().Get("/api/playlists", TestServer::bearer());

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

TEST_CASE("a page of rows answers the columns the client asked for, in the order it asked for "
          "them") {
    const TestServer server(servingSettings(), rowReadingPlayer());

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
    const TestServer server(servingSettings(), rowReadingPlayer());

    const auto page = pageOf(server, kPlaylistId, kStrayRow, 1, {"%title%", "%artist%"});
    const auto& items = page.at("items");
    REQUIRE(items.size() == 1);

    CHECK(items[0].at("columns") == json::array({"Dragged in", "Somebody Else"}));
}

// The library path is what a client asks GET /api/artwork for, so a row the library does not hold
// has to say so rather than carry a key that finds no cover.
TEST_CASE("a row carries its library path where the media library holds the track and null where "
          "it does not") {
    const TestServer server(servingSettings(), rowReadingPlayer());

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

TEST_CASE("a page says how many rows the playlist holds and which versions it was read at") {
    const TestServer server(servingSettings(), rowReadingPlayer());

    const auto page = pageOf(server, kPlaylistId, 1, 2, {"%title%"});

    CHECK(page.at("items").size() == 2);
    CHECK(page.at("totalCount") == playlistRows().size());
    CHECK(wireValue(page, "structure") == asDigits(kRowsStructure));
    CHECK(wireValue(page, "revision") == asDigits(kRowsRevision));
}

TEST_CASE("offset and count decide which of a playlist's rows a page holds") {
    const TestServer server(servingSettings(), rowReadingPlayer());

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
    const TestServer server(servingSettings(), rowReadingPlayer());

    const auto response = get(server, itemsPath(kSecondPlaylistId, 0, 10, {"%title%"}));

    REQUIRE(response);
    CHECK(response->status == 404);
}

TEST_CASE("a page request the component can judge for itself is a 400 and never reaches the "
          "player") {
    int reads = 0;
    const TestServer server(servingSettings(), countingRowReads(&reads));

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

    CHECK(reads == 0);
}

TEST_CASE("a delta carries only the rows whose content changed, each at the position it sits at") {
    const TestServer server(servingSettings(), changeReadingPlayer());

    const auto patched = patchedTitles(deltaOf(server, kChangedSince, {"%title%"}));

    CHECK(patched == json({{"1", "Second, five stars"},
                           {std::to_string(kStrayRow), "Dragged in, five stars"}}));
}

TEST_CASE("a changed row resolves to the fields a page's row carries, its library path included") {
    const TestServer server(servingSettings(), changeReadingPlayer());

    const auto rows = byPosition(deltaOf(server, kChangedSince, {"%artist%", "%title%"}));

    REQUIRE(rows.count(1) == 1);
    CHECK(rows.at(1).at("columns") == json::array({"Fictional Artist", "Second, five stars"}));
    CHECK(rows.at(1).at("libraryPath") == std::string(kLibraryFolder) + "02.flac");

    REQUIRE(rows.count(kStrayRow) == 1);
    CHECK(rows.at(kStrayRow).at("columns") ==
          json::array({"Somebody Else", "Dragged in, five stars"}));
    CHECK(rows.at(kStrayRow).at("libraryPath").is_null());
}

// A bulk retag reaches thousands of rows sharing an album or an artist, and the client appends
// what this carries to the dictionary it holds. One entry per changed row is the growth the
// dictionary exists to stop, so the count matters as much as the values.
TEST_CASE("a value two changed rows share is carried once, with an id into it from each") {
    const TestServer server(servingSettings(), changeReadingPlayer(rowsSharingAnArtist()));

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
    const TestServer server(servingSettings(), changeReadingPlayer(rowsSharingAnArtist()));

    const auto delta = deltaOf(server, kChangedSince, {"%artist%", "%title%"});

    REQUIRE(delta.at("items").size() == 3);
    for (const auto& item : delta.at("items")) {
        INFO("row: ", item.dump());
        CHECK(keysOf(item) == Keys{"position", "libraryPath"});
    }
}

TEST_CASE("the dictionaries arrive in the order the request declared its columns") {
    const TestServer server(servingSettings(), changeReadingPlayer(rowsSharingAnArtist()));

    const std::set<std::string> artists{"Fictional Artist", "Somebody Else"};
    const std::set<std::string> titles{"Second, five stars", "Dragged in, five stars",
                                       "Fourth, five stars"};

    SUBCASE("the artist asked for first answers first") {
        const auto columns = dictionariesIn(deltaOf(server, kChangedSince, {"%artist%", "%title%"}));

        REQUIRE(columns.size() == 2);
        CHECK(valuesIn(columns.at(0)) == artists);
        CHECK(valuesIn(columns.at(1)) == titles);
    }

    SUBCASE("the same two asked for the other way round answer the other way round") {
        const auto columns = dictionariesIn(deltaOf(server, kChangedSince, {"%title%", "%artist%"}));

        REQUIRE(columns.size() == 2);
        CHECK(valuesIn(columns.at(0)) == titles);
        CHECK(valuesIn(columns.at(1)) == artists);
    }
}

TEST_CASE("a delta says which revision the client is now caught up to") {
    const TestServer server(servingSettings(), changeReadingPlayer());

    const auto delta = deltaOf(server, kChangedSince, {"%title%"});

    CHECK(delta.at("items").size() == changedRows().size());
    CHECK(wireValue(delta, "revision") == asDigits(kRowsRevision));
}

TEST_CASE("a revision nothing has changed since answers an empty delta rather than an error") {
    const TestServer server(servingSettings(), changeReadingPlayer());

    const auto delta = deltaOf(server, kRowsRevision, {"%title%"});

    CHECK(delta.at("items").empty());
    CHECK(wireValue(delta, "revision") == asDigits(kRowsRevision));
}

// What a client polling a quiet playlist gets every tick, so it carries no dictionary to hold a
// place for a row that is not there.
TEST_CASE("a delta with no changed rows carries no dictionaries rather than an empty one per "
          "column") {
    const TestServer server(servingSettings(), changeReadingPlayer());

    const auto delta = deltaOf(server, kRowsRevision, {"%artist%", "%title%"});
    const auto columns = dictionariesIn(delta);

    CHECK(delta.at("items").empty());
    CHECK(columns.empty());
}

TEST_CASE("a structure generation the playlist has moved past is refused rather than patched") {
    const TestServer server(servingSettings(), changeReadingPlayer());

    checkRefused(server, changesPath(kPlaylistId, kRowsStructure + 1, kChangedSince, {"%title%"}),
                 409);
}

TEST_CASE("a revision older than the retained window is refused rather than patched") {
    const TestServer server(servingSettings(), changeReadingPlayer());

    checkRefused(server, changesPath(kPlaylistId, kRowsStructure, kOldestRetained - 1, {"%title%"}),
                 410);
}

// What a client patching rows does on every poll: it holds the two counters the page it is
// patching answered and hands them straight back. A client that read them as numbers hands back
// kThroughADouble for both, so the request that was meant to fetch a few changed rows is told the
// playlist was restructured and that its revision fell out of the window, and it reloads the
// whole playlist instead. That is the difference a digit makes here.
TEST_CASE("the two counters a page answered are read back at the values it answered") {
    const TestServer server(servingSettings(), changeReadingPlayer());

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

TEST_CASE("a request for changes the component can judge for itself is a 400 and never reaches "
          "the player") {
    int reads = 0;
    const TestServer server(servingSettings(), countingChangeReads(&reads));

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
             Request{kPlaylistId, "structure=twelve&since=" + std::to_string(kChangedSince) +
                                      columns},
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

    CHECK(reads == 0);
}

// The stray row, so that a row is played by where it sits in the playlist rather than by
// anything the media library knows about it. Where playback then goes is GET /api/state's to
// report, published by the player's own callback: state_route_test.cpp holds that half.
TEST_CASE("playing a row hands the player the playlist it is in and the position it sits at") {
    PlayLog log;
    const TestServer server(servingSettings(), playingPlayer(&log));

    const auto response = post(server, playPath(kPlaylistId, std::to_string(kStrayRow)), "");

    REQUIRE(response);
    INFO("status: ", response->status);
    CHECK(accepted(response));

    CHECK(log.calls == 1);
    CHECK(log.playlistId == kPlaylistId);
    CHECK(log.index == kStrayRow);
}

TEST_CASE("a play request the component can judge for itself is a 400 and never reaches the "
          "player") {
    PlayLog log;
    const TestServer server(servingSettings(), playingPlayer(&log));

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

    CHECK(log.calls == 0);
}

TEST_CASE("playing from a playlist the player does not hold is a 404, and a row past that "
          "playlist's end is a 400") {
    struct Case {
        PlaylistOutcome outcome;
        int status;
    };

    for (const auto& expected : {Case{PlaylistOutcome::noSuchPlaylist, 404},
                                 Case{PlaylistOutcome::positionPastEnd, 400}}) {
        INFO("outcome: ", describe(expected.outcome));
        PlayLog log;
        log.answer = expected.outcome;
        const TestServer server(servingSettings(), playingPlayer(&log));

        const auto response = post(server, playPath(kPlaylistId, "3"), "");

        REQUIRE(response);
        CHECK(response->status == expected.status);
        if (response->status == expected.status)
            CHECK(json::parse(response->body)["error"].is_string());

        CHECK(log.calls == 1);
    }
}

// No library is handed to this server on purpose. A create with no set has nothing to resolve
// against the media library, so it is the same shape as emptying the component's own playlist
// rather than the same shape as a fill.
TEST_CASE("a create with no set answers a playlist at the end of the list, holding nothing") {
    CreateLog log;
    const auto before = log.playlists.size();
    const TestServer server(servingSettings(), creatingPlayer(&log));

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

    CHECK(log.jobs == 1);
}

// The playlist exists and holds its rows at the same instant, because the alternative is a
// create followed by a fill: two requests, and a window in which a user's playlist list has an
// empty playlist in it that nobody asked for. Counting every write the player offers is what
// tells the one job from the two.
TEST_CASE("a create filled from library rows asks the player for one job, not a create and a "
          "fill") {
    Library library;
    buildLibrary(library);

    CreateLog log;
    const TestServer server(servingSettings(), creatingPlayer(&log), &library);

    const auto response = post(server, kCreatePlaylist,
                               createBody({{"structure", library.state().structure},
                                           {"ordinals", json::array({3, 1})}}));

    REQUIRE(response);
    REQUIRE(response->status == 200);

    CHECK(log.jobs == 1);
    CHECK(log.creates == 1);
    CHECK(log.title == kNewTitle);
    CHECK(log.rows.structure == library.state().structure);
    CHECK(log.rows.ordinals == std::vector<uint32_t>{3, 1});

    CHECK(json::parse(response->body)["itemCount"] == 2);
}

TEST_CASE("a create filled from a source playlist's rows asks the player for one job as well") {
    Library library;
    buildLibrary(library);

    CreateLog log;
    const TestServer server(servingSettings(), creatingPlayer(&log), &library);

    const auto response =
        post(server, kCreatePlaylist,
             createBody({{kSourceField, kPlaylistId},
                         {"runs", json::array({json::array({1, 2}), json::array({4, 1})})}}));

    REQUIRE(response);
    REQUIRE(response->status == 200);

    CHECK(log.jobs == 1);
    CHECK(log.rows.sourcePlaylistId == kPlaylistId);
    CHECK(log.rows.positions == std::vector<uint32_t>{1, 2, 4});
    CHECK(log.rows.ordinals.empty());

    CHECK(json::parse(response->body)["itemCount"] == 3);
}

// A client draws the new playlist from this answer and then keeps it on the poll, so an answer
// that is not the listing's own entry leaves one row in the sidebar drawn from different fields
// from every row beside it. Pinned as a set rather than field by field, so the two cannot drift.
TEST_CASE("a create answers the entry GET /api/playlists gives for the playlist it made") {
    CreateLog log;
    const TestServer server(servingSettings(), creatingPlayer(&log));

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

    CreateLog log;
    const TestServer server(servingSettings(), creatingPlayer(&log), &library);

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

    CHECK(log.jobs == 0);
}

// The set is a fill's body, so a client that fixed one for the fill route has fixed it for the
// create. Driving the same set at both is what holds the two grammars together: a create that
// grew its own reading of a run, or its own message for an ordinal past the end, is a second
// thing for a caller to learn.
TEST_CASE("a set a create cannot read is refused exactly as the fill route refuses it, and the "
          "player is never asked") {
    Library library;
    buildLibrary(library);
    const auto structure = library.state().structure;

    CreateLog log;
    const TestServer server(servingSettings(), creatingPlayer(&log), &library);

    struct BadSet {
        std::string name;
        json set;
    };

    const std::vector<BadSet> sets{
        {"an ordinal past the end of the library",
         json{{"structure", structure}, {"ordinals", json::array({kLibraryTracks})}}},
        {"runs reaching past the end of the library",
         json{{"structure", structure}, {"runs", json::array({json::array({0, 99})})}}},
        {"two selection forms at once",
         json{{"structure", structure},
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
    const auto sourced =
        post(server, kCreatePlaylist,
             createBody({{kSourceField, "------------------------------------"},
                         {"runs", json::array({json::array({0, 1})})}}));

    REQUIRE(sourced);
    CHECK(sourced->status == 400);
    if (sourced->status == 400)
        CHECK(json::parse(sourced->body)["error"] == describe(PlaylistRefusal::badId));

    CHECK(log.jobs == 0);
}

TEST_CASE("renaming a playlist hands the player its id and the new title, and the list answers "
          "the new one") {
    EditLog log;
    const TestServer server(servingSettings(), editingPlayer(&log));

    const auto response = post(server, playlistPath(kPlaylistId), renameBody(kNewTitle));

    REQUIRE(response);
    CHECK(accepted(response));

    CHECK(log.renames == 1);
    CHECK(log.lastId == kPlaylistId);
    CHECK(log.lastTitle == kNewTitle);

    CHECK(titleOf(server, kPlaylistId) == kNewTitle);
    CHECK(titleOf(server, kSecondPlaylistId) == "Ordinary playlist");
}

TEST_CASE("deleting a playlist takes it out of the list the player answers with") {
    EditLog log;
    const TestServer server(servingSettings(), editingPlayer(&log));

    const auto response = server.client().Delete(playlistPath(kPlaylistId), TestServer::bearer());

    REQUIRE(response);
    CHECK(accepted(response));

    CHECK(log.removals == 1);
    CHECK(log.lastId == kPlaylistId);

    CHECK(idsIn(listingOf(server)) ==
          std::vector<std::string>{kSecondPlaylistId, kThirdPlaylistId});
}

// The route that has already taken a player down. foobar2000 keeps a queued entry whose whole
// playlist is deleted rather than dropping it, and beefweb's own reader is what crashes on the
// infinite position it leaves behind: ARCHITECTURE.md, *Facts about the player*. So there is
// nothing here for a client or for this component to clear first. That the player itself
// survives one is the live check's half rather than this one's.
TEST_CASE("deleting a playlist asks the play queue nothing, before or after") {
    EditLog log;
    const TestServer server(servingSettings(),
                            countingQueueCalls(editingPlayer(&log), &log.queueCalls));

    const auto response = server.client().Delete(playlistPath(kPlaylistId), TestServer::bearer());

    REQUIRE(response);
    CHECK(accepted(response));

    CHECK(log.removals == 1);
    CHECK(log.queueCalls == 0);

    CHECK(idsIn(listingOf(server)).size() == 2);
    CHECK(log.queueCalls == 0);
}

TEST_CASE("moving a playlist hands the player its id and the index to move it to, and the list "
          "answers the new order") {
    EditLog log;
    const TestServer server(servingSettings(), editingPlayer(&log));

    const auto last = static_cast<uint32_t>(log.playlists.size() - 1);
    const auto response = post(server, movePath(kPlaylistId), moveBody(last));

    REQUIRE(response);
    CHECK(accepted(response));

    CHECK(log.moves == 1);
    CHECK(log.lastId == kPlaylistId);
    CHECK(log.lastIndex == last);

    const auto listed = listingOf(server);
    CHECK(idsIn(listed) ==
          std::vector<std::string>{kSecondPlaylistId, kThirdPlaylistId, kPlaylistId});
    CHECK(entryFor(listed, kPlaylistId).at("index") == last);
}

TEST_CASE("a move to one past the end of the list is a 400 and moves nothing") {
    EditLog log;
    const TestServer server(servingSettings(), editingPlayer(&log));

    const auto before = idsIn(listingOf(server));
    const auto pastEnd = static_cast<uint32_t>(log.playlists.size());

    const auto response = post(server, movePath(kPlaylistId), moveBody(pastEnd));

    REQUIRE(response);
    CHECK(response->status == 400);
    CHECK(json::parse(response->body)["error"].is_string());

    CHECK(log.moves == 1);
    CHECK(idsIn(listingOf(server)) == before);
}

TEST_CASE("an unknown playlist id is a 404 on each of the three edits, and the player is what "
          "says so") {
    for (const auto& edit : playlistEdits()) {
        INFO("edit: ", edit.name);

        EditLog log;
        const TestServer server(servingSettings(), editingPlayer(&log));

        const auto before = idsIn(listingOf(server));
        const auto response = edit.send(server, kUnknownPlaylistId);

        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(edit.calls(log) == 1);

        CHECK(idsIn(listingOf(server)) == before);
    }
}

TEST_CASE("a request each of the three edits can judge for itself is refused before the player "
          "is asked") {
    EditLog log;
    const TestServer server(servingSettings(), editingPlayer(&log));
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

    const std::vector<Body> indices{{"a body that is not JSON", "not json"},
                                    {"no index at all", json::object().dump()},
                                    {"an index that is not a number",
                                     json{{kMoveIndexField, "2"}}.dump()},
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

    CHECK(log.renames == 0);
    CHECK(log.removals == 0);
    CHECK(log.moves == 0);
    CHECK(idsIn(listingOf(server)) == before);
    CHECK(titleOf(server, kPlaylistId) == "#Jean Rock");
}

TEST_CASE("a copy appends a source playlist's rows to the end of the target, ascending whatever "
          "order the runs named them in") {
    RowsLog log;
    const TestServer server(servingSettings(), rowEditingPlayer(&log));

    const auto response = post(server, copyPath(kPlaylistId),
                               copyBody(kSecondPlaylistId, unorderedRuns()).dump());

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
    RowsLog log;
    const TestServer server(servingSettings(), rowEditingPlayer(&log));

    const auto before = generationOf(server, kPlaylistId);

    const auto response = post(server, copyPath(kPlaylistId),
                               copyBody(kSecondPlaylistId, unorderedRuns()).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    REQUIRE(answered.contains("positions"));
    CHECK(answered.at("positions") == json::array({4, 5, 6}));

    const auto generation = counterIn(answered, "structure");
    CHECK(generation == generationOf(server, kPlaylistId));
    CHECK(generation != before);
}

// See ARCHITECTURE.md, *Facts about the player*, on why beefweb's own API needs that read and
// this one does not.
TEST_CASE("a copy asks the player once, with no item count read before or after it") {
    RowsLog log;
    const TestServer server(servingSettings(), rowEditingPlayer(&log));

    const auto response = post(server, copyPath(kPlaylistId),
                               copyBody(kSecondPlaylistId, unorderedRuns()).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    CHECK(log.copies == 1);
    CHECK(log.calls == 1);
}

// `runs` naming nothing is what decodeSelection already takes everywhere else: a named form that
// expands to no rows is a client with nothing selected, and a form left out altogether is the
// refusal.
TEST_CASE("a copy naming no rows is accepted and appends nothing") {
    RowsLog log;
    const TestServer server(servingSettings(), rowEditingPlayer(&log));

    const auto before = heldTitles(server, kPlaylistId);

    const auto response = post(server, copyPath(kPlaylistId),
                               copyBody(kSecondPlaylistId, json::array()).dump());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto answered = json::parse(response->body);
    REQUIRE(answered.contains("positions"));
    CHECK(answered.at("positions").empty());

    CHECK(heldTitles(server, kPlaylistId) == before);
}

TEST_CASE("a removal takes the rows the runs named out of the playlist and answers the generation "
          "they left behind") {
    RowsLog log;
    const TestServer server(servingSettings(), rowEditingPlayer(&log));

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

TEST_CASE("a removal against a generation the playlist has moved past is a 409 and removes "
          "nothing") {
    RowsLog log;
    const TestServer server(servingSettings(), rowEditingPlayer(&log));

    const auto before = heldTitles(server, kPlaylistId);

    const auto response =
        post(server, removeRowsPath(kPlaylistId),
             removeRowsBody(kRowsStructure - 1, json::array({json::array({1, 2})})).dump());

    REQUIRE(response);
    CHECK(response->status == 409);
    CHECK(json::parse(response->body)["error"] == describe(PlaylistOutcome::rowsMoved));

    CHECK(heldTitles(server, kPlaylistId) == before);

    const auto generation = generationOf(server, kPlaylistId);
    CHECK(generation == std::to_string(kRowsStructure));
}

// An undo names the generation the page it was read from answered, verbatim. What stands between
// the two on a client is JSON.parse: read as a number, every generation this playlist can reach
// comes back as kThroughADouble, a value it has never stood at, and the undo is refused every
// time.
TEST_CASE("a removal against the generation a page answered is accepted, and against the value a "
          "double makes of it is not") {
    SUBCASE("the generation handed back exactly as it arrived") {
        RowsLog log;
        const TestServer server(servingSettings(), rowEditingPlayer(&log));

        const auto page = pageOf(server, kPlaylistId, 0, kEveryHeldRow, {"%title%"});

        const auto response =
            post(server, removeRowsPath(kPlaylistId),
                 json{{"structure", counterIn(page, "structure")},
                      {"runs", json::array({json::array({1, 2})})}}
                     .dump());

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(heldTitles(server, kPlaylistId) == json::array({"First", "Fourth"}));
    }

    SUBCASE("the generation after a trip through a double") {
        RowsLog log;
        const TestServer server(servingSettings(), rowEditingPlayer(&log));

        const auto response =
            post(server, removeRowsPath(kPlaylistId),
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

        int asked = 0;
        const TestServer server(servingSettings(), lockedPlaylistPlayer(&asked));

        const auto response = write.send(server);

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(json::parse(response->body)["error"] == describe(PlaylistOutcome::playlistLocked));

        CHECK(asked == 1);
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

        FillLog log;
        const TestServer server(servingSettings(),
                                refusingFillPlayer(&log, PlaylistOutcome::playlistLocked),
                                &library);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(json::parse(response->body)["error"] == describe(PlaylistOutcome::playlistLocked));

        CHECK(log.fills == 1);
    }
}

// The undo on Jean's toast is built from the positions a fill answered, so positions for rows
// that never landed ask the player to remove rows past the end of a playlist. A refusal names
// none, whatever the player reported adding on its way to refusing.
TEST_CASE("a fill the player refused answers no positions") {
    struct Refusal {
        PlaylistOutcome outcome;
        int status;
    };

    Library library;
    buildLibrary(library);

    for (const auto& refusal :
         {Refusal{PlaylistOutcome::playlistLocked, 409},
          Refusal{PlaylistOutcome::noSuchPlaylist, 404},
          Refusal{PlaylistOutcome::playerRefused, 500},
          Refusal{PlaylistOutcome::timedOut, 504}}) {
        INFO("outcome: ", describe(refusal.outcome));

        FillLog log;
        const TestServer server(servingSettings(), refusingFillPlayer(&log, refusal.outcome),
                                &library);

        const auto response = post(server, userFill(), userBody(library.state().structure));

        REQUIRE(response);
        CHECK(response->status == refusal.status);
        CHECK(json::parse(response->body).count("positions") == 0);
    }
}

TEST_CASE("a copy the component can judge for itself is refused exactly as a create from the same "
          "source is, and the player is never asked") {
    RowsLog log;
    CreateLog creates;
    const TestServer server(servingSettings(), rowEditingPlayerCreating(&log, &creates));

    struct BadCopy {
        std::string name;
        json set;
    };

    const std::vector<BadCopy> sets{
        {"runs that are not pairs",
         json{{kSourceField, kSecondPlaylistId}, {"runs", json::array({1, 2})}}},
        {"a run whose count is not a number",
         json{{kSourceField, kSecondPlaylistId},
              {"runs", json::array({json::array({0, "2"})})}}},
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

    CHECK(log.copies == 0);
    CHECK(creates.jobs == 0);
    CHECK(heldTitles(server, kPlaylistId) == json::array({"First", "Second", "Third", "Fourth"}));
}

TEST_CASE("a removal the component can judge for itself is refused exactly as a fill of the same "
          "set is, and the player is never asked") {
    Library library;
    buildLibrary(library);

    RowsLog log;
    const TestServer server(servingSettings(), rowEditingPlayer(&log), &library);

    struct BadSet {
        std::string name;
        json set;
    };

    const std::vector<BadSet> sets{
        {"runs that are not pairs", json{{"runs", json::array({0})}}},
        {"a run whose count is not a number",
         json{{"runs", json::array({json::array({0, "2"})})}}},
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

    CHECK(log.removals == 0);
    CHECK(log.fills == 0);
    CHECK(heldTitles(server, kPlaylistId) == json::array({"First", "Second", "Third", "Fourth"}));
}

TEST_CASE("a removal names a generation as a run of decimal digits, and anything else is a 400 "
          "the player never sees") {
    RowsLog log;
    const TestServer server(servingSettings(), rowEditingPlayer(&log));

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

        const auto response =
            post(server, removeRowsPath(kPlaylistId),
                 json{{"structure", bad.value}, {"runs", json::array({json::array({1, 2})})}}
                     .dump());

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(log.removals == 0);
    CHECK(heldTitles(server, kPlaylistId) == json::array({"First", "Second", "Third", "Fourth"}));
}

// The guard on the field that did not move. A fill resolves media library ordinals against the
// library's own generation, which is inside 2^53 and is a number; a removal names one playlist's
// counter, which is not. One parser taught both spellings would pass every case about a removal
// and lose the refusal a fill depends on, so the fill is driven here from the other side.
TEST_CASE("a fill's structure is still a number and refuses the digits a removal takes") {
    Library library;
    buildLibrary(library);

    RowsLog log;
    const TestServer server(servingSettings(), rowEditingPlayer(&log), &library);

    const auto sentAsDigits = post(server, userFill(),
                                   json{{"structure", std::to_string(library.state().structure)},
                                        {"ordinals", json::array({0})}}
                                       .dump());

    REQUIRE(sentAsDigits);
    CHECK(sentAsDigits->status == 400);
    CHECK(log.fills == 0);

    const auto sentAsANumber = post(server, userFill(),
                                    json{{"structure", library.state().structure},
                                         {"ordinals", json::array({0})}}
                                        .dump());

    REQUIRE(sentAsANumber);
    INFO("status: ", sentAsANumber->status);
    CHECK(accepted(sentAsANumber));
    CHECK(log.fills == 1);
}

TEST_CASE("a row edit naming a playlist the player does not hold is a 404, and the player is what "
          "says so") {
    for (const auto& edit : rowEdits()) {
        INFO("edit: ", edit.name);

        RowsLog log;
        const TestServer server(servingSettings(), rowEditingPlayer(&log));

        const auto response = edit.send(server, kUnknownPlaylistId);

        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(edit.calls(log) == 1);
    }

    RowsLog log;
    const TestServer server(servingSettings(), rowEditingPlayer(&log));

    const auto response = post(server, copyPath(kPlaylistId),
                               copyBody(kUnknownPlaylistId, unorderedRuns()).dump());

    REQUIRE(response);
    CHECK(response->status == 404);
    CHECK(log.copies == 1);
    CHECK(heldTitles(server, kPlaylistId) == json::array({"First", "Second", "Third", "Fourth"}));
}

TEST_CASE("every playlist route needs the token") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    CHECK(server.client().Get("/api/playlists")->status == 401);
    CHECK(server.client().Get(itemsPath(kPlaylistId, 0, 10, {"%title%"}))->status == 401);
    CHECK(server.client()
              .Get(changesPath(kPlaylistId, kRowsStructure, kChangedSince, {"%title%"}))
              ->status == 401);
    CHECK(server.client().Post(playPath(kPlaylistId, "0"), "", "application/json")->status == 401);
    CHECK(server.client().Post(kCreatePlaylist, createBody(), "application/json")->status == 401);
    CHECK(server.client()
              .Post(playlistPath(kPlaylistId), renameBody(kNewTitle), "application/json")
              ->status == 401);
    CHECK(server.client().Delete(playlistPath(kPlaylistId))->status == 401);
    CHECK(server.client().Post(movePath(kPlaylistId), moveBody(0), "application/json")->status ==
          401);
    CHECK(server.client()
              .Post(copyPath(kPlaylistId), copyBody(kSecondPlaylistId, unorderedRuns()).dump(),
                    "application/json")
              ->status == 401);
    CHECK(server.client()
              .Post(removeRowsPath(kPlaylistId),
                    removeRowsBody(kRowsStructure, unorderedRuns()).dump(), "application/json")
              ->status == 401);
    CHECK(server.client().Post("/api/autoplaylists", kCreate, "application/json")->status == 401);
    CHECK(server.client().Delete(std::string("/api/autoplaylists/") + kPlaylistId)->status == 401);

    CHECK(log.creates == 0);
    CHECK(log.removals == 0);
}

TEST_CASE("creating passes the whole request through to the player") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    const auto response = post(server, "/api/autoplaylists",
                               R"({"title": "#Jean Rock", "key": "folder:genre:Rock",
                                   "query": "%genre% IS Rock", "forceSort": true})");

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(json::parse(response->body)["id"] == kPlaylistId);

    REQUIRE(log.creates == 1);
    CHECK(log.lastSpec.title == "#Jean Rock");
    CHECK(log.lastSpec.key == "folder:genre:Rock");
    CHECK(log.lastSpec.query == "%genre% IS Rock");
    CHECK(log.lastSpec.forceSort);
}

TEST_CASE("a request the component can judge for itself never reaches the player") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    for (const char* body : {"not json", R"({"query": "%genre% IS Rock"})",
                             R"({"title": "#Jean Rock"})", R"({"title": "", "query": "a"})"}) {
        INFO("body: ", body);
        const auto response = post(server, "/api/autoplaylists", body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(log.creates == 0);
}

TEST_CASE("what the player says about a playlist maps onto a status a client can act on") {
    struct Case {
        PlaylistOutcome outcome;
        int status;
    };

    for (const auto& expected :
         {Case{PlaylistOutcome::queryInvalid, 400}, Case{PlaylistOutcome::notOurs, 403},
          Case{PlaylistOutcome::noSuchPlaylist, 404}, Case{PlaylistOutcome::keyInUse, 409},
          Case{PlaylistOutcome::tooMany, 409}, Case{PlaylistOutcome::playerRefused, 500},
          Case{PlaylistOutcome::timedOut, 504}, Case{PlaylistOutcome::unavailable, 503}}) {
        PlayerLog log;
        log.answer = expected.outcome;
        const TestServer server(servingSettings(), recordingPlayer(&log));

        const auto response = post(server, "/api/autoplaylists", kCreate);

        INFO("outcome: ", describe(expected.outcome));
        REQUIRE(response);
        CHECK(response->status == expected.status);
    }
}

TEST_CASE("a component with no player refuses honestly rather than pretending it did the work") {
    const TestServer server;

    CHECK(server.client().Get("/api/playlists", TestServer::bearer())->status == 503);
    CHECK(post(server, "/api/autoplaylists", kCreate)->status == 503);
    CHECK(post(server, "/api/autoplaylists/preview", R"({"query": "a"})")->status == 503);
    CHECK(server.client()
              .Delete(std::string("/api/autoplaylists/") + kPlaylistId, TestServer::bearer())
              ->status == 503);
}

TEST_CASE("updating and removing address one playlist by its id") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    const auto updated = post(server, std::string("/api/autoplaylists/") + kPlaylistId,
                              R"({"query": "%genre% IS Jazz"})");

    REQUIRE(updated);
    CHECK(updated->status == 200);
    CHECK(log.updates == 1);
    CHECK(log.lastId == kPlaylistId);
    CHECK(log.lastSpec.query == "%genre% IS Jazz");

    const auto removed = server.client().Delete(std::string("/api/autoplaylists/") + kPlaylistId,
                                                TestServer::bearer());

    REQUIRE(removed);
    CHECK(removed->status == 200);
    CHECK(json::parse(removed->body)["removed"] == true);
    CHECK(json::parse(removed->body)["id"] == kPlaylistId);
    CHECK(log.removals == 1);
}

// pfc::GUID_from_text reads an unknown character as zero and never reports failure, so a
// nonsense id would otherwise become a well-formed GUID that matches something one day.
TEST_CASE("an id that is not one we issued never reaches the player") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    // Wrong shape entirely, so the router has no route for them at all.
    for (const char* id : {"nonsense", "45837D74-FA4F-415C-BBA9-BF2DB8F0DC04", "../../etc"}) {
        INFO("id: ", id);
        const auto response =
            server.client().Delete(std::string("/api/autoplaylists/") + id, TestServer::bearer());
        REQUIRE(response);
        CHECK(response->status == 404);
    }

    // Right length and right alphabet, so this one reaches our own check and is refused by
    // name rather than as a missing route.
    const auto response = server.client().Delete(
        "/api/autoplaylists/------------------------------------", TestServer::bearer());

    REQUIRE(response);
    CHECK(response->status == 400);

    CHECK(log.removals == 0);
}

// A client calls this while somebody is still typing.
TEST_CASE("previewing a query answers 200 whether or not the query parses") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    const auto good = post(server, "/api/autoplaylists/preview", R"({"query": "%genre% IS Rock"})");

    REQUIRE(good);
    CHECK(good->status == 200);
    CHECK(json::parse(good->body)["valid"] == true);
    CHECK(json::parse(good->body)["matches"] == 412);
    CHECK(json::parse(good->body)["libraryEnabled"] == true);

    const auto bad = post(server, "/api/autoplaylists/preview", R"({"query": "bad"})");

    REQUIRE(bad);
    CHECK(bad->status == 200);
    CHECK(json::parse(bad->body)["valid"] == false);
    CHECK(json::parse(bad->body)["error"] == "Query syntax error");
}

// "preview" cannot match the id pattern, so this holds whatever order the routes are in.
TEST_CASE("previewing is not mistaken for a playlist id") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    post(server, "/api/autoplaylists/preview", R"({"query": "%genre% IS Rock"})");

    CHECK(log.updates == 0);
}

TEST_CASE("a client stuck in a loop is slowed down rather than obeyed") {
    PlayerLog log;
    clearLog();
    const TestServer server(servingSettings(), recordingPlayer(&log));

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
    CHECK(log.creates < 60);

    const auto first429 =
        std::find_if(replies.begin(), replies.end(),
                     [](const httplib::Result& r) { return r && r->status == 429; });
    REQUIRE(first429 != replies.end());
    CHECK((*first429)->get_header_value("Retry-After") == "1");
    CHECK(json::parse((*first429)->body)["error"].is_string());

    // A line for the burst rather than one per refusal, which would be the same flood written
    // to a disk. Not pinned to exactly one: a slow machine can earn a token back mid-burst.
    const auto lines = loggedLines();
    const auto complaints = std::count_if(lines.begin(), lines.end(), [](const std::string& line) {
        return line.find("refusing playlist changes") != std::string::npos;
    });

    CHECK(complaints >= 1);
    CHECK(complaints < refused);

    // Reading changes nothing, so it is not limited and a different route cannot spend it.
    CHECK(server.client().Get("/api/playlists", TestServer::bearer())->status == 200);
}

TEST_CASE("an install that allows no autoplaylists says so before a client offers to make one") {
    SUBCASE("the default install can create, and says how many") {
        const TestServer server(servingSettings());
        const auto body =
            json::parse(server.client().Get("/api/capabilities", TestServer::bearer())->body);

        CHECK(body["canCreateAutoPlaylists"] == true);
        CHECK(body["maxAutoPlaylists"] == Settings().maxAutoPlaylists);
    }

    SUBCASE("a cap of zero reads as off rather than as a limit of zero to discover") {
        auto settings = servingSettings();
        settings.maxAutoPlaylists = 0;

        const TestServer server(settings);
        const auto body =
            json::parse(server.client().Get("/api/capabilities", TestServer::bearer())->body);

        CHECK(body["canCreateAutoPlaylists"] == false);
        CHECK(body["maxAutoPlaylists"] == 0);
    }
}

TEST_CASE("creating an autoplaylist needs both a cap to spend and writable playlists") {
    const auto offered = [](bool writePlaylists, int maxAutoPlaylists) {
        auto settings = servingSettings();
        settings.writePlaylists = writePlaylists;
        settings.maxAutoPlaylists = maxAutoPlaylists;

        return capabilitiesOf(settings)["canCreateAutoPlaylists"];
    };

    CHECK(offered(true, 4) == true);
    CHECK(offered(false, 4) == false);
    CHECK(offered(true, 0) == false);
    CHECK(offered(false, 0) == false);
}

TEST_CASE("GET /api/capabilities says whether this install permits playlist writes") {
    SUBCASE("a config nobody narrowed permits them") {
        CHECK(capabilitiesOf(servingSettings())["canWritePlaylists"] == true);
    }

    SUBCASE("read-only is published, rather than left for a client to learn from a refusal") {
        auto settings = servingSettings();
        settings.writePlaylists = false;

        CHECK(capabilitiesOf(settings)["canWritePlaylists"] == false);
    }
}

// A client reads this once and draws the player from it, so one of these dropped later is a
// client back on the poll for something that cannot change while the player runs.
TEST_CASE("one read of GET /api/capabilities answers everything static a player UI needs") {
    const auto body = capabilitiesOf(servingSettings());

    const std::vector<std::string> published = {"playerName",     "playerVersion",
                                                "volumeMin",      "volumeMax",
                                                "volumeUnit",     "canWritePlaylists",
                                                "canChangeOutput"};

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
TEST_CASE("GET /api/capabilities offers the playback modes in Jean's names, as the player lists them") {
    const auto body = capabilitiesReporting(kReportedOrders);

    CHECK(body["playbackModes"] == kOfferedModes);

    for (const std::string& order : kReportedOrders) {
        INFO("order: ", order);
        CHECK(body.dump().find(order) == std::string::npos);
    }
}

TEST_CASE("a playback order this component has no name for is not offered at all") {
    auto reported = kReportedOrders;
    reported.emplace_back(kOrderAddedByAComponent);

    const auto body = capabilitiesReporting(reported);

    CHECK(body["playbackModes"] == kOfferedModes);
    CHECK(body.dump().find(kOrderAddedByAComponent) == std::string::npos);
}

// The offer is what this player answers rather than what foobar2000 usually answers, so a client
// never draws a control for a mode this install cannot be put into.
TEST_CASE("an order the player does not report is not offered, even though Jean has a name for it") {
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
        auto settings = parseSettings(config);
        settings.authToken = kToken;
        return capabilitiesOf(settings);
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
    FillLog log;
    Library unbuilt;

    const auto refused = [&log](Library* library, const std::string& error) {
        const TestServer server(servingSettings(), fillingPlayer(&log), library);

        for (const auto& target : targets(kHeldStructure)) {
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

    CHECK(log.roles.empty());
    CHECK(log.fills == 0);
}

TEST_CASE("a fill resolved against a generation the library has moved past inserts nothing") {
    Library library;
    buildLibrary(library);
    const uint64_t exported = library.state().structure;

    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    for (const auto& target : targets(exported)) {
        INFO("target: ", target.name);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        CHECK(response->status == 409);

        CHECK(json::parse(response->body)["error"] == describe(DeltaOutcome::structureChanged));
    }

    CHECK(log.inserted.empty());
}

// Play all and Shuffle all always reach the end of the library, so one deletion at the desktop
// is enough to hit this from a client holding an otherwise valid export.
TEST_CASE("a fill whose ordinals were valid against a larger library answers 409 once it shrinks") {
    Library library;
    buildLibrary(library);
    const uint64_t exported = library.state().structure;

    buildLibrary(library, kLibraryTracks - 6);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    for (const auto& target : targets(exported)) {
        INFO("target: ", target.name);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        CHECK(response->status == 409);

        CHECK(json::parse(response->body)["error"] == describe(DeltaOutcome::structureChanged));
    }

    CHECK(log.inserted.empty());
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

    FillLog log;
    log.structure = exported;
    const TestServer server(servingSettings(), namingPlayer(&log), &library);

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
        buildLibrary(library);
        log.structure = library.state().structure;

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

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), namingPlayer(&log), &library);

    const auto first = post(server, kScratchFill, ownBody(kScratchTitle, log.structure));
    REQUIRE(first);
    REQUIRE(first->status == 200);
    REQUIRE(json::parse(first->body)["playlistId"] == kScratchPlaylistId);

    scratchDeletedAtThePlayer(log);

    const auto again = post(server, kScratchFill, ownBody(kScratchTitle, log.structure));

    REQUIRE(again);
    CHECK(again->status == 200);
    CHECK(json::parse(again->body)["playlistId"] == kRemadePlaylistId);
    CHECK(log.roles == std::vector<std::string>{"scratch", "scratch"});
    CHECK(log.filled == kRemadePlaylistId);
    CHECK(log.held[kRemadePlaylistId] == 2);

    const auto found = foundByRole(server);
    REQUIRE(found.size() == 1);
    CHECK(found.front()["id"] == kRemadePlaylistId);
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

        FillLog log;
        log.structure = library.state().structure;
        const TestServer server(servingSettings(), namingPlayer(&log), &library);

        const auto response = post(server, kScratchFill, ownBody(asked, log.structure));
        REQUIRE(response);
        CHECK(response->status == 200);

        const auto found = foundByRole(server);
        REQUIRE(found.size() == 1);

        const auto title = found.front().at("title").get<std::string>();
        INFO("titled at the player: ", title);
        CHECK(title.substr(0, kJeanPrefix.size()) == kJeanPrefix);
    }
}

TEST_CASE("each fill operation addresses its own kind of playlist") {
    Library library;
    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    SUBCASE("the scratch role fills the playlist that role resolved to") {
        const auto response = post(server, kScratchFill, ownBody(kScratchTitle, log.structure));

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(log.roles == std::vector<std::string>{"scratch"});
        CHECK(log.title == kScratchTitle);
        CHECK(log.filled == kScratchPlaylistId);
        CHECK(log.inserted == std::vector<uint32_t>{3, 1});
    }

    SUBCASE("a user's playlist is filled by the GUID it was asked for, resolving no role") {
        const auto response = post(server, userFill(), userBody(log.structure));

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(log.roles.empty());
        CHECK(log.filled == kPlaylistId);
    }
}

TEST_CASE("a role the contract does not name is refused rather than made") {
    Library library;
    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    for (const std::string& role : {std::string("library"), std::string("Scratch"),
                                    std::string("queue2"), std::string(kPlaylistId)}) {
        INFO("role: ", role);

        const auto response = post(server, "/api/playlists/own/" + role + "/items",
                                   ownBody(kScratchTitle, log.structure));

        REQUIRE(response);
        CHECK(response->status == 400);
    }

    CHECK(log.roles.empty());
    CHECK(log.fills == 0);
}

// The play queue is this component's own, read and written through /api/queue, and the playlist
// a client used to hold library tracks in went with the role that resolved it. A client still
// sending the old fill is told the role is not one of ours, rather than left filling a playlist
// that will never be queued from, emptied or deleted, and that shows up in foobar2000's own tabs
// for as long as the install lasts.
TEST_CASE("the queue role is gone, and neither verb on it reaches the player") {
    Library library;
    buildLibrary(library);

    auto log = holding(library.state().structure);
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    const auto filled = post(server, kQueueFill, ownBody(kScratchTitle, log.structure));
    const auto emptied = server.client().Delete(kQueueFill, TestServer::bearer());
    const auto invented =
        post(server, "/api/playlists/own/library/items", ownBody(kScratchTitle, log.structure));

    REQUIRE(filled);
    REQUIRE(emptied);
    REQUIRE(invented);

    CHECK(filled->status == 400);
    CHECK(emptied->status == 400);

    // One mistake, one refusal: a client naming a role this component does not have. There is
    // nothing more specific to say about `queue` than about any other word.
    CHECK(json::parse(filled->body) == json::parse(invented->body));
    CHECK(json::parse(emptied->body) == json::parse(invented->body));

    CHECK(log.roles.empty());
    CHECK(log.fills == 0);
    CHECK(log.deletes == 0);
    CHECK(log.held == holding(log.structure).held);
}

TEST_CASE("the scratch playlist is emptied before a fill and every other target is appended to") {
    Library library;
    buildLibrary(library);

    for (const auto& target : targets(library.state().structure)) {
        INFO("target: ", target.name);

        FillLog log;
        log.structure = library.state().structure;
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        CHECK(response->status == 200);
        REQUIRE(log.fills == 1);
        CHECK(log.replace == target.replaces);
    }
}

// Both fill schemas publish `additionalProperties: false`, and `replace` is the field that costs:
// a fill empties the playlist or appends to it according to the target, so a client sending it
// would be told nothing while the component appended. `items` is what beefweb's own
// add-from-library names its rows, and it is here because the rule is every field the contract
// does not declare rather than `replace` in particular.
TEST_CASE("a field neither fill schema declares is refused, and nothing is inserted") {
    Library library;
    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    const std::vector<std::pair<std::string, json>> undeclared{
        {"replace", true}, {"items", json::array({"Artist/Album/1.flac"})}};

    for (const auto& target : targets(log.structure)) {
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
    CHECK(log.roles.empty());
    CHECK(log.fills == 0);
}

TEST_CASE("a title is declared on the component's own playlist and undeclared on a user's") {
    Library library;
    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    SUBCASE("the component's own role takes one") {
        const auto scratch = post(server, kScratchFill, ownBody(kScratchTitle, log.structure));
        REQUIRE(scratch);
        CHECK(scratch->status == 200);

        CHECK(log.fills == 1);
        CHECK(log.title == kScratchTitle);
    }

    SUBCASE("a user's playlist is refused rather than retitled") {
        const auto response =
            post(server, userFill(), withField(userBody(log.structure), "title", "#Jean Scratch"));

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"] == "malformed request");
        CHECK(log.fills == 0);
    }
}

// FillOwnPlaylistRequest.title carries the same limit as an autoplaylist's: a line break in
// it would be a line break in a foobar2000 playlist tab, and 256 characters is the same cap
// parseAutoPlaylist holds a title to. Both routes take a title from the same check for
// exactly that reason.
TEST_CASE("a title on the component's own playlist is held to the limit an autoplaylist's is") {
    Library library;
    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    SUBCASE("a control character is refused rather than reaching the player") {
        const auto response = post(
            server, kScratchFill, withField(ownBody(kScratchTitle, log.structure), "title", "a\nb"));

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"] == "unacceptable title");
        CHECK(log.roles.empty());
        CHECK(log.fills == 0);
    }

    SUBCASE("longer than 256 characters is refused rather than truncated") {
        const auto response = post(server, kScratchFill,
                                   withField(ownBody(kScratchTitle, log.structure), "title",
                                             std::string(257, 'a')));

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"] == "unacceptable title");
        CHECK(log.fills == 0);
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

            auto log = holding(structure);
            const TestServer server(servingSettings(), fillingPlayer(&log), &library);

            const auto response = post(server, target.path, target.body);

            REQUIRE(response);
            REQUIRE(response->status == 200);
            CHECK(json::parse(response->body)["positions"] == json::array({5, 6, 7}));
        }
    }

    SUBCASE("a replace lands at zero, because the scratch is emptied before it is filled") {
        auto log = holding(structure);
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = post(server, kScratchFill, ownBody(kScratchTitle, structure));

        REQUIRE(response);
        REQUIRE(response->status == 200);
        CHECK(json::parse(response->body)["positions"] == json::array({0, 1}));
    }

    SUBCASE("a set given as runs answers one position per row the runs expand to") {
        auto log = holding(structure);
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

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

        auto log = holding(structure);
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        REQUIRE(response->status == 200);
        CHECK(json::parse(response->body)["playlistId"] == target.id);
    }
}

TEST_CASE("a fill answers beefweb's id for that playlist, or null where beefweb has none yet") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    SUBCASE("a playlist beefweb has already mapped is answered by the id it reported") {
        auto log = holding(structure);
        log.beefwebId = "p7";
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = post(server, kScratchFill, ownBody(kScratchTitle, structure));

        REQUIRE(response);
        REQUIRE(response->status == 200);
        CHECK(json::parse(response->body)["beefwebId"] == "p7");
    }

    SUBCASE("one beefweb has not seen yet is null rather than blank or missing") {
        auto log = holding(structure);
        log.beefwebId = "";
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = post(server, kScratchFill, ownBody(kScratchTitle, structure));

        REQUIRE(response);
        REQUIRE(response->status == 200);

        auto body = json::parse(response->body);
        CHECK(body.contains("beefwebId"));
        CHECK(body["beefwebId"].is_null());
    }

    SUBCASE("a user's playlist answers the field as well") {
        auto log = holding(structure);
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = post(server, userFill(), userBody(structure));

        REQUIRE(response);
        REQUIRE(response->status == 200);

        auto body = json::parse(response->body);
        CHECK(body.contains("beefwebId"));
        CHECK((body["beefwebId"].is_null() || body["beefwebId"].is_string()));
    }
}

TEST_CASE("with writePlaylists off, every write but the component's own is refused and never "
          "reaches the player") {
    Library library;
    buildLibrary(library);

    WriteLog log;
    log.fills.structure = library.state().structure;
    const TestServer server(readOnlyPlaylists(), writingPlayer(&log), &library);

    for (const auto& write : playlistWrites(log.fills.structure)) {
        INFO("write: ", write.name);

        const auto response = write.send(server);

        REQUIRE(response);
        CHECK(response->status == 403);

        CHECK(errorIn(*response) == describe(PlaylistOutcome::writesDisabled));
    }

    CHECK(log.autoPlaylists.creates == 0);
    CHECK(log.autoPlaylists.updates == 0);
    CHECK(log.autoPlaylists.removals == 0);
    CHECK(log.fills.fills == 0);
    CHECK(log.fills.inserted.empty());

    CHECK(log.creates.creates == 0);
    CHECK(log.edits.renames == 0);
    CHECK(log.edits.moves == 0);
    CHECK(log.edits.removals == 0);
    CHECK(log.rows.copies == 0);
    CHECK(log.rows.removals == 0);
}

// One status, two causes, and a message that has to be true of the cause it was sent for. The
// setting is decided here before the player is asked; a playlist this component did not create
// is something only the player can report, and it is refused whatever the setting says. Naming
// the setting on both sends a player owner to config.json to turn on something already on.
TEST_CASE("a write refused by the setting and one refused for a playlist this component did not "
          "create say different things") {
    const auto update = [](const TestServer& server) {
        return post(server, std::string("/api/autoplaylists/") + kPlaylistId,
                    R"({"query": "%genre% IS Jazz"})");
    };

    PlayerLog gated;
    const TestServer refusing(readOnlyPlaylists(), recordingPlayer(&gated));

    const auto bySetting = update(refusing);
    REQUIRE(bySetting);
    REQUIRE(bySetting->status == 403);
    CHECK(gated.updates == 0);

    PlayerLog asked;
    asked.answer = PlaylistOutcome::notOurs;
    const TestServer writing(servingSettings(), recordingPlayer(&asked));

    const auto byOwnership = update(writing);
    REQUIRE(byOwnership);
    REQUIRE(byOwnership->status == 403);
    CHECK(asked.updates == 1);

    const std::string setting = json::parse(bySetting->body)["error"];
    const std::string ownership = json::parse(byOwnership->body)["error"];

    const auto names = [](const std::string& message, const std::string& what) {
        return message.find(what) != std::string::npos;
    };

    CHECK(names(setting, "writePlaylists"));
    CHECK(names(setting, "config.json"));

    CHECK_FALSE(names(ownership, "writePlaylists"));
    CHECK_FALSE(names(ownership, "config.json"));
    CHECK(ownership != setting);

    const auto published = publishedEnum("PlaylistFailed", "error");
    for (const auto& error : {setting, ownership}) {
        INFO("error: ", error);
        CHECK(std::find(published.begin(), published.end(), error) != published.end());
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

        FillLog fills;
        fills.structure = library.state().structure;
        const TestServer server(writePlaylists ? servingSettings() : readOnlyPlaylists(),
                                fillingPlayer(&fills), &library);

        const auto response = post(server, kScratchFill, ownBody(kScratchTitle, fills.structure));

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(fills.filled == kScratchPlaylistId);
        CHECK(fills.inserted == std::vector<uint32_t>{3, 1});
    }
}

// The scratch is Jean's own working space, addressed by role and never by GUID. An edit reaching
// it by GUID would rename, delete or empty the playlist somebody is listening from, so the switch
// being on does not buy one: the refusal is structural, as notOurs is, rather than the setting's.
TEST_CASE("an edit addressing the component's own scratch playlist is refused whether "
          "writePlaylists is on or off") {
    for (const bool writePlaylists : {true, false}) {
        INFO("writePlaylists: ", writePlaylists);
        const auto settings = writePlaylists ? servingSettings() : readOnlyPlaylists();

        for (const auto& edit : playlistEdits()) {
            INFO("edit: ", edit.name);

            EditLog log;
            log.playlists.push_back(scratchEntry());
            const TestServer server(settings, editingPlayer(&log));

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

            RowsLog log;
            log.playlists[kScratchPlaylistId] = scratchRows();
            const TestServer server(settings, rowEditingPlayer(&log));

            const auto before = heldTitles(server, kScratchPlaylistId);

            const auto response = edit.send(server, kScratchPlaylistId);

            REQUIRE(response);
            CHECK(response->status == 403);
            namesTheRole(*response, writePlaylists);

            CHECK(heldTitles(server, kScratchPlaylistId) == before);
        }
    }
}

// The asymmetry the refusal above turns on, and the rule it rests on: the scratch may not be
// addressed as the thing being changed, and may always be read from. Jean plays a search through
// the scratch, so *Add to playlist* and *Save as playlist* over those results both read its rows
// and write somebody else's playlist. A refusal that looked at the GUID wherever it appeared
// would take both away, which is why the two routes that carry a source are driven here.
TEST_CASE("a copy whose source is the scratch lands the rows in the playlist it names") {
    RowsLog log;
    log.playlists[kScratchPlaylistId] = scratchRows();
    const TestServer server(servingSettings(), rowEditingPlayer(&log));

    const auto response =
        post(server, copyPath(kPlaylistId),
             copyBody(kScratchPlaylistId, json::array({json::array({0, 2})})).dump());

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(log.copies == 1);

    CHECK(heldTitles(server, kPlaylistId) ==
          json::array({"First", "Second", "Third", "Fourth", "Result A", "Result B"}));
}

// The other half of that rule, and the one *Save as playlist* rides on: a create takes a source
// playlist and runs of its positions, so the results Jean played through the scratch reach a
// playlist of the user's in one request.
TEST_CASE("a create whose source is the scratch fills the new playlist and leaves the scratch "
          "standing") {
    RowsLog log;
    log.playlists[kScratchPlaylistId] = scratchRows();

    CreateLog creates;
    const TestServer server(servingSettings(), rowEditingPlayerCreating(&log, &creates));

    const auto before = heldTitles(server, kScratchPlaylistId);

    const auto response = post(server, kCreatePlaylist,
                               createBody({{kSourceField, kScratchPlaylistId},
                                           {"runs", json::array({json::array({0, 2})})}}));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(creates.rows.sourcePlaylistId == kScratchPlaylistId);
    CHECK(json::parse(response->body)["itemCount"] == 2);

    CHECK(heldTitles(server, kScratchPlaylistId) == before);
}

TEST_CASE("an install that never set writePlaylists permits every write the setting would "
          "refuse") {
    Library library;
    buildLibrary(library);

    WriteLog log;
    log.fills.structure = library.state().structure;
    const TestServer server(servingSettings(), writingPlayer(&log), &library);

    for (const auto& write : playlistWrites(log.fills.structure)) {
        INFO("write: ", write.name);

        const auto response = write.send(server);

        REQUIRE(response);
        CHECK(response->status == write.whenAccepted);
    }

    CHECK(log.autoPlaylists.creates == 1);
    CHECK(log.autoPlaylists.updates == 1);
    CHECK(log.autoPlaylists.removals == 1);
    CHECK(log.fills.fills == 1);
    CHECK(log.fills.inserted == std::vector<uint32_t>{3, 1});

    CHECK(log.creates.creates == 1);
    CHECK(log.edits.renames == 1);
    CHECK(log.edits.moves == 1);
    CHECK(log.edits.removals == 1);
    CHECK(log.rows.copies == 1);
    CHECK(log.rows.removals == 1);
}

TEST_CASE("what refuses a fill is the setting and never the playlist's title") {
    Library library;
    buildLibrary(library);

    for (const std::string& title : {std::string("#Jean Queue"), std::string("Road trip")}) {
        for (const bool writePlaylists : {true, false}) {
            INFO("title: ", title, ", writePlaylists: ", writePlaylists);

            FillLog fills;
            fills.structure = library.state().structure;
            fills.listedTitle = title;
            const TestServer server(writePlaylists ? servingSettings() : readOnlyPlaylists(),
                                    fillingPlayerListing(&fills), &library);

            const auto response = post(server, userFill(), userBody(fills.structure));

            REQUIRE(response);
            CHECK(response->status == (writePlaylists ? 200 : 403));
            CHECK(fills.fills == (writePlaylists ? 1 : 0));
        }
    }
}

// "It holds nothing afterwards" is half the promise: an empty that deleted the playlist and made
// another would satisfy that, lose the playlist the player is playing from, and take foobar2000
// down with it wherever the play queue pointed into the one it deleted.
TEST_CASE("emptying the role takes its playlist's rows and leaves the playlist itself standing") {
    Library library;
    buildLibrary(library);

    auto log = holding(library.state().structure);
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    const auto response = server.client().Delete(kScratchFill, TestServer::bearer());

    REQUIRE(response);
    INFO("status: ", response->status);
    CHECK(accepted(response));

    CHECK(log.held[kScratchPlaylistId] == 0);
    CHECK(log.playlists["scratch"] == kScratchPlaylistId);
    CHECK(log.deletes == 0);

    // A user's playlist is not this request's to take rows from either, whatever it holds.
    CHECK(log.held[kPlaylistId] == kHeldRows);
}

// One 503, two subsystems behind it. A player that cannot reach the component's own playlists
// has said nothing about autoplaylists, and a message naming those sends a player owner to
// maxAutoPlaylists over a playlist no limit governs.
TEST_CASE("an empty the player cannot serve names its own playlists rather than autoplaylists") {
    const TestServer server;

    const auto response = server.client().Delete(kScratchFill, TestServer::bearer());

    REQUIRE(response);
    CHECK(response->status == 503);

    const std::string error = json::parse(response->body)["error"];
    CHECK(error != describe(PlaylistOutcome::unavailable));
    CHECK(error.find("autoplaylist") == std::string::npos);
}

// The scratch holds no music of the user's: it is how Jean plays a set, emptied and refilled for
// every view. A setting meant to protect a user's playlists has nothing to say about it.
TEST_CASE("the component's own playlist empties whether writePlaylists is on or off") {
    Library library;
    buildLibrary(library);

    for (const bool writePlaylists : {true, false}) {
        INFO("writePlaylists: ", writePlaylists);

        auto log = holding(library.state().structure);
        const TestServer server(writePlaylists ? servingSettings() : readOnlyPlaylists(),
                                fillingPlayer(&log), &library);

        const auto response = server.client().Delete(kScratchFill, TestServer::bearer());

        REQUIRE(response);
        INFO("status: ", response->status);
        CHECK(accepted(response));
        CHECK(log.held[kScratchPlaylistId] == 0);
    }
}

TEST_CASE("a role the contract does not name is refused on an empty exactly as it is on a fill") {
    Library library;
    buildLibrary(library);

    auto log = holding(library.state().structure);
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    for (const std::string& role : {std::string("library"), std::string("Scratch"),
                                    std::string("queue2"), std::string(kPlaylistId)}) {
        INFO("role: ", role);
        const auto path = "/api/playlists/own/" + role + "/items";

        const auto emptied = server.client().Delete(path, TestServer::bearer());
        const auto filled = post(server, path, ownBody(kScratchTitle, log.structure));

        REQUIRE(emptied);
        REQUIRE(filled);

        CHECK(emptied->status == 400);
        CHECK(emptied->status == filled->status);
        CHECK(json::parse(emptied->body)["error"] == json::parse(filled->body)["error"]);
    }

    CHECK(log.held[kScratchPlaylistId] == kHeldRows);
    CHECK(log.roles.empty());
    CHECK(log.fills == 0);
}

TEST_CASE("the contract publishes a 403 on exactly the writes the setting can refuse") {
    const auto published = publishedRoutes();

    const auto answers403 = [&published](const std::string& name) {
        const auto found =
            std::find_if(published.begin(), published.end(), [&name](const SpecRoute& route) {
                return route.method + " " + route.path == name;
            });

        REQUIRE_MESSAGE(found != published.end(), "contract/openapi.yaml publishes no ", name);
        return found->statuses.count(403) == 1;
    };

    for (const std::string& name :
         {std::string("POST /autoplaylists"), std::string("POST /autoplaylists/{id}"),
          std::string("DELETE /autoplaylists/{id}"), std::string("POST /playlists/{id}/items")}) {
        INFO("route: ", name);
        CHECK(answers403(name));
    }

    CHECK_FALSE(answers403("POST /playlists/own/{role}/items"));
    CHECK_FALSE(answers403("DELETE /playlists/own/{role}/items"));
}
