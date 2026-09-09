#pragma once

#include "core/api.h"
#include "core/audience.h"
#include "core/settings.h"
#include "core/stream_ticket.h"

#include "third_party/doctest.h"

#include <memory>
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

// Long enough to be accepted, short enough to read in a failure message.
constexpr char kToken[] = "0123456789abcdef0123456789abcdef";

// The one form a playlist id may take: lower case, dashed.
constexpr char kPlaylistId[] = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";

// A write the default allowlist permits, and the path it names.
constexpr char kRatingWrite[] =
    R"({"path": "F:\\foo_jean-test\\sample.mp3", "fields": {"rating": "4"}})";
constexpr char kRatingWritePath[] = R"(F:\foo_jean-test\sample.mp3)";

// A configuration that would serve: a legal token, every other default left alone.
Settings servingSettings();

// The same, with the write allowlist widened past its default of rating alone.
Settings servingSettingsAllowing(std::vector<std::string> fields);

ListenerStatus listeningStatus();

// Predictable tickets, so a test can tell a rejected one from a reused one.
TicketMint countingMint();

}  // namespace jean::testing
