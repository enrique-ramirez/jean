#pragma once

#include <cstddef>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace jean {

enum class SessionOrder { inOrder, repeatAll, repeatOne, random, shuffleTracks };

std::optional<SessionOrder> sessionOrderNamed(const std::string& jeanMode);
std::string modeNameOf(SessionOrder order);
std::vector<std::string> sessionPlaybackModes();

// Uniform in [0, bound), and never asked with a bound of 0. MUST be callable from several
// threads at once: every session draws from the one the registry was given. It is called under a
// session's lock, so it MUST NOT call into core/.
using SessionRandom = std::function<size_t(size_t bound)>;

struct SessionCursor {
    std::optional<size_t> at;
    std::vector<size_t> walk;
    size_t walked = 0;
};

SessionCursor startedAt(SessionOrder order, size_t count, size_t row, const SessionRandom& random);

enum class Advance { ended, failed, next, previous };

SessionCursor advanced(SessionOrder order, size_t count, SessionCursor from, Advance why,
                       const SessionRandom& random);

}  // namespace jean
