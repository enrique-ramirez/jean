#include "fb2k/PCH.h"

#include "fb2k/playlist_properties.h"

#include "fb2k/playlists.h"

#include <algorithm>
#include <cstdint>
#include <string>

namespace jean {

namespace {

// {45837D74-FA4F-415C-BBA9-BF2DB8F0DC04}
constexpr GUID kJeanRecord = {
    0x45837d74, 0xfa4f, 0x415c, {0xbb, 0xa9, 0xbf, 0x2d, 0xb8, 0xf0, 0xdc, 0x04}};

// {651E1108-C122-49F5-94E1-89C184CAEDFA}
constexpr GUID kOwnPlaylist = {
    0x651e1108, 0xc122, 0x49f5, {0x94, 0xe1, 0x89, 0xc1, 0x84, 0xca, 0xed, 0xfa}};

std::string readProperty(size_t index, const GUID& property) {
    pfc::array_t<uint8_t> stored;
    if (!playlist_manager_v2::get()->playlist_get_property(index, property, stored))
        return std::string();

    if (stored.get_size() == 0)
        return std::string();

    return std::string(reinterpret_cast<const char*>(stored.get_ptr()), stored.get_size());
}

void writeProperty(size_t index, const GUID& property, const std::string& value) {
    stream_reader_memblock_ref stream{value.data(), value.size()};
    playlist_manager_v2::get()->playlist_set_property(index, property, &stream, value.size(),
                                                      fb2k::noAbort);
}

}  // namespace

std::optional<OwnPlaylistRole> roleOf(size_t index) {
    if (readProperty(index, kOwnPlaylist) == roleName(OwnPlaylistRole::scratch))
        return OwnPlaylistRole::scratch;

    return std::nullopt;
}

void markRole(size_t index, OwnPlaylistRole role) {
    writeProperty(index, kOwnPlaylist, roleName(role));
}

size_t findOwnPlaylist(OwnPlaylistRole role) {
    const auto indices = playlistIndices();
    const auto found = std::find_if(indices.begin(), indices.end(),
                                    [role](size_t index) { return roleOf(index) == role; });

    return found == indices.end() ? pfc::infinite_size : *found;
}

bool ours(size_t index) {
    return !readProperty(index, kJeanRecord).empty();
}

std::optional<AutoPlaylistSpec> storedAutoPlaylist(size_t index) {
    const auto stored = readProperty(index, kJeanRecord);
    if (stored.empty())
        return std::nullopt;

    return parseStoredAutoPlaylist(stored);
}

void recordAutoPlaylist(size_t index, const AutoPlaylistSpec& spec) {
    writeProperty(index, kJeanRecord, serialiseAutoPlaylist(spec));
}

}  // namespace jean
