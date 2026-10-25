#include "support/summary_library.h"

#include "support/fixtures.h"

#include "third_party/doctest.h"
#include "third_party/httplib.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <ctime>
#include <iterator>
#include <map>
#include <optional>
#include <ranges>

namespace jean::testing {

namespace {

constexpr size_t kAlbums = 5;
constexpr size_t kTracksPerAlbum = 2;

using RoleField = std::optional<size_t> SummaryRoles::*;

struct RoleColumn {
    const char* name;
    const char* expression;
    RoleField field;
};

const std::vector<RoleColumn>& roleColumns() {
    static const std::vector<RoleColumn> columns{
        {"trackNumber", "%tracknumber%", &SummaryRoles::trackNumber},
        {"discNumber", "%discnumber%", &SummaryRoles::discNumber},
        {"title", "%title%", &SummaryRoles::title},
        {"artist", "%artist%", &SummaryRoles::artist},
        {"album", "%album%", &SummaryRoles::album},
        {"albumArtist", "%album artist%", &SummaryRoles::albumArtist},
        {"duration", "%length_seconds%", &SummaryRoles::duration},
        {"playCount", "%lastfm_play_count%", &SummaryRoles::playCount},
        {"lastPlayed", "%lastfm_last_played%", &SummaryRoles::lastPlayed},
        {"rating", "%rating%", &SummaryRoles::rating},
        {"year", "%date%", &SummaryRoles::year},
        {"genre", "%genre%", &SummaryRoles::genre},
        {"codec", "%codec%", &SummaryRoles::codec},
        {"bitrate", "%bitrate%", &SummaryRoles::bitrate},
        {"playCountLocal", "%play_count%", &SummaryRoles::playCountLocal},
        {"lastPlayedLocal", "%last_played%", &SummaryRoles::lastPlayedLocal},
        {"added", "%added%", &SummaryRoles::added},
    };
    return columns;
}

std::string dayOfMarch(const size_t day) {
    return "2026-03-0" + std::to_string(day);
}

std::map<std::string, std::string> trackValues(const size_t ordinal, const int plays) {
    const size_t album = ordinal / kTracksPerAlbum;
    const size_t onAlbum = ordinal % kTracksPerAlbum;
    const std::string albumName = "Album " + std::to_string(album);

    return {
        {"%tracknumber%", std::to_string(onAlbum + 1)},
        {"%discnumber%", "1"},
        {"%title%", "Song " + std::to_string(ordinal)},
        {"%artist%", album % 2 == 0 ? "Artist A" : "Artist B"},
        {"%album%", albumName},
        {"%album artist%", kUnresolved},
        {"%length_seconds%", "200"},
        {"%lastfm_play_count%", std::to_string(plays)},
        {"%lastfm_last_played%", dayOfMarch(album + 1) + " 20:00:00"},
        {"%rating%", onAlbum == 0 ? "5" : kUnresolved},
        {"%date%", std::to_string(1990 + album)},
        {"%genre%", album % 2 == 0 ? "Rock" : "Jazz"},
        {"%codec%", album == 0 ? "MP3" : "FLAC"},
        {"%bitrate%", album == 0 ? "128" : "900"},
        {"%play_count%", std::to_string(album)},
        {"%last_played%", kUnresolved},
        {"%added%", dayOfMarch(album + 1) + " 09:00:00"},
        {kSpareExpression, std::to_string((kAlbums * kTracksPerAlbum) - ordinal)},
    };
}

int initialPlays(const size_t ordinal) {
    return static_cast<int>((ordinal / kTracksPerAlbum) + (ordinal % kTracksPerAlbum) + 1);
}

std::vector<std::string> rowOf(const size_t ordinal, const int plays) {
    const size_t album = ordinal / kTracksPerAlbum;
    std::vector<std::string> row{
        "Artist/Album " + std::to_string(album) + "/",
        "0" + std::to_string((ordinal % kTracksPerAlbum) + 1) + " Song.flac", "0"};
    const auto values = trackValues(ordinal, plays);
    for (const auto& column : summaryColumns())
        row.push_back(values.at(column));
    return row;
}

std::string encoded(const std::string& expression) {
    return httplib::encode_query_component(expression, false);
}

}  // namespace

const std::vector<RoleAsked>& everyRole() {
    static const std::vector<RoleAsked> roles = [] {
        std::vector<RoleAsked> all;
        for (const auto& column : roleColumns())
            all.push_back({column.name, column.expression});
        return all;
    }();
    return roles;
}

std::vector<RoleAsked> everyRoleBut(const std::vector<std::string>& leftOut) {
    std::vector<RoleAsked> roles;
    std::copy_if(everyRole().begin(), everyRole().end(), std::back_inserter(roles),
                 [&leftOut](const RoleAsked& role) {
                     return std::find(leftOut.begin(), leftOut.end(), role.name) == leftOut.end();
                 });
    return roles;
}

std::vector<RoleAsked> everyRoleWith(const RoleAsked& replacement) {
    auto roles = everyRole();
    for (auto& role : roles) {
        if (role.name == replacement.name)
            role = replacement;
    }
    return roles;
}

std::vector<std::string> summaryColumns() {
    std::vector<std::string> columns{kSpareExpression};
    for (const auto& column : std::views::reverse(roleColumns()))
        columns.emplace_back(column.expression);
    return columns;
}

Snapshot summarySnapshot() {
    std::vector<std::vector<std::string>> rows;
    rows.reserve(kAlbums * kTracksPerAlbum);
    for (size_t ordinal = 0; ordinal < kAlbums * kTracksPerAlbum; ++ordinal)
        rows.push_back(rowOf(ordinal, initialPlays(ordinal)));
    return snapshotOf(summaryColumns(), rows);
}

RowChange summaryTrackPlayed(const uint32_t ordinal, const int plays) {
    return {ordinal, rowOf(ordinal, plays)};
}

int64_t localNoon(const uint32_t yyyymmdd) {
    std::tm local{};
    local.tm_year = static_cast<int>(yyyymmdd / 10000) - 1900;
    local.tm_mon = static_cast<int>(yyyymmdd / 100 % 100) - 1;
    local.tm_mday = static_cast<int>(yyyymmdd % 100);
    local.tm_hour = 12;
    local.tm_isdst = -1;
    return int64_t{std::mktime(&local)} * 1000;
}

LocalTime localTimeOn(const uint32_t yyyymmdd) {
    return LocalTime{
        [](const int year, const int month, const int day, const int hour, const int minute,
           const int second) {
            std::tm local{};
            local.tm_year = year - 1900;
            local.tm_mon = month - 1;
            local.tm_mday = day;
            local.tm_hour = hour;
            local.tm_min = minute;
            local.tm_sec = second;
            local.tm_isdst = -1;
            return int64_t{std::mktime(&local)} * 1000;
        },
        [yyyymmdd](int64_t /*epochMs*/) { return yyyymmdd; },
    };
}

void declareAndBuild(const LibraryRoutesServer& server, Library& library) {
    const auto declared = declareThroughRows(server, summaryColumns());
    REQUIRE(declared);
    REQUIRE(declared->status == 202);

    library.replace(summarySnapshot());
    REQUIRE(library.state().ready);
}

SummaryRoles summaryRolesFor(const std::vector<RoleAsked>& roles) {
    const auto columns = summaryColumns();

    SummaryRoles indices;
    for (const auto& role : roles) {
        const auto field =
            std::find_if(roleColumns().begin(), roleColumns().end(),
                         [&role](const RoleColumn& c) { return c.name == role.name; });
        REQUIRE(field != roleColumns().end());
        const auto column = std::find(columns.begin(), columns.end(), role.expression);
        REQUIRE(column != columns.end());
        indices.*field->field =
            kSpineFieldCount + static_cast<size_t>(std::distance(columns.begin(), column));
    }
    return indices;
}

std::string summaryPath(const std::vector<RoleAsked>& roles) {
    std::string path = "/api/library/summary";
    for (size_t at = 0; at < roles.size(); ++at)
        path += (at == 0 ? "?" : "&") + roles[at].name + "=" + encoded(roles[at].expression);
    return path;
}

httplib::Result declareThroughRows(const LibraryRoutesServer& server,
                                   const std::vector<std::string>& columns) {
    const nlohmann::json body{{"columns", columns}, {"structure", "0"}, {"ordinals", {0}}};
    return server.client().Post("/api/library/rows", body.dump(), "application/json");
}

nlohmann::json expectedSummary(const Library& library, const std::vector<RoleAsked>& roles,
                               const int64_t nowMs, const uint32_t yyyymmdd) {
    const auto state = library.state();
    REQUIRE(state.trackCount == kAlbums * kTracksPerAlbum);

    Snapshot snapshot = summarySnapshot();
    snapshot.structure = state.structure;
    snapshot.revision = state.revision;
    return nlohmann::json::parse(
        summariseLibrary(snapshot, summaryRolesFor(roles), nowMs, localTimeOn(yyyymmdd)));
}

}  // namespace jean::testing
