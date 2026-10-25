#include "support/cover_library.h"

#include "core/library_roles.h"
#include "support/fixtures.h"
#include "support/summary_library.h"
#include "third_party/httplib.h"

#include <algorithm>
#include <map>

namespace jean::testing {

namespace {

struct CoverTrack {
    std::string directory;
    std::string filename;
    std::string album;
    std::string artist;
    std::string disc;
    std::string track;
};

std::vector<std::string> rowOf(const CoverTrack& track) {
    const std::map<std::string, std::string> values{
        {"%tracknumber%", track.track},
        {"%discnumber%", track.disc},
        {"%title%", track.filename},
        {"%artist%", track.artist},
        {"%album%", track.album},
        {"%album artist%", track.artist},
        {"%length_seconds%", "200"},
        {"%genre%", "Rock"},
        {"%codec%", "FLAC"},
        {"%bitrate%", "900"},
    };

    std::vector<std::string> row{track.directory, track.filename, "0"};
    for (const auto& column : coverColumns()) {
        const auto found = values.find(column);
        row.push_back(found == values.end() ? std::string(kUnresolved) : found->second);
    }
    return row;
}

std::vector<CoverTrack> coverTracks() {
    return {
        {"Band/Record/", "a.flac", "Record", "Band", "1", "2"},
        {"Band/Record/", "b.flac", "Record", "Band", "1", "1"},
        {"Band/Record/", "c.flac", "Record", "Band", "1", "3"},
        {"Band/Record (bonus)/", "d.flac", "Record", "Band", "2", "1"},
        {"Other Band/Second Record/", "01.flac", "Second Record", "Other Band", "1", "1"},
        {"Other Band/Second Record/", "02.flac", "Second Record", "Other Band", "1", "2"},
    };
}

Snapshot snapshotOfTracks(const std::vector<CoverTrack>& tracks) {
    std::vector<std::vector<std::string>> rows;
    std::transform(tracks.begin(), tracks.end(), std::back_inserter(rows), rowOf);
    return snapshotOf(coverColumns(), rows);
}

}  // namespace

const std::vector<RoleAsked>& coverRoles() {
    static const std::vector<RoleAsked> roles{
        {"trackNumber", "%tracknumber%"},
        {"discNumber", "%discnumber%"},
        {"title", "%title%"},
        {"artist", "%artist%"},
        {"album", "%album%"},
        {"albumArtist", "%album artist%"},
        {"duration", "%length_seconds%"},
        {"playCount", "%lastfm_play_count%"},
        {"lastPlayed", "%lastfm_last_played%"},
        {"rating", "%rating%"},
        {"year", "%date%"},
        {"genre", "%genre%"},
        {"codec", "%codec%"},
        {"bitrate", "%bitrate%"},
        {"playCountLocal", "%play_count%"},
        {"lastPlayedLocal", "%last_played%"},
        {"added", "%added%"},
        {"artists", "$meta_sep(artist,|)"},
        {"artistIds", "$meta_sep(musicbrainz_artistid,|)"},
        {"albumArtists", "$meta_sep(album artist,|)"},
        {"albumArtistIds", "$meta_sep(musicbrainz_albumartistid,|)"},
        {"artistSort", "%artist sort order%"},
    };
    return roles;
}

std::vector<RoleAsked> coverRolesWith(const RoleAsked& replacement) {
    auto roles = coverRoles();
    for (auto& role : roles) {
        if (role.name == replacement.name)
            role = replacement;
    }
    return roles;
}

std::vector<RoleAsked> coverRolesBut(const std::string& leftOut) {
    std::vector<RoleAsked> roles;
    std::copy_if(coverRoles().begin(), coverRoles().end(), std::back_inserter(roles),
                 [&leftOut](const RoleAsked& role) { return role.name != leftOut; });
    return roles;
}

std::vector<std::string> coverColumns() {
    std::vector<std::string> columns;
    std::transform(coverRoles().begin(), coverRoles().end(), std::back_inserter(columns),
                   [](const RoleAsked& role) { return role.expression; });
    return columns;
}

Snapshot coverSnapshot() {
    return snapshotOfTracks(coverTracks());
}

Snapshot coverSnapshotBehind(size_t count) {
    std::vector<CoverTrack> tracks;
    for (size_t at = 0; at < count; ++at) {
        tracks.push_back({"Abba/Arrival/", std::to_string(at) + ".flac", "Arrival", "Abba", "1",
                          std::to_string(at + 1)});
    }
    const auto held = coverTracks();
    tracks.insert(tracks.end(), held.begin(), held.end());
    return snapshotOfTracks(tracks);
}

std::string withRoles(const std::string& path, const std::vector<RoleAsked>& roles) {
    std::string asked = path;
    char separator = path.find('?') == std::string::npos ? '?' : '&';
    for (const auto& role : roles) {
        asked += separator + role.name + "=" + httplib::encode_query_component(role.expression);
        separator = '&';
    }
    return asked;
}

std::string withCoverRoles(const std::string& path) {
    return withRoles(path, coverRoles());
}

}  // namespace jean::testing
