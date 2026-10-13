#pragma once

#include "core/player.h"
#include "core/stream.h"
#include "core/stream_ticket.h"

#include <cstddef>
#include <string>
#include <vector>

namespace jean::testing {

constexpr size_t kTicketDigits = 64;

constexpr char kPhone[] = R"({"deviceId": "phone-4c1e", "name": "Kitchen phone"})";
constexpr char kLaptop[] = R"({"deviceId": "laptop-9a07", "name": "Study laptop"})";

constexpr int kMoreTicketsThanAnyoneHolds = 64;

TicketMint hexMint();

bool isTicketShaped(const std::string& text);

std::string linesLogging(const std::vector<std::string>& sent);

std::string linesLoggingHexRuns(const std::vector<std::string>& besides = {});

Player streamingToSessions(const StreamOpener& open);

}  // namespace jean::testing
