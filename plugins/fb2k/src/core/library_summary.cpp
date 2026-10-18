#include "core/library_summary.h"

#include "core/library_groups.h"
#include "core/text.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <locale>
#include <numeric>
#include <sstream>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace jean {

namespace {

using Json = nlohmann::ordered_json;

constexpr size_t kShelfLimit = 24;
constexpr size_t kMinimumPicks = 4;
constexpr size_t kAddedMinimumPicks = 1;
constexpr size_t kCandidateFloor = 8;
constexpr size_t kTopTracks = 10;
constexpr size_t kGenreBars = 14;
constexpr size_t kLeastTracksToLoveOrUpgrade = 4;
constexpr size_t kLeastRatingsToCount = 2;

constexpr double kDayMs = 24.0 * 60 * 60 * 1000;
constexpr double kYearMs = 365.25 * kDayMs;
constexpr double kRecentWindowMs = 30 * kDayMs;
constexpr double kAddedWindowMs = 28 * kDayMs;
constexpr double kForgottenAfterMs = 1.5 * kYearMs;
constexpr double kFirstRunGapMs = 60 * 1000;
constexpr double kFirstRunShare = 0.25;
constexpr double kMedian = 0.5;
constexpr double kUpperQuartile = 0.75;
constexpr double kLowerQuartile = 0.25;

constexpr int kFirstRealYear = 1000;
constexpr uint64_t kSplitMixStep = 0x9e3779b97f4a7c15ULL;

double roundHalfUp(double value) {
    return std::floor(value + 0.5);
}

Json numberJson(double value) {
    constexpr double kLastExactInteger = 9007199254740992.0;
    if (std::isfinite(value) && value == std::floor(value) && std::fabs(value) < kLastExactInteger)
        return static_cast<int64_t>(value);
    return value;
}

Json optionalNumberJson(const std::optional<double>& value) {
    return value ? numberJson(*value) : Json(nullptr);
}

constexpr int kExactDigits = 15;
constexpr int kExactPower = 22;

double powerOfTen(int exponent) {
    static const std::array<double, kExactPower + 1> kPowers = [] {
        std::array<double, kExactPower + 1> powers{};
        powers[0] = 1;
        for (size_t at = 1; at < powers.size(); ++at)
            powers[at] = powers[at - 1] * 10;
        return powers;
    }();
    return kPowers[static_cast<size_t>(exponent)];
}

std::optional<double> parseExactly(std::string_view raw) {
    constexpr int kLongestExponent = 4;

    size_t at = 0;
    const bool negative = raw[at] == '-';
    if (raw[at] == '+' || raw[at] == '-')
        ++at;

    uint64_t mantissa = 0;
    int significant = 0;
    int fraction = 0;
    bool afterPoint = false;
    for (; at < raw.size() && raw[at] != 'e' && raw[at] != 'E'; ++at) {
        if (raw[at] == '.') {
            afterPoint = true;
            continue;
        }
        if (mantissa != 0 || raw[at] != '0')
            ++significant;
        if (significant > kExactDigits)
            return std::nullopt;
        mantissa = (mantissa * 10) + static_cast<uint64_t>(raw[at] - '0');
        fraction += afterPoint ? 1 : 0;
    }

    int exponent = 0;
    if (at < raw.size()) {
        ++at;
        const bool below = raw[at] == '-';
        if (raw[at] == '+' || raw[at] == '-')
            ++at;
        if (raw.size() - at > kLongestExponent)
            return std::nullopt;
        for (; at < raw.size(); ++at)
            exponent = (exponent * 10) + (raw[at] - '0');
        exponent = below ? -exponent : exponent;
    }

    const int power = exponent - fraction;
    if (power > kExactPower || power < -kExactPower)
        return std::nullopt;

    const double magnitude = power >= 0 ? static_cast<double>(mantissa) * powerOfTen(power)
                                        : static_cast<double>(mantissa) / powerOfTen(-power);
    return negative ? -magnitude : magnitude;
}

// Apple's libc++ marks floating from_chars unavailable at this component's deployment target,
// so what the exact path leaves is read through a stream pinned to the C locale, which strtod is
// not. The stream fails on a magnitude it cannot hold: a negative exponent underflows to 0, as
// Number does, and a positive one is no finite number.
std::optional<double> parseDecimal(std::string_view raw) {
    if (const auto exact = parseExactly(raw))
        return exact;

    std::istringstream stream{std::string(raw)};
    stream.imbue(std::locale::classic());
    double parsed = 0;
    stream >> parsed;
    if (stream.fail()) {
        const size_t exponent = raw.find_first_of("eE");
        return exponent != std::string_view::npos && raw[exponent + 1] == '-'
                   ? std::optional<double>(0.0)
                   : std::nullopt;
    }
    return std::isfinite(parsed) ? std::optional<double>(parsed) : std::nullopt;
}

// Number() of the text, kept to the finite results. A text of only spaces is 0, as Number does.
std::optional<double> readNumber(std::string_view raw) {
    if (!isPresent(raw))
        return std::nullopt;

    while (!raw.empty() && isAsciiSpace(raw.front()))
        raw.remove_prefix(1);
    while (!raw.empty() && isAsciiSpace(raw.back()))
        raw.remove_suffix(1);
    if (raw.empty())
        return 0.0;

    size_t at = 0;
    const auto digits = [&] {
        const size_t from = at;
        while (at < raw.size() && isDigit(raw[at]))
            ++at;
        return at - from;
    };

    if (raw[at] == '+' || raw[at] == '-')
        ++at;
    const size_t whole = digits();
    size_t fraction = 0;
    if (at < raw.size() && raw[at] == '.') {
        ++at;
        fraction = digits();
    }
    if (whole + fraction == 0)
        return std::nullopt;
    if (at < raw.size() && (raw[at] == 'e' || raw[at] == 'E')) {
        ++at;
        if (at < raw.size() && (raw[at] == '+' || raw[at] == '-'))
            ++at;
        if (digits() == 0)
            return std::nullopt;
    }
    if (at != raw.size())
        return std::nullopt;

    return parseDecimal(raw);
}

bool isLeapYear(int year) {
    return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
}

int daysInMonth(int year, int month) {
    constexpr std::array<int, 12> kDays{31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    return month == 2 && isLeapYear(year) ? 29 : kDays[static_cast<size_t>(month - 1)];
}

// foo_playcount writes `YYYY-MM-DD HH:MM:SS` in the player machine's local time.
std::optional<double> readTimestamp(std::string_view raw, const LocalTime& local) {
    constexpr std::string_view kShape = "dddd-dd-dd dd:dd:dd";
    if (!isPresent(raw) || raw.size() < kShape.size())
        return std::nullopt;

    for (size_t at = 0; at < kShape.size(); ++at) {
        if (kShape[at] == 'd' ? !isDigit(raw[at]) : raw[at] != kShape[at])
            return std::nullopt;
    }
    if (!std::all_of(raw.begin() + kShape.size(), raw.end(), [](char c) { return c == ' '; }))
        return std::nullopt;

    const auto field = [&](size_t from, size_t length) {
        int value = 0;
        for (size_t at = from; at < from + length; ++at)
            value = (value * 10) + (raw[at] - '0');
        return value;
    };
    const int year = field(0, 4);
    const int month = field(5, 2);
    const int day = field(8, 2);
    const int hour = field(11, 2);
    const int minute = field(14, 2);
    const int second = field(17, 2);
    constexpr int kHoursPerDay = 24;
    constexpr int kSixty = 60;
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) ||
        hour >= kHoursPerDay || minute >= kSixty || second >= kSixty)
        return std::nullopt;

