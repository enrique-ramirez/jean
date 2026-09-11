#pragma once

#include "core/http_server.h"
#include "core/library.h"

#include <memory>
#include <string>
#include <vector>

// The half of the media library snapshot that involves foobar2000. What a request may ask
// for and how the answer is encoded were decided in core/library.h before any of this runs.
namespace jean {

class MainThreadQueue;

// One handle per ordinal, in the order given. Empty and `structureMatched` false when
// `structure` no longer names the snapshot this was resolved against, since a rebuild since
// then has moved every ordinal in it and none can be trusted.
struct OrdinalResolution {
    bool structureMatched = false;
    metadb_handle_list items;
};

// Resolves `ordinals` and checks `structure` against the current snapshot in the one lock,
// so a rebuild landing between the two cannot be read as a match.
using OrdinalResolver =
    std::function<OrdinalResolution(uint64_t structure, const std::vector<uint32_t>& ordinals)>;

class LibraryFeed {
public:
    // Main thread only; registering the change callbacks requires it.
    LibraryFeed(MainThreadQueue& mainThread, Library& library);
    ~LibraryFeed();

    // False on a player without metadb_v2, which is foobar2000 before 2.0.
    bool enabled() const;

    // Takes the client's title-format expressions, which become the set every later
    // rebuild and every re-query evaluates, and returns before the build finishes.
    LibraryRefresher refresher();

    ArtworkReader artworkReader();

    OrdinalResolver ordinalResolver();

    LibraryFeed(const LibraryFeed&) = delete;
    LibraryFeed& operator=(const LibraryFeed&) = delete;

private:
    struct State;
    struct Watch;
    struct Playback;

    std::shared_ptr<State> state_;
    std::unique_ptr<Watch> watch_;
    std::unique_ptr<Playback> playback_;
};

}  // namespace jean
