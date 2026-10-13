#pragma once

#include "core/audience.h"
#include "core/documents.h"
#include "core/http_server.h"
#include "core/library.h"
#include "core/session.h"
#include "core/settings.h"
#include "core/stream.h"
#include "core/stream_ticket.h"

#include "third_party/doctest.h"

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

// A membership is opaque by design, and MSVC's <memory> answers `stream << shared_ptr` by
// forwarding to the pointee, so an assertion handed the pointer itself does not compile
// there. Naming the two states keeps `REQUIRE(joined)` readable on both toolchains.
namespace doctest {
template <>
struct StringMaker<std::shared_ptr<jean::Audience::Membership>> {
    static String convert(const std::shared_ptr<jean::Audience::Membership>& membership) {
        return membership ? "a membership" : "no membership";
    }
};
}  // namespace doctest

namespace jean::testing {

// The one form a playlist id may take: lower case, dashed.
constexpr char kPlaylistId[] = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";

// The library-relative, forward-slashed address `GET /api/artwork?track=` takes. An ordinary
// file, so the media library holds it at subsong 0 and at no other subsong.
constexpr char kTrackAddress[] = "Someone/A Record/01 A Song.flac";

// A cue sheet: three tracks inside one file, sharing an address and told apart by subsong
// alone. foobar2000 numbers a cue sheet's subsongs from 1, so the media library holds this
// address at 1, 2 and 3, and holds no subsong 0 of it. A stand-in that indexed a file's
// subsongs by position instead would answer the first track for the subsong nothing holds,
// and a client sending one would be answered by this suite and refused by the player.
constexpr char kCueAddress[] = "Someone/A Record/disc.flac";
constexpr uint32_t kFirstCueSubsong = 1;
constexpr uint32_t kCueSubsongs = 3;

// A playlist generation of the shape one really carries: past 2^53, where a JSON number stops
// being exact, so a generation one away from it is the near miss a test wants.
constexpr uint64_t kWriteStructure = 7281905463201847559ULL;

// The one field the default allowlist permits, and the value both write fixtures carry.
constexpr char kRating[] = "4";

// A write the default allowlist permits, addressed by where the media library holds the track.
// Leave the subsong out for a file holding one track, which is what a client sends for one.
std::string ratingWrite(const std::string& track, std::optional<uint32_t> subsong = std::nullopt);

// The same write, addressed by a row's position in a playlist and the generation it was read at.
std::string ratingWriteAtRow(const std::string& playlist, uint32_t index, uint64_t structure);

constexpr size_t kLibraryTracks = 8;

// A media library snapshot of `trackCount` tracks declaring the one column `%title%`, each at
// builtTrackPath and titled builtTrackTitle.
void buildLibrary(Library& library, size_t trackCount = kLibraryTracks);

void moveLibraryStructure(Library& library);

std::string builtTrackPath(size_t ordinal);
std::string builtTrackTitle(size_t ordinal);

// The defaults, named so a test reaches them the same way it reaches every other fixture.
Settings servingSettings();

// The report a real player always carries: its name, its version and its volume range.
// A default-constructed Player{} leaves these empty, which is right for a test asserting
// that a feature is off by default, and wrong for a route that promises never to answer
// an empty playerName or playerVersion. Every other callback stays null, exactly as
// Player{} leaves it.
Player servingPlayer();

// The same, with the write allowlist widened past its default of rating and unsynced lyrics.
Settings servingSettingsAllowing(std::vector<std::string> fields);

ListenerStatus listeningStatus();

// Predictable tickets, so a test can tell a rejected one from a reused one.
TicketMint countingMint();

SessionRandom countingUp();

}  // namespace jean::testing
