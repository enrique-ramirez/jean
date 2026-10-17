
#include "third_party/doctest.h"

#include "core/library.h"
#include "core/library_summary.h"
#include "support/fixtures.h"
#include "support/summary_cases.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cstdint>
#include <optional>
#include <ranges>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;
using nlohmann::ordered_json;

namespace {

constexpr int64_t kMsPerDay = 86'400'000;
constexpr int64_t kMsPerMinute = 60'000;
constexpr int64_t kMsPerHour = 3'600'000;

// The cases file was generated in Asia/Kolkata, UTC+05:30 all year with no daylight saving.
constexpr int64_t kKolkataOffsetMs = (5 * kMsPerHour) + (30 * kMsPerMinute);

int64_t daysFromCivil(int year, const int month, const int day) {
    year -= month <= 2 ? 1 : 0;
    const int64_t era = (year >= 0 ? year : year - 399) / 400;
    const int64_t yearOfEra = year - (era * 400);
    const int64_t dayOfYear = (((153 * (month > 2 ? month - 3 : month + 9)) + 2) / 5) + day - 1;
    const int64_t dayOfEra = (yearOfEra * 365) + (yearOfEra / 4) - (yearOfEra / 100) + dayOfYear;
    return (era * 146097) + dayOfEra - 719468;
}

uint32_t yyyymmddFromDays(int64_t days) {
    days += 719468;
    const int64_t era = (days >= 0 ? days : days - 146096) / 146097;
    const int64_t dayOfEra = days - (era * 146097);
    const int64_t yearOfEra =
        (dayOfEra - (dayOfEra / 1460) + (dayOfEra / 36524) - (dayOfEra / 146096)) / 365;
    const int64_t dayOfYear = dayOfEra - ((365 * yearOfEra) + (yearOfEra / 4) - (yearOfEra / 100));
    const int64_t shiftedMonth = ((5 * dayOfYear) + 2) / 153;
    const int64_t day = dayOfYear - (((153 * shiftedMonth) + 2) / 5) + 1;
    const int64_t month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
    const int64_t year = yearOfEra + (era * 400) + (month <= 2 ? 1 : 0);
    return static_cast<uint32_t>((year * 10000) + (month * 100) + day);
}

int64_t floorDivide(const int64_t value, const int64_t divisor) {
    return (value >= 0 ? value : value - divisor + 1) / divisor;
}

LocalTime kolkataTime() {
    return LocalTime{
        [](const int year, const int month, const int day, const int hour, const int minute,
           const int second) {
            const int64_t seconds = (((int64_t{hour} * 60) + minute) * 60) + second;
            return (daysFromCivil(year, month, day) * kMsPerDay) + (seconds * 1000) -
                   kKolkataOffsetMs;
        },
        [](const int64_t epochMs) {
            return yyyymmddFromDays(floorDivide(epochMs + kKolkataOffsetMs, kMsPerDay));
        },
    };
}

using RoleField = std::optional<size_t> SummaryRoles::*;

const std::vector<std::pair<std::string, RoleField>>& roleFields() {
    static const std::vector<std::pair<std::string, RoleField>> fields{
        {"trackNumber", &SummaryRoles::trackNumber},
        {"discNumber", &SummaryRoles::discNumber},
        {"title", &SummaryRoles::title},
        {"artist", &SummaryRoles::artist},
        {"album", &SummaryRoles::album},
        {"albumArtist", &SummaryRoles::albumArtist},
        {"duration", &SummaryRoles::duration},
        {"playCount", &SummaryRoles::playCount},
        {"lastPlayed", &SummaryRoles::lastPlayed},
        {"rating", &SummaryRoles::rating},
        {"year", &SummaryRoles::year},
        {"genre", &SummaryRoles::genre},
        {"codec", &SummaryRoles::codec},
        {"bitrate", &SummaryRoles::bitrate},
        {"playCountLocal", &SummaryRoles::playCountLocal},
        {"lastPlayedLocal", &SummaryRoles::lastPlayedLocal},
        {"added", &SummaryRoles::added},
    };
    return fields;
}

struct SummaryInput {
    Snapshot snapshot;
    SummaryRoles roles;
};

SummaryInput inputOf(const json& summaryCase) {
    const json& columns = summaryCase.at("columns");

    SummaryInput input;
    std::vector<std::string> names;
    std::vector<const json*> values;
    for (const auto& [role, field] : std::views::reverse(roleFields())) {
        if (!columns.contains(role))
            continue;
        input.roles.*field = kSpineFieldCount + names.size();
        names.push_back("%" + role + "%");
        values.push_back(&columns.at(role));
    }

    const json& directory = summaryCase.at("directory");
    std::vector<std::vector<std::string>> rows;
    rows.reserve(directory.size());
    for (size_t ordinal = 0; ordinal < directory.size(); ++ordinal) {
        std::vector<std::string> row{directory.at(ordinal).get<std::string>(),
                                     summaryCase.at("filename").at(ordinal).get<std::string>(),
                                     summaryCase.at("subsong").at(ordinal).get<std::string>()};
        for (const json* column : values)
            row.push_back(column->at(ordinal).get<std::string>());
        rows.push_back(std::move(row));
    }

    input.snapshot = snapshotOf(names, rows);
    input.snapshot.structure = summaryCase.at("structure").get<uint64_t>();
    input.snapshot.revision = summaryCase.at("revision").get<uint64_t>();
    input.snapshot.snapshotId = summaryCase.at("snapshotId").get<uint64_t>();
    return input;
}

std::string summaryText(const SummaryInput& input, const int64_t nowMs) {
    return summariseLibrary(input.snapshot, input.roles, nowMs, kolkataTime());
}

json summaryOf(const SummaryInput& input, const int64_t nowMs) {
    return json::parse(summaryText(input, nowMs));
}

const json& namedCase(const std::string& name) {
    const json& cases = librarySummaryCases().at("cases");
    const auto found = std::find_if(cases.begin(), cases.end(), [&name](const json& summaryCase) {
        return summaryCase.at("name") == name;
    });
    REQUIRE_MESSAGE(found != cases.end(), "the cases file holds no case named ", name);
    return *found;
}

json shelfNamed(const json& document, const std::string& id) {
    for (const json& shelf : document.at("shelves")) {
        if (shelf.at("id") == id)
            return shelf;
    }
    return nullptr;
}

std::vector<std::string> keysOf(const ordered_json& object) {
    std::vector<std::string> keys;
    for (const auto& entry : object.items())
        keys.push_back(entry.key());
    return keys;
}

}  // namespace

