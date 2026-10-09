#include "core/tag_write.h"

#include "core/artwork.h"
#include "core/json.h"
#include "core/playlists.h"
#include "core/text.h"

#include <algorithm>
#include <array>
#include <iterator>
#include <limits>
#include <optional>
#include <vector>

using nlohmann::json;

namespace jean {

namespace {

// Exactly the fields contract/openapi.yaml declares for this body, `additionalProperties:
// false` there.
constexpr std::array<const char*, 7> kTagWriteFields{"track", "subsong",   "ordinal", "playlist",
                                                     "index", "structure", "fields"};

// What each form is recognised by, which is everything it takes but `structure`: the ordinal
// form and the playlist form both carry one, so it says nothing about which was sent.
constexpr std::array<const char*, 2> kLibraryAddressFields{"track", "subsong"};
constexpr std::array<const char*, 1> kOrdinalAddressFields{"ordinal"};
constexpr std::array<const char*, 2> kPlaylistAddressFields{"playlist", "index"};

TagWriteRequest refuse(TagWriteRefusal refusal, std::string detail = {}) {
    TagWriteRequest request;
    request.refusal = refusal;
    request.detail = std::move(detail);
    return request;
}

template <typename Fields>
std::string undeclaredField(const json& root, const Fields& fields) {
    const auto entries = root.items();
    const auto stray = std::find_if(entries.begin(), entries.end(), [&fields](const auto& entry) {
        return std::none_of(std::begin(fields), std::end(fields),
                            [&entry](const char* field) { return entry.key() == field; });
    });

    return stray == entries.end() ? std::string() : (*stray).key();
}

template <typename Fields>
bool namesAny(const json& root, const Fields& fields) {
    return std::any_of(std::begin(fields), std::end(fields),
                       [&root](const char* field) { return root.contains(field); });
}

struct AddressField {
    TrackRef ref;

    TagWriteRefusal refusal = TagWriteRefusal::none;
    std::string why;