    return static_cast<double>(local.epochMs(year, month, day, hour, minute, second));
}

bool isLossy(std::string_view codec) {
    if (!isPresent(codec))
        return false;
    static const std::array<std::string_view, 6> kLossless{"flac", "alac",    "wav",
                                                           "ape",  "wavpack", "tak"};
    const std::string lower = toLower(std::string(codec));
    return std::find(kLossless.begin(), kLossless.end(), lower) == kLossless.end();
}

std::optional<double> either(std::optional<double> a, std::optional<double> b,
                             double (*pick)(double, double)) {
    if (!a)
        return b;
    if (!b)
        return a;
    return pick(*a, *b);
}

double higher(double a, double b) {
    return std::max(a, b);
}

// `0` as written by foobar2000 for a track never played is no answer, from either component.
std::optional<double> unplayedAsNone(std::optional<double> answer, std::string_view raw) {
    return raw == "0" ? std::nullopt : answer;
}

struct Album : AlbumRecord {
    double plays = 0;
    double lastPlayed = 0;
    double added = 0;
    double bitrateTotal = 0;
    size_t bitrateCount = 0;
    double ratingTotal = 0;
    size_t ratedCount = 0;
    bool lossless = true;

    size_t trackCount() const { return ordinals.size(); }
    double playsPerTrack() const {
        return ordinals.empty() ? 0 : plays / static_cast<double>(ordinals.size());
    }
    std::optional<double> bitrate() const {
        return bitrateCount > 0 ? std::optional(bitrateTotal / static_cast<double>(bitrateCount))
                                : std::nullopt;
    }
    std::optional<double> rating() const {
        return ratedCount > 0 ? std::optional(ratingTotal / static_cast<double>(ratedCount))
                              : std::nullopt;
    }
};

