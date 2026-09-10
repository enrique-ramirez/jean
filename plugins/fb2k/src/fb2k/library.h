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