TEST_CASE("every case in the cases file computes its expected document, number for number") {
    for (const json& summaryCase : librarySummaryCases().at("cases")) {
        const std::string name = summaryCase.at("name").get<std::string>();
        SUBCASE(name.c_str()) {
            // doctest abandons every subcase after one that throws, so a throw fails its own
            // case and the rest still run.
            json computed;
            try {
                computed = summaryOf(inputOf(summaryCase), summaryCase.at("now").get<int64_t>());
            } catch (const std::exception& error) {
                FAIL_CHECK("threw: ", std::string(error.what()));
                continue;
            }
            const json& expected = summaryCase.at("expected");

            for (const auto& [key, value] : expected.items()) {
                INFO("key: ", key);
                INFO("expected: ", value.dump(2));
                INFO("computed: ", computed.contains(key) ? computed.at(key).dump(2) : "(missing)");
                CHECK((computed.contains(key) && computed.at(key) == value));
            }

            INFO("computed keys: ", ordered_json(keysOf(computed)).dump());
            CHECK(computed.size() == expected.size());
        }
    }
}

TEST_CASE("the document, each album and each top track carry their keys in the contract's order") {
    const json& summaryCase = namedCase("both-plays");
    const ordered_json document = ordered_json::parse(
        summaryText(inputOf(summaryCase), summaryCase.at("now").get<int64_t>()));

    CHECK(keysOf(document) ==
          std::vector<std::string>{"structure", "revision", "trackCount", "seconds", "earliestYear",
                                   "latestYear", "albumCount", "artistCount", "genreCount",
                                   "topGenres", "topAlbum", "topArtist", "topTracks", "shelves"});

    const std::vector<std::string> albumKeys{"album",      "artist",     "cover",      "ordinals",
                                             "trackCount", "plays",      "lastPlayed", "added",
                                             "rating",     "ratedCount", "bitrate"};
    std::vector<ordered_json> albums{document.at("topAlbum"), document.at("topArtist").at("cover")};
    for (const ordered_json& shelf : document.at("shelves")) {
        for (const ordered_json& album : shelf.at("albums"))
            albums.push_back(album);
    }
    REQUIRE(albums.size() > 2);
    for (const ordered_json& album : albums) {
        INFO(album.dump());
        CHECK(keysOf(album) == albumKeys);
    }

    const std::vector<std::string> trackKeys{"ordinal", "title", "artist", "plays", "cover"};
    REQUIRE(!document.at("topTracks").empty());
    for (const ordered_json& track : document.at("topTracks")) {
        INFO(track.dump());
        CHECK(keysOf(track) == trackKeys);
    }
}