// 0 and -1 are two spellings of unrated.
std::optional<double> starsOf(std::optional<double> raw) {
    constexpr double kMaxStars = 5;
    constexpr double kTenPointScale = 10;
    constexpr double kPercentScale = 100;
    constexpr double kByte = 255;
    constexpr std::array<double, 5> kPopmFloors{224, 160, 96, 32, 1};

    if (!raw || *raw <= 0)
        return std::nullopt;
    if (*raw <= kMaxStars)
        return raw;
    if (*raw <= kTenPointScale)
        return *raw / 2;
    if (*raw <= kPercentScale)
        return (*raw / kPercentScale) * kMaxStars;
    if (*raw <= kByte) {
        const auto floors =
            static_cast<double>(std::find_if(kPopmFloors.begin(), kPopmFloors.end(),
                                             [&](double least) { return *raw >= least; }) -
                                kPopmFloors.begin());
        return kMaxStars - floors;
    }
    return std::nullopt;
}

struct Facts {
    const Snapshot& snapshot;
    size_t rows = 0;
    PerValue<std::optional<double>> playsScrobbled, playsLocal, playedScrobbled, playedLocal;
    PerValue<std::optional<double>> added, year, bitrate, rating, duration;
    PerValue<uint8_t> lossy;
    Credits credits;

    std::optional<double> playsOf(size_t row) const {
        return either(playsScrobbled.of(row), playsLocal.of(row), higher);
    }
    std::optional<double> lastPlayedOf(size_t row) const {
        return either(playedScrobbled.of(row), playedLocal.of(row), higher);
    }
};

PerValue<std::optional<double>> counts(const Snapshot& snapshot, std::optional<size_t> role) {
    return resolve<std::optional<double>>(snapshot, role, [](const std::string& value) {
        return unplayedAsNone(readNumber(value), value);
    });
}

PerValue<std::optional<double>> moments(const Snapshot& snapshot, std::optional<size_t> role,
                                        const LocalTime& local, bool unplayedIsNone) {
    return resolve<std::optional<double>>(snapshot, role, [&](const std::string& value) {
        const auto moment = readTimestamp(value, local);
        return unplayedIsNone ? unplayedAsNone(moment, value) : moment;
    });
}

struct Albums {
    std::vector<Album> list;
    AlbumIndex index;

    const Album* of(const Facts& facts, size_t row) const {
        const auto at = index.of(facts.credits, row);
        return at ? &list[*at] : nullptr;
    }
};

