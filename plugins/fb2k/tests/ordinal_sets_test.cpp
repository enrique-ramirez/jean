#include "third_party/doctest.h"

#include "core/ordinal_sets.h"
#include "core/selection.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <random>
#include <span>
#include <string>
#include <vector>

using namespace jean;
using nlohmann::json;

namespace {

std::vector<uint32_t> range(uint32_t start, uint32_t count) {
    std::vector<uint32_t> ordinals;
    ordinals.reserve(count);
    for (uint32_t at = 0; at < count; ++at)
        ordinals.push_back(start + at);
    return ordinals;
}

size_t bitsetLength(size_t trackCount) {
    const size_t bytes = (trackCount + 7) / 8;
    return 4 * ((bytes + 2) / 3);
}

json maximalRuns(const std::vector<uint32_t>& ordinals) {
    json runs = json::array();
    for (const uint32_t ordinal : ordinals) {
        if (!runs.empty()) {
            json& last = runs.back();
            if (last[0].get<uint32_t>() + last[1].get<uint32_t>() == ordinal) {
                last[1] = last[1].get<uint32_t>() + 1;
                continue;
            }
        }
        runs.push_back(json::array({ordinal, 1}));
    }
    return runs;
}

std::vector<uint32_t> readBack(const json& document, size_t trackCount) {
    REQUIRE(document.is_object());
    REQUIRE(document.size() == 1);
    REQUIRE(namesOneSelectionForm(document));
    const SelectionResult result = decodeSelection(document, trackCount);
    REQUIRE(result.ok());
    return result.ordinals;
}

}  // namespace

TEST_CASE("an empty set is runs: [], in an empty library and in a large one") {
    for (const size_t trackCount : {size_t{0}, size_t{1}, size_t{100000}}) {
        CAPTURE(trackCount);
        const json document = ordinalSetDocument({}, trackCount);
        CHECK(document == json{{"runs", json::array()}});
        CHECK(readBack(document, trackCount).empty());
    }
}

TEST_CASE("one ordinal of a thousand tracks is one run of one") {
    const std::vector<uint32_t> ordinals{617};
    const json document = ordinalSetDocument(ordinals, 1000);

    CHECK(document == json{{"runs", json::array({json::array({617, 1})})}});
    CHECK(readBack(document, 1000) == ordinals);
}

TEST_CASE("one ordinal of ten tracks is a bitset, its bit counted from the least significant") {
    const std::vector<uint32_t> ordinals{5};
    const json document = ordinalSetDocument(ordinals, 10);

    CHECK(document == json{{"bitset", "IAA="}});
    CHECK(readBack(document, 10) == ordinals);
}

TEST_CASE("a run of a thousand consecutive ordinals is sent as one run, start then count") {
    const std::vector<uint32_t> ordinals = range(3000, 1000);
    const json document = ordinalSetDocument(ordinals, 5000);

    CHECK(document == json{{"runs", json::array({json::array({3000, 1000})})}});
    CHECK(readBack(document, 5000) == ordinals);
}

TEST_CASE("every other ordinal of 4000 tracks is a bitset of 500 bytes of 0x55") {
    std::vector<uint32_t> ordinals;
    for (uint32_t ordinal = 0; ordinal < 4000; ordinal += 2)
        ordinals.push_back(ordinal);

    const json document = ordinalSetDocument(ordinals, 4000);

    REQUIRE(document.contains("bitset"));
    CHECK(document.at("bitset") == std::string(664, 'V') + "VVU=");
    CHECK(readBack(document, 4000) == ordinals);
}

