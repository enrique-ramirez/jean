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

class FiniteStream : public StreamListener {
public:
    explicit FiniteStream(std::vector<std::string> chunks) : chunks_(std::move(chunks)) {}

    bool next(std::vector<std::uint8_t>& out) override {
        if (sent_ >= chunks_.size())
            return false;

        const auto& chunk = chunks_[sent_++];
        out.assign(chunk.begin(), chunk.end());
        return true;
    }

private:
    std::vector<std::string> chunks_;
    size_t sent_ = 0;
};

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

void buildLibrary(Library& library, size_t trackCount) {
    LibraryBuilder builder({"%title%"}, trackCount);
    auto& sink = builder.sink();

    for (size_t index = 0; index < trackCount; ++index)
        sink.row(index,
                 {kBuiltFolder, std::to_string(index) + ".flac", "0", builtTrackTitle(index)});

    library.replace(builder.finish());
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

StreamOpener opensWith(std::vector<std::string> chunks, std::string contentType, int* opens) {
    return [chunks = std::move(chunks), contentType = std::move(contentType),
            opens](const std::string&) -> OpenedStream {
        if (opens != nullptr)
            ++*opens;
        return {contentType, std::make_unique<FiniteStream>(chunks)};
    };
}

SessionRandom countingUp() {
    const auto drawn = std::make_shared<size_t>(0);
    return [drawn](size_t bound) { return (*drawn)++ % bound; };
}

}  // namespace jean::testing