Albums albumsOf(const Facts& facts, const SummaryRoles& roles) {
    AlbumRecords records = albumRecordsOf(facts.snapshot, roles, facts.credits);

    Albums albums;
    albums.index = std::move(records.index);
    albums.list.reserve(records.list.size());
    for (AlbumRecord& record : records.list) {
        Album album{std::move(record)};

        for (const uint32_t row : album.ordinals) {
            album.plays += facts.playsOf(row).value_or(0);

            const auto played = facts.lastPlayedOf(row);
            if (played && *played > album.lastPlayed)
                album.lastPlayed = *played;

            const auto arrived = facts.added.of(row);
            if (arrived && *arrived > album.added)
                album.added = *arrived;

            const auto rate = facts.bitrate.of(row);
            if (rate && *rate != 0) {
                album.bitrateTotal += *rate;
                ++album.bitrateCount;
            }

            if (facts.lossy.of(row) != 0)
                album.lossless = false;

            if (const auto stars = facts.rating.of(row)) {
                album.ratingTotal += *stars;
                ++album.ratedCount;
            }
        }
        albums.list.push_back(std::move(album));
    }

    return albums;
}

Facts factsOf(const Snapshot& snapshot, const SummaryRoles& roles, const LocalTime& local) {
    return Facts{snapshot,
                 snapshot.trackCount(),
                 counts(snapshot, roles.playCount),
                 counts(snapshot, roles.playCountLocal),
                 moments(snapshot, roles.lastPlayed, local, true),
                 moments(snapshot, roles.lastPlayedLocal, local, true),
                 moments(snapshot, roles.added, local, false),
                 resolve<std::optional<double>>(snapshot, roles.year, readNumber),
                 resolve<std::optional<double>>(snapshot, roles.bitrate, readNumber),
                 resolve<std::optional<double>>(
                     snapshot, roles.rating,
                     [](const std::string& value) { return starsOf(readNumber(value)); }),
                 resolve<std::optional<double>>(snapshot, roles.duration, readNumber),
                 resolve<uint8_t>(snapshot, roles.codec, isLossy),
                 creditsOf(snapshot, roles)};
}

Json albumJson(const Snapshot& snapshot, const Album& album) {
    Json json = Json::object();
    json["album"] = album.name;
    json["artist"] = album.artist ? Json(*album.artist) : Json(nullptr);
    json["cover"] = pathOf(snapshot, album.cover);
    json["ordinals"] = album.ordinals;
    json["trackCount"] = album.trackCount();
    json["plays"] = numberJson(album.plays);
    json["lastPlayed"] = numberJson(album.lastPlayed);
    json["added"] = numberJson(album.added);
    json["rating"] = optionalNumberJson(album.rating());
    json["ratedCount"] = album.ratedCount;
    json["bitrate"] = optionalNumberJson(album.bitrate());
    return json;
}

using Picks = std::vector<uint32_t>;

template <class Keep>
Picks keeping(const std::vector<Album>& albums, Keep keep) {
    Picks picks;
    for (size_t at = 0; at < albums.size(); ++at) {
        if (keep(albums[at]))
            picks.push_back(static_cast<uint32_t>(at));
    }
    return picks;
}

template <class Before>
void sortPicks(const std::vector<Album>& albums, Picks& picks, Before before) {
    std::stable_sort(picks.begin(), picks.end(),
                     [&](uint32_t a, uint32_t b) { return before(albums[a], albums[b]); });
}

void byPlays(const std::vector<Album>& albums, Picks& picks) {
    sortPicks(albums, picks, [](const Album& a, const Album& b) { return a.plays > b.plays; });
}

double percentile(std::vector<double> values, double fraction) {
    if (values.empty())
        return 0;

    std::sort(values.begin(), values.end());
    const double last = static_cast<double>(values.size() - 1);
    const double at = std::min(last, std::max(0.0, roundHalfUp(last * fraction)));
    return values[static_cast<size_t>(at)];
}

