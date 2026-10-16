#include "support/fixtures.h"

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace jean::testing {

namespace {

constexpr char kBuiltFolder[] = "Artist/Album/";

}  // namespace

std::string ratingWrite(const std::string& track, std::optional<uint32_t> subsong) {
    const auto within = subsong ? R"(, "subsong": )" + std::to_string(*subsong) : std::string();

    return R"({"track": ")" + track + R"(")" + within + R"(, "fields": {"rating": ")" + kRating +
           R"("}})";
}

std::string ratingWriteAtRow(const std::string& playlist, uint32_t index, uint64_t structure) {
    return R"({"playlist": ")" + playlist + R"(", "index": )" + std::to_string(index) +
           R"(, "structure": ")" + std::to_string(structure) + R"(", "fields": {"rating": ")" +
           kRating + R"("}})";
}

Snapshot snapshotOf(const std::vector<std::string>& columns,
                    const std::vector<std::vector<std::string>>& rows) {
    LibraryBuilder builder(columns, rows.size());
    auto& sink = builder.sink();

    for (size_t index = 0; index < rows.size(); ++index)
        sink.row(index, rows[index]);

    return builder.finish();
}

void buildLibrary(Library& library, size_t trackCount) {
    std::vector<std::vector<std::string>> rows;
    rows.reserve(trackCount);
    for (size_t index = 0; index < trackCount; ++index)
        rows.push_back(
            {kBuiltFolder, std::to_string(index) + ".flac", "0", builtTrackTitle(index)});

    library.replace(snapshotOf({"%title%"}, rows));
}

void moveLibraryStructure(Library& library) {
    buildLibrary(library, library.state().trackCount + 1);
}

std::string builtTrackPath(size_t ordinal) {
    return kBuiltFolder + std::to_string(ordinal) + ".flac";
}

std::string builtTrackTitle(size_t ordinal) {
    return "Track " + std::to_string(ordinal);
}

Settings servingSettings() {
    return Settings();
}

Settings servingSettingsAllowing(std::vector<std::string> fields) {
    Settings settings = servingSettings();
    settings.allowedFields = std::move(fields);
    return settings;
}

Player servingPlayer() {
    Player player;
    player.report.name = "foobar2000";
    player.report.version = "2.25.3";
    player.report.volumeMin = -100;
    player.report.volumeMax = 0;
    player.report.volumeUnit = "db";
    return player;
}

ListenerStatus listeningStatus() {
    ListenerStatus status;
    status.listening = true;
    return status;
}

TicketMint countingMint() {
    const auto issued = std::make_shared<int>(0);
    return [issued] { return "ticket-" + std::to_string(++*issued); };
}

SessionRandom countingUp() {
    const auto drawn = std::make_shared<size_t>(0);
    return [drawn](size_t bound) { return (*drawn)++ % bound; };
}

}  // namespace jean::testing