TEST_CASE("the starter shelf keeps one order through a local date and may take another the next") {
    const json& starter = namedCase("starter");
    const int64_t now = starter.at("now").get<int64_t>();
    SummaryInput input = inputOf(starter);

    const json noon = shelfNamed(summaryOf(input, now), "starter");
    REQUIRE(noon.is_object());

    const json tomorrow = shelfNamed(summaryOf(input, now + (24 * kMsPerHour)), "starter");
    REQUIRE(tomorrow.is_object());
    CHECK(tomorrow != noon);

    input.snapshot.revision += 1;
    input.snapshot.snapshotId += 1;
    const int64_t beforeMidnight = now + (11 * kMsPerHour) + (59 * kMsPerMinute);
    CHECK(shelfNamed(summaryOf(input, beforeMidnight), "starter") == noon);
}

TEST_CASE("the starter shelf's date is the player machine's local date, not UTC's") {
    const json& midnight = namedCase("starter-local-midnight");
    const int64_t now = midnight.at("now").get<int64_t>();
    const SummaryInput input = inputOf(midnight);

    const json justAfter = summaryOf(input, now);
    CHECK(justAfter == midnight.at("expected"));

    const json hourEarlier = shelfNamed(summaryOf(input, now - kMsPerHour), "starter");
    REQUIRE(hourEarlier.is_object());
    CHECK(hourEarlier != shelfNamed(justAfter, "starter"));
}

TEST_CASE("a timestamp tag outside YYYY-MM-DD HH:MM:SS and trailing spaces is no timestamp") {
    json summaryCase = namedCase("starter-small");
    const std::vector<std::pair<std::string, std::string>> addedByAlbum{
        {"Sleeper 01", "2026-01-05T10:00:00"},
        {"Sleeper 02", "2026-01-05"},
        {"Sleeper 03", "2026-01-05 10:00:00   "},
        {"Sleeper 04", "yesterday"},
        {"Sleeper 05", "?"},
        {"Sleeper 06", " 2026-01-05 10:00:00"},
    };
    json added = json::array();
    for (const json& album : summaryCase.at("columns").at("album")) {
        for (const auto& [name, value] : addedByAlbum) {
            if (album == name)
                added.push_back(value);
        }
    }
    REQUIRE(added.size() == summaryCase.at("directory").size());
    summaryCase["columns"]["added"] = added;

    const json document = summaryOf(inputOf(summaryCase), summaryCase.at("now").get<int64_t>());

    constexpr int64_t kPaddedTimestamp = 1'767'587'400'000;
    for (const auto& [name, value] : addedByAlbum) {
        CAPTURE(name);
        CAPTURE(value);
        std::optional<int64_t> albumAdded;
        for (const json& shelf : document.at("shelves")) {
            for (const json& album : shelf.at("albums")) {
                if (album.at("album") == name)
                    albumAdded = album.at("added").get<int64_t>();
            }
        }
        REQUIRE(albumAdded.has_value());
        CHECK(*albumAdded == (name == "Sleeper 03" ? kPaddedTimestamp : 0));
    }
}