template <class Measure>
std::vector<double> measured(const std::vector<Album>& albums, const Picks& picks,
                             Measure measure) {
    std::vector<double> values;
    values.reserve(picks.size());
    for (const uint32_t pick : picks)
        values.push_back(measure(albums[pick]));
    return values;
}

struct Run {
    double from = 0;
    double to = 0;
    size_t count = 0;
};

// foo_playcount's first run stamps every track already in the library with that moment, one after
// another, so the largest unbroken run of arrivals is when it was installed if the run is a good
// share of the library.
std::optional<Run> firstRunOf(std::vector<double> arrivals) {
    std::sort(arrivals.begin(), arrivals.end());

    Run run;
    size_t start = 0;
    for (size_t at = 1; at <= arrivals.size(); ++at) {
        if (at < arrivals.size() && arrivals[at] - arrivals[at - 1] <= kFirstRunGapMs)
            continue;
        if (at - start > run.count)
            run = Run{arrivals[start], arrivals[at - 1], at - start};
        start = at;
    }

    if (run.count > 0 &&
        static_cast<double>(run.count) >= static_cast<double>(arrivals.size()) * kFirstRunShare)
        return run;
    return std::nullopt;
}

Picks pickAdded(const std::vector<Album>& albums, double now) {
    const double since = now - kAddedWindowMs;

    std::vector<double> arrivals;
    for (const Album& album : albums) {
        if (album.added > 0)
            arrivals.push_back(album.added);
    }
    const auto firstRun = firstRunOf(std::move(arrivals));

    Picks picks = keeping(albums, [&](const Album& album) {
        return album.added > since &&
               (!firstRun || album.added < firstRun->from || album.added > firstRun->to);
    });
    sortPicks(albums, picks, [](const Album& a, const Album& b) { return a.added > b.added; });
    return picks;
}

Picks pickRecent(const std::vector<Album>& albums, double now) {
    const double since = now - kRecentWindowMs;
    Picks picks = keeping(albums, [&](const Album& album) { return album.lastPlayed > since; });
    sortPicks(albums, picks,
              [](const Album& a, const Album& b) { return a.lastPlayed > b.lastPlayed; });
    return picks;
}

Picks pickTop(const std::vector<Album>& albums, [[maybe_unused]] double now) {
    Picks picks = keeping(albums, [](const Album& album) { return album.plays > 0; });
    byPlays(albums, picks);
    return picks;
}

Picks pickRated(const std::vector<Album>& albums, [[maybe_unused]] double now) {
    const Picks rated = keeping(
        albums, [](const Album& album) { return album.ratedCount >= kLeastRatingsToCount; });
    if (rated.size() < kCandidateFloor)
        return {};

    const double good = percentile(
        measured(albums, rated, [](const Album& album) { return *album.rating(); }), kMedian);
    Picks picks = keeping(albums, [&](const Album& album) {
        return album.ratedCount >= kLeastRatingsToCount && *album.rating() >= good;
    });
    sortPicks(albums, picks, [](const Album& a, const Album& b) {
        return *a.rating() > *b.rating() ||
               (*a.rating() == *b.rating() && a.ratedCount > b.ratedCount);
    });
    return picks;
}

Picks pickLoved(const std::vector<Album>& albums, double now) {
    const Picks played = keeping(albums, [](const Album& album) {
        return album.plays > 0 && album.lastPlayed > 0 &&
               album.trackCount() >= kLeastTracksToLoveOrUpgrade;
    });
    if (played.size() < kCandidateFloor)
        return {};

    const double busy = percentile(
        measured(albums, played, [](const Album& album) { return album.playsPerTrack(); }),
        kUpperQuartile);
    const double silent = now - kForgottenAfterMs;

    Picks picks;
    for (const uint32_t pick : played) {
        if (albums[pick].playsPerTrack() >= busy && albums[pick].lastPlayed <= silent)
            picks.push_back(pick);
    }
    byPlays(albums, picks);
    return picks;
}