TEST_CASE("runs exactly as long as the bitset are sent as runs, and one character longer are not") {
    const std::vector<uint32_t> tie = range(10, 5);
    const json tied = ordinalSetDocument(tie, 48);
    CHECK(tied == json{{"runs", json::array({json::array({10, 5})})}});
    CHECK(readBack(tied, 48) == tie);

    const std::vector<uint32_t> longer = range(10, 15);
    const json overBudget = ordinalSetDocument(longer, 48);
    CHECK(overBudget == json{{"bitset", "APz/AQAA"}});
    CHECK(readBack(overBudget, 48) == longer);

    const json oneTrackMore = ordinalSetDocument(longer, 49);
    CHECK(oneTrackMore == json{{"runs", json::array({json::array({10, 15})})}});
    CHECK(readBack(oneTrackMore, 49) == longer);
}

TEST_CASE("a set holding the last track ends its bitset on that track's bit, padded") {
    const std::vector<uint32_t> ordinals{15};
    const json document = ordinalSetDocument(ordinals, 16);

    CHECK(document == json{{"bitset", "AIA="}});
    CHECK(readBack(document, 16) == ordinals);
}

TEST_CASE("a set in the top bits of a partial last byte keeps them in place") {
    const std::vector<uint32_t> ordinals{10, 12};
    const json document = ordinalSetDocument(ordinals, 13);

    CHECK(document == json{{"bitset", "ABQ="}});
    CHECK(readBack(document, 13) == ordinals);
}

TEST_CASE("a bitset spans every track of the library, however early its set ends") {
    const std::vector<uint32_t> ordinals{0, 2, 4};
    const json document = ordinalSetDocument(ordinals, 40);

    CHECK(document == json{{"bitset", "FQAAAAA="}});
    CHECK(readBack(document, 40) == ordinals);
}

TEST_CASE("over a few hundred seeded sets, the shorter form is sent and both forms read back") {
    constexpr uint32_t kSeed = 37;
    constexpr int kSetsPerCount = 40;
    constexpr std::array<uint32_t, 10> kTrackCounts{1, 7, 8, 9, 23, 24, 25, 100, 1000, 4099};

    // std::mt19937's output is specified, and the distributions over it are not, so the same sets
    // come back on every standard library.
    // NOLINTNEXTLINE(bugprone-random-generator-seed,cert-msc32-c,cert-msc51-cpp)
    std::mt19937 engine(kSeed);

    int sentAsRuns = 0;
    int sentAsBitset = 0;

    for (const uint32_t trackCount : kTrackCounts) {
        for (int trial = 0; trial < kSetsPerCount; ++trial) {
            std::vector<uint32_t> ordinals;
            if (trial % 2 == 0) {
                const uint32_t eighths = 1 + static_cast<uint32_t>(trial % 7);
                for (uint32_t ordinal = 0; ordinal < trackCount; ++ordinal)
                    if (engine() % 8 < eighths)
                        ordinals.push_back(ordinal);
            } else {
                const uint32_t longest = 1 + static_cast<uint32_t>(trial);
                uint32_t ordinal = static_cast<uint32_t>(engine() % longest);
                while (ordinal < trackCount) {
                    const uint32_t length = 1 + static_cast<uint32_t>(engine() % longest);
                    for (uint32_t at = 0; at < length && ordinal < trackCount; ++at)
                        ordinals.push_back(ordinal++);
                    ordinal += 1 + static_cast<uint32_t>(engine() % longest);
                }
            }

            CAPTURE(trackCount);
            CAPTURE(trial);
            CAPTURE(ordinals.size());

            const json document = ordinalSetDocument(ordinals, trackCount);
            const json runs = maximalRuns(ordinals);

            if (ordinals.empty() || runs.dump().size() <= bitsetLength(trackCount)) {
                ++sentAsRuns;
                CHECK(document == json{{"runs", runs}});
            } else {
                ++sentAsBitset;
                REQUIRE(document.contains("bitset"));
                CHECK(document.at("bitset").get<std::string>().size() == bitsetLength(trackCount));
            }

            CHECK(readBack(document, trackCount) == ordinals);
        }
    }

    CHECK(sentAsRuns > 50);
    CHECK(sentAsBitset > 50);
}
