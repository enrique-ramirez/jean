#include "core/tag_write.h"

#include "core/json.h"
#include "core/text.h"

#include <algorithm>
#include <cctype>
#include <iterator>
#include <limits>
#include <optional>
#include <vector>

using nlohmann::json;

namespace jean {

namespace {

constexpr size_t kMaxPath = 4096;

TagWriteRequest refuse(TagWriteRefusal refusal, std::string detail = {}) {
    TagWriteRequest request;
    request.refusal = refusal;
    request.detail = std::move(detail);
    return request;
}

bool hasParentEscape(const std::string& path) {
    auto normalised = path;
    std::replace(normalised.begin(), normalised.end(), '\\', '/');
    return ("/" + normalised + "/").find("/../") != std::string::npos;
}

bool isSeparator(char c) {
    return c == '\\' || c == '/';
}

bool isAbsolute(const std::string& path) {
    // A drive letter or a leading slash. Anything else is relative to a working directory
    // this component does not have.
    const bool driveLetter = path.size() >= 3 &&
                             std::isalpha(static_cast<unsigned char>(path[0])) != 0 &&
                             path[1] == ':' && (path[2] == '\\' || path[2] == '/');

    // Not redundant with the caller's check: this is the one predicate here that would read
    // off the end of the string.
    return driveLetter || (!path.empty() && path.front() == '/');
}

std::optional<std::string> readFieldValue(const json& value) {
    if (value.is_string())
        return value.get<std::string>();
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

bool isSafeTrackPath(const std::string& path) {
    if (path.empty() || path.size() > kMaxPath)
        return false;

    if (!isPrintable(path))
        return false;

    // No scheme of any kind: telling "file://" apart from "http://" and foobar2000's own
    // "unpack://" is the kind of parsing that goes wrong quietly.
    if (path.find("://") != std::string::npos)
        return false;

    // UNC. Never reach a network share on the caller's say-so. Windows takes either
    // separator, so //nas/share and \\nas\share are one path and both spellings are refused.
    if (path.size() >= 2 && isSeparator(path[0]) && isSeparator(path[1]))
        return false;

    return isAbsolute(path) && !hasParentEscape(path);
}

TagWriteRequest parseTagWrite(const std::string& body, const Settings& settings) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuse(TagWriteRefusal::malformedBody, document.error);

    const auto& root = document.value;

    const auto path = readString(root, "path");
    if (!path.present || path.wrongType || path.value.empty())
        return refuse(TagWriteRefusal::missingPath, "'path' is required and must be a string");

    TagWriteRequest request;
    request.write.track.path = path.value;

    if (!isSafeTrackPath(path.value))
        return refuse(TagWriteRefusal::unsafePath, "'path' must be a plain absolute local path");

    if (const auto subsong = root.find("subsong"); subsong != root.end()) {
        if (!subsong->is_number_unsigned() ||
            subsong->get<uint64_t>() > std::numeric_limits<uint32_t>::max())
            return refuse(TagWriteRefusal::malformedBody,
                          "'subsong' must be a non-negative number");
        request.write.track.subsong = subsong->get<uint32_t>();
    }

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

std::string describe(TagWriteRefusal refusal) {
    switch (refusal) {
        case TagWriteRefusal::none:
            return "ok";
        case TagWriteRefusal::malformedBody:
            return "malformed request";
        case TagWriteRefusal::missingPath:
            return "missing path";
        case TagWriteRefusal::unsafePath:
            return "unacceptable path";
        case TagWriteRefusal::noFields:
            return "no fields to write";
        case TagWriteRefusal::fieldNotAllowed:
            return "field not allowed";
    }
    return "unknown";
}

std::string describe(TagWriteOutcome outcome) {
    switch (outcome) {
        case TagWriteOutcome::written:
            return "written";
        case TagWriteOutcome::trackNotKnown:
            return "foobar2000 does not know that track";
        case TagWriteOutcome::writeFailed:
            return "the player could not write the tags";
        case TagWriteOutcome::timedOut:
            return "the player did not answer in time";
        case TagWriteOutcome::unavailable:
            return "tag writing is not available";
    }
    return "unknown";
}

}  // namespace jean