Picks pickUpgrade(const std::vector<Album>& albums, [[maybe_unused]] double now) {
    const Picks lossy = keeping(albums, [](const Album& album) {
        const auto bitrate = album.bitrate();
        return !album.lossless && bitrate && *bitrate != 0 && album.plays > 0 &&
               album.trackCount() >= kLeastTracksToLoveOrUpgrade;
    });
    if (lossy.size() < kCandidateFloor)
        return {};

    const double busy = percentile(
        measured(albums, lossy, [](const Album& album) { return album.playsPerTrack(); }),
        kUpperQuartile);
    const double poor =
        percentile(measured(albums, lossy, [](const Album& album) { return *album.bitrate(); }),
                   kLowerQuartile);

    Picks picks;
    for (const uint32_t pick : lossy) {
        if (albums[pick].playsPerTrack() >= busy && albums[pick].bitrate().value_or(0) <= poor)
            picks.push_back(pick);
    }
    byPlays(albums, picks);
    return picks;
}

Picks pickUnopened(const std::vector<Album>& albums, [[maybe_unused]] double now) {
    const bool anyPlayed =
        std::any_of(albums.begin(), albums.end(), [](const Album& a) { return a.plays > 0; });
    if (!anyPlayed)
        return {};

    Picks picks = keeping(albums, [](const Album& album) { return album.plays == 0; });
    sortPicks(albums, picks,
              [](const Album& a, const Album& b) { return a.trackCount() > b.trackCount(); });
    return picks;
}

struct Shelf {
    const char* id;
    Picks (*pick)(const std::vector<Album>&, double now);
    size_t minimum;
};

constexpr std::array<Shelf, 7> kShelves{{
    {"added", pickAdded, kAddedMinimumPicks},
    {"recent", pickRecent, kMinimumPicks},
    {"top", pickTop, kMinimumPicks},
    {"rated", pickRated, kMinimumPicks},
    {"loved", pickLoved, kMinimumPicks},
    {"upgrade", pickUpgrade, kMinimumPicks},
    {"unopened", pickUnopened, kMinimumPicks},
}};

Picks starterPicks(size_t count, uint64_t seed) {
    Picks order(count);
    std::iota(order.begin(), order.end(), 0U);

    const auto stop =
        static_cast<int64_t>(std::max<size_t>(1, count > kShelfLimit ? count - kShelfLimit : 0));
    uint64_t state = seed;
    for (auto i = static_cast<int64_t>(count) - 1; i >= stop; --i) {
        state += kSplitMixStep;
        const auto j = static_cast<size_t>(splitMixFinalised(state) % static_cast<uint64_t>(i + 1));
        std::swap(order[static_cast<size_t>(i)], order[j]);
    }

    return Picks(order.begin() + static_cast<std::ptrdiff_t>(count - std::min(count, kShelfLimit)),
                 order.end());
}

Json shelvesJson(const Snapshot& snapshot, const std::vector<Album>& albums, int64_t nowMs,
                 const LocalTime& local) {
    const double now = static_cast<double>(nowMs);
    const auto shelfJson = [&](const char* id, const Picks& picks, size_t shown) {
        Json albumsJson = Json::array();
        for (size_t at = 0; at < std::min(shown, picks.size()); ++at)
            albumsJson.push_back(albumJson(snapshot, albums[picks[at]]));

        Json shelf = Json::object();
        shelf["id"] = id;
        shelf["albums"] = std::move(albumsJson);
        return shelf;
    };

    Json shelves = Json::array();
    if (albums.empty())
        return shelves;

    for (const Shelf& shelf : kShelves) {
        const Picks picks = shelf.pick(albums, now);
        if (picks.size() >= shelf.minimum)
            shelves.push_back(shelfJson(shelf.id, picks, kShelfLimit));
    }
    if (!shelves.empty() || albums.size() < kMinimumPicks)
        return shelves;

    shelves.push_back(
        shelfJson("starter", starterPicks(albums.size(), local.date(nowMs)), kShelfLimit));
    return shelves;
}

