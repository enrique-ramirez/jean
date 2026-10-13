#include "support/tickets.h"

#include "core/session.h"
#include "support/log_capture.h"
#include "support/test_server.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstdint>
#include <memory>
#include <utility>

namespace jean::testing {

namespace {

bool isHexDigit(char digit) {
    return std::isxdigit(static_cast<unsigned char>(digit)) != 0;
}

std::vector<std::string> hexRunsIn(const std::string& line) {
    std::vector<std::string> runs;

    auto start = line.begin();
    while (start != line.end()) {
        start = std::find_if(start, line.end(), isHexDigit);
        const auto stop = std::find_if_not(start, line.end(), isHexDigit);
        if (static_cast<size_t>(stop - start) >= kTicketDigits)
            runs.emplace_back(start, stop);
        start = stop;
    }

    return runs;
}

std::string joined(const std::vector<std::string>& lines) {
    std::string text;
    for (const auto& line : lines)
        text += (text.empty() ? "" : "\n") + line;
    return text;
}

}  // namespace

TicketMint hexMint() {
    const auto issued = std::make_shared<std::atomic<std::uint32_t>>(0);

    return [issued] {
        static constexpr char kDigits[] = "0123456789abcdef";

        std::uint32_t state = ++*issued;
        std::string ticket(kTicketDigits, '0');
        for (auto& digit : ticket) {
            state = (state * 1103515245U) + 12345U;
            digit = kDigits[(state >> 16U) & 0xfU];
        }

        return ticket;
    };
}

bool isTicketShaped(const std::string& text) {
    return text.size() == kTicketDigits && std::all_of(text.begin(), text.end(), isHexDigit);
}

std::string linesLogging(const std::vector<std::string>& sent) {
    std::vector<std::string> leaks;

    for (const auto& line : loggedLines()) {
        const bool carriesOne = std::any_of(sent.begin(), sent.end(), [&line](const auto& value) {
            return !value.empty() && line.find(value) != std::string::npos;
        });
        if (carriesOne)
            leaks.push_back(line);
    }

    return joined(leaks);
}

std::string linesLoggingHexRuns(const std::vector<std::string>& besides) {
    std::vector<std::string> leaks;

    for (const auto& line : loggedLines()) {
        const auto runs = hexRunsIn(line);
        const bool carriesOne = std::any_of(runs.begin(), runs.end(), [&besides](const auto& run) {
            return std::find(besides.begin(), besides.end(), run) == besides.end();
        });
        if (carriesOne)
            leaks.push_back(line);
    }

    return joined(leaks);
}

Player streamingToSessions(const StreamOpener& open) {
    Player player = TestServer::streaming(open);
    player.sessions.start = [open](Session&) {
        SessionStream stream;
        stream.open = open;
        stream.stop = [] {};
        return stream;
    };

    return player;
}

}  // namespace jean::testing