    bool ok() const { return refusal == TagWriteRefusal::none; }
};

AddressField unreadable(std::string why, TagWriteRefusal refusal = TagWriteRefusal::badAddress) {
    return AddressField{TrackRef{}, refusal, std::move(why)};
}

AddressField readLibraryAddress(const json& root) {
    const auto track = readString(root, "track");
    if (!track.present || track.wrongType)
        return unreadable("'track' is required and must be a string");

    if (const auto why = trackAddressRefusal(track.value); !why.empty())
        return unreadable(why);

    LibraryTrackRef library;
    library.track = track.value;

    if (const auto subsong = root.find("subsong"); subsong != root.end()) {
        if (!subsong->is_number_unsigned() ||
            subsong->get<uint64_t>() > std::numeric_limits<uint32_t>::max()) {
            return unreadable("'subsong' must be a non-negative number",
                              TagWriteRefusal::malformedBody);
        }
        library.subsong = subsong->get<uint32_t>();
    }

    AddressField address;
    address.ref.library = library;
    return address;
}

AddressField readOrdinalAddress(const json& root) {
    OrdinalTrackRef ref;

    const auto ordinal = root.find("ordinal");
    if (ordinal == root.end() || !ordinal->is_number_unsigned() ||
        ordinal->get<uint64_t>() > std::numeric_limits<uint32_t>::max())
        return unreadable(kBadOrdinal);
    ref.ordinal = ordinal->get<uint32_t>();

    // A number where the playlist form's generation is a string: the media library's own
    // counter fits a JSON number exactly and a playlist's nineteen-digit one does not.
    const auto structure = root.find("structure");
    if (structure == root.end() || !structure->is_number_unsigned())
        return unreadable(kBadOrdinalStructure);
    ref.structure = structure->get<uint64_t>();

    AddressField address;
    address.ref.ordinal = ref;
    return address;
}

AddressField readPlaylistAddress(const json& root) {
    const auto playlist = readString(root, "playlist");
    if (!playlist.present || playlist.wrongType || !isPlaylistId(playlist.value))
        return unreadable("'playlist' is required and must be a playlist id");

    PlaylistTrackRef row;
    row.playlistId = playlist.value;

    const auto index = root.find("index");
    if (index == root.end() || !index->is_number_unsigned() ||
        index->get<uint64_t>() > std::numeric_limits<uint32_t>::max())
        return unreadable("'index' is required and must be a non-negative number");
    row.index = index->get<uint32_t>();

    const auto structure = readString(root, "structure");
    if (!structure.present || structure.wrongType || !readDecimal(structure.value, row.structure))
        return unreadable("'structure' is required and must be a string of digits");

    AddressField address;
    address.ref.playlist = row;
    return address;
}

AddressField readAddress(const json& root) {
    const bool library = namesAny(root, kLibraryAddressFields);
    const bool ordinal = namesAny(root, kOrdinalAddressFields);
    const bool playlist = namesAny(root, kPlaylistAddressFields);

    const int forms = (library ? 1 : 0) + (ordinal ? 1 : 0) + (playlist ? 1 : 0);
    if (forms > 1)
        return unreadable("a request names one of 'track', 'ordinal' and 'playlist', never two");

    if (library)
        return readLibraryAddress(root);
    if (ordinal)
        return readOrdinalAddress(root);
    if (playlist)
        return readPlaylistAddress(root);

    return unreadable("'track', 'ordinal' or 'playlist' is required");
}

std::optional<std::string> readFieldValue(const json& value) {
    if (value.is_string())
        return value.get<std::string>();
    if (value.is_number_unsigned())
        return std::to_string(value.get<unsigned long long>());
    if (value.is_number_integer())
        return std::to_string(value.get<long long>());
    return std::nullopt;
}

bool allowed(const std::string& field, const std::vector<std::string>& allowlist) {
    return std::any_of(allowlist.begin(), allowlist.end(), [&field](const std::string& permitted) {
        return equalsIgnoringCase(field, permitted);
    });
}

// foobar2000 tag names are case-insensitive, so {"rating": "4", "RATING": "5"} is two
// instructions for one tag and has no right answer. Sorted after lowering rather than
// compared pairwise in original order: the map is already ordered by byte value, so in
// {"album", "RATING", "rating"} the two spellings are not neighbours until they are both
// folded to the same case.
std::string fieldNamedTwice(const std::map<std::string, std::string>& fields) {
    std::vector<std::string> lowered;
    std::transform(fields.begin(), fields.end(), std::back_inserter(lowered),
                   [](const auto& field) { return toLower(field.first); });
    std::sort(lowered.begin(), lowered.end());

    const auto collision = std::adjacent_find(lowered.begin(), lowered.end());
    return collision == lowered.end() ? std::string() : *collision;
}

}  // namespace

TagWriteRequest parseTagWrite(const std::string& body, const Settings& settings) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuse(TagWriteRefusal::malformedBody, document.error);

    const auto& root = document.value;

    if (const auto stray = undeclaredField(root, kTagWriteFields); !stray.empty()) {
        return refuse(TagWriteRefusal::malformedBody,
                      "'" + stray + "' is not a field this route takes");
    }

    const auto address = readAddress(root);
    if (!address.ok())
        return refuse(address.refusal, address.why);

    TagWriteRequest request;
    request.write.track = address.ref;

    const auto fields = root.find("fields");
    if (fields == root.end() || !fields->is_object() || fields->empty()) {
        return refuse(TagWriteRefusal::noFields,
                      "'fields' is required and must be a non-empty object");
    }

    // Bound to a local because items() returns a proxy; see settings.cpp.
    const auto entries = fields->items();

    const auto forbidden = std::find_if(entries.begin(), entries.end(), [&settings](const auto& e) {
        return !allowed(e.key(), settings.allowedFields);
    });
    if (forbidden != entries.end())
        return refuse(TagWriteRefusal::fieldNotAllowed, (*forbidden).key());

    const auto unreadable = std::find_if(entries.begin(), entries.end(), [](const auto& e) {
        return !readFieldValue(e.value()).has_value();
    });
    if (unreadable != entries.end()) {
        return refuse(TagWriteRefusal::malformedBody,
                      "'" + (*unreadable).key() + "' must be a string or a whole number");
    }

    std::for_each(entries.begin(), entries.end(), [&request](const auto& e) {
        request.write.fields.emplace(e.key(), *readFieldValue(e.value()));
    });

    if (const auto twice = fieldNamedTwice(request.write.fields); !twice.empty()) {
        return refuse(TagWriteRefusal::malformedBody,
                      "'" + twice + "' is named twice, differing only in case");
    }

    return request;
}

}  // namespace jean