struct ArtistTotals {
    std::optional<std::string> name;
    double plays = 0;
    size_t albumCount = 0;
    size_t trackCount = 0;
    uint32_t cover = 0;
};

std::vector<ArtistTotals> artistsOf(const std::vector<Album>& albums) {
    std::vector<ArtistTotals> artists;
    std::unordered_map<int64_t, size_t> byKey;
    for (size_t at = 0; at < albums.size(); ++at) {
        const Album& album = albums[at];
        const auto [found, fresh] = byKey.try_emplace(album.artistKey, artists.size());
        if (fresh) {
            ArtistTotals totals;
            totals.name = album.artist;
            totals.cover = static_cast<uint32_t>(at);
            artists.push_back(std::move(totals));
        }

        ArtistTotals& artist = artists[found->second];
        artist.plays += album.plays;
        ++artist.albumCount;
        artist.trackCount += album.trackCount();
        if (album.plays > albums[artist.cover].plays)
            artist.cover = static_cast<uint32_t>(at);
    }
    return artists;
}

Json topTracksJson(const Facts& facts, const Albums& albums, const SummaryRoles& roles) {
    struct Played {
        uint32_t row;
        double plays;
    };
    std::vector<Played> played;
    for (size_t row = 0; row < facts.rows; ++row) {
        const double plays = facts.playsOf(row).value_or(0);
        if (plays > 0)
            played.push_back({static_cast<uint32_t>(row), plays});
    }

    const size_t shown = std::min(kTopTracks, played.size());
    std::partial_sort(played.begin(), played.begin() + static_cast<std::ptrdiff_t>(shown),
                      played.end(), [](const Played& a, const Played& b) {
                          return a.plays > b.plays || (a.plays == b.plays && a.row < b.row);
                      });

    const auto textOf = [&](std::optional<size_t> role, size_t row) -> std::optional<std::string> {
        if (!role)
            return std::nullopt;
        const Column& column = facts.snapshot.columns[*role];
        const std::string& value = column.dictionary.values[column.ids[row]];
        return isPresent(value) ? std::optional(value) : std::nullopt;
    };
    const auto textJson = [](const std::optional<std::string>& text) {
        return text ? Json(*text) : Json(nullptr);
    };

    Json tracks = Json::array();
    for (size_t at = 0; at < shown; ++at) {
        const Played& track = played[at];
        const auto artist = textOf(roles.artist, track.row);

        Json json = Json::object();
        json["ordinal"] = track.row;
        json["title"] = textJson(textOf(roles.title, track.row));
        json["artist"] = textJson(artist ? artist : textOf(roles.albumArtist, track.row));
        json["plays"] = numberJson(track.plays);
        const Album* album = albums.of(facts, track.row);
        json["cover"] = pathOf(facts.snapshot, album ? album->cover : track.row);
        tracks.push_back(std::move(json));
    }
    return tracks;
}

struct GenreBars {
    Json bars = Json::array();
    size_t distinct = 0;
};

GenreBars genreBarsOf(const Snapshot& snapshot, std::optional<size_t> role, size_t rows) {
    TagGroups genres;
    PerValue<std::vector<int32_t>> genreOf;
    if (role) {
        const Column& column = snapshot.columns[*role];
        genreOf.ids = &column.ids;
        for (const std::string& value : column.dictionary.values) {
            std::vector<int32_t> groups;
            if (isPresent(value)) {
                for (size_t from = 0; from <= value.size();) {
                    const size_t end =
                        std::min(value.find(kMultiValueSeparator, from), value.size());
                    const std::string_view part = std::string_view(value).substr(from, end - from);
                    const std::string key = tagKey(part);
                    if (!key.empty()) {
                        const int32_t group = genres.add(key, part);
                        if (std::find(groups.begin(), groups.end(), group) == groups.end())
                            groups.push_back(group);
                    }
                    from = end + 1;
                }
            }
            genreOf.answers.push_back(std::move(groups));
        }
    }
    std::vector<size_t> genreCounts(genres.names.size(), 0);
    if (genreOf.ids) {
        for (size_t row = 0; row < rows; ++row) {
            for (const int32_t group : genreOf.of(row))
                ++genreCounts[static_cast<size_t>(group)];
        }
    }

    std::vector<size_t> named;
    for (size_t group = 0; group < genreCounts.size(); ++group) {
        if (genreCounts[group] > 0)
            named.push_back(group);
    }
    std::stable_sort(named.begin(), named.end(),
                     [&](size_t a, size_t b) { return genreCounts[a] > genreCounts[b]; });

    GenreBars result;
    result.distinct = named.size();
    for (size_t at = 0; at < std::min(kGenreBars, named.size()); ++at) {
        const size_t group = named[at];
        Json genre = Json::object();
        genre["name"] = genres.names[group];
        genre["count"] = genreCounts[group];
        genre["share"] = numberJson(
            roundHalfUp(static_cast<double>(genreCounts[group]) / static_cast<double>(rows) * 100));
        result.bars.push_back(std::move(genre));
    }
    return result;
}

}  // namespace

std::string summariseLibrary(const Snapshot& snapshot, const SummaryRoles& roles, int64_t nowMs,
                             const LocalTime& local) {
    const Facts facts = factsOf(snapshot, roles, local);
    const size_t rows = facts.rows;

    double seconds = 0;
    std::optional<double> earliest;
    std::optional<double> latest;
    for (size_t row = 0; row < rows; ++row) {
        seconds += facts.duration.of(row).value_or(0);

        const auto released = facts.year.of(row);
        if (released && *released > kFirstRealYear) {
            earliest = earliest ? std::min(*earliest, *released) : *released;
            latest = latest ? std::max(*latest, *released) : *released;
        }
    }

    const GenreBars genres = genreBarsOf(snapshot, roles.genre, rows);

    const Albums held = albumsOf(facts, roles);
    const std::vector<Album>& albums = held.list;
    const std::vector<ArtistTotals> artists = artistsOf(albums);

    const auto topAlbum = [&]() -> Json {
        const Album* best = nullptr;
        for (const Album& album : albums) {
            if (album.plays > 0 && (best == nullptr || album.plays > best->plays))
                best = &album;
        }
        return best ? albumJson(snapshot, *best) : Json(nullptr);
    }();

    const auto topArtist = [&]() -> Json {
        const ArtistTotals* best = nullptr;
        for (const ArtistTotals& artist : artists) {
            if (artist.plays > 0 && (best == nullptr || artist.plays > best->plays))
                best = &artist;
        }
        if (best == nullptr)
            return nullptr;

        Json json = Json::object();
        json["name"] = best->name ? Json(*best->name) : Json(nullptr);
        json["plays"] = numberJson(best->plays);
        json["albumCount"] = best->albumCount;
        json["trackCount"] = best->trackCount;
        json["cover"] = albumJson(snapshot, albums[best->cover]);
        return json;
    }();

    Json document = Json::object();
    document["structure"] = snapshot.structure;
    document["revision"] = snapshot.revision;
    document["trackCount"] = rows;
    document["seconds"] = numberJson(seconds);
    document["earliestYear"] = optionalNumberJson(earliest);
    document["latestYear"] = optionalNumberJson(latest);
    document["albumCount"] = albums.size();
    document["artistCount"] = artists.size();
    document["genreCount"] = genres.distinct;
    document["topGenres"] = genres.bars;
    document["topAlbum"] = topAlbum;
    document["topArtist"] = topArtist;
    document["topTracks"] = topTracksJson(facts, held, roles);
    document["shelves"] = shelvesJson(snapshot, albums, nowMs, local);
    return document.dump(-1, ' ', false, Json::error_handler_t::replace);
}

}  // namespace jean
