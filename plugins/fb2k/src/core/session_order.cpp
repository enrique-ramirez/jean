#include "core/session_order.h"

#include <algorithm>
#include <iterator>
#include <numeric>
#include <utility>

namespace jean {

namespace {

struct OrderName {
    SessionOrder order;
    const char* name;
};

// In the sequence sessionPlaybackModes() lists them. Provisional, waiting on the owner: the
// sequence itself.
constexpr OrderName kOrders[]{{SessionOrder::inOrder, "inOrder"},
                              {SessionOrder::repeatAll, "repeatAll"},
                              {SessionOrder::repeatOne, "repeatOne"},
                              {SessionOrder::shuffleTracks, "shuffleTracks"},
                              {SessionOrder::random, "random"}};

// Fisher-Yates over rows[first..], written out rather than handed to std::shuffle because the
// standard library does not fix how std::shuffle consumes its generator, so one source of
// randomness would play different orders under libc++ and MSVC.
void shuffleFrom(std::vector<size_t>& rows, size_t first, const SessionRandom& random) {
    for (size_t end = rows.size(); end > first + 1; --end)
        std::swap(rows[end - 1], rows[first + random(end - first)]);
}

std::vector<size_t> allRows(size_t count) {
    std::vector<size_t> rows(count);
    std::iota(rows.begin(), rows.end(), size_t{0});
    return rows;
}

size_t drawnBeside(size_t at, size_t count, const SessionRandom& random) {
    if (count < 2)
        return at;

    const size_t drawn = random(count - 1);
    return drawn >= at ? drawn + 1 : drawn;
}

// Provisional, waiting on the owner: inOrder stays on its first row, repeatAll and repeatOne
// wrap from the first row to the last, shuffleTracks walks back and stays on the first of its
// walk, and random draws afresh as a track's end does. It moves so however far into the track
// the session is: no rule restarts the track instead.
SessionCursor steppedBack(SessionOrder order, size_t count, size_t at, SessionCursor cursor,
                          const SessionRandom& random) {
    switch (order) {
        case SessionOrder::inOrder:
            cursor.at = at == 0 ? 0 : at - 1;
            break;
        case SessionOrder::repeatAll:
        case SessionOrder::repeatOne:
            cursor.at = (at + count - 1) % count;
            break;
        case SessionOrder::shuffleTracks:
            if (cursor.walked > 0)
                --cursor.walked;
            if (cursor.walked < cursor.walk.size())
                cursor.at = cursor.walk[cursor.walked];
            break;
        case SessionOrder::random:
            cursor.at = drawnBeside(at, count, random);
            break;
    }

    return cursor;
}

}  // namespace

SessionCursor startedAt(SessionOrder order, size_t count, size_t row, const SessionRandom& random) {
    SessionCursor cursor;
    cursor.at = row;

    if (order == SessionOrder::shuffleTracks) {
        cursor.walk = allRows(count);
        std::swap(cursor.walk[0], cursor.walk[row]);
        shuffleFrom(cursor.walk, 1, random);
    }

    return cursor;
}

SessionCursor advanced(SessionOrder order, size_t count, SessionCursor from, Advance why,
                       const SessionRandom& random) {
    SessionCursor next = std::move(from);
    if (!next.at)
        return next;

    const size_t at = *next.at;

    if (why == Advance::previous)
        return steppedBack(order, count, at, std::move(next), random);

    // Provisional, waiting on the owner: a skip forward from inOrder's last row wraps to its first
    // rather than stopping, and repeatOne skips to the next row, wrapping, rather than repeating.
    // The other three skip as a track's end moves them.
    if (why == Advance::next &&
        (order == SessionOrder::inOrder || order == SessionOrder::repeatOne)) {
        next.at = (at + 1) % count;
        return next;
    }

    if (why == Advance::failed && order != SessionOrder::inOrder &&
        order != SessionOrder::repeatAll) {
        if (order == SessionOrder::shuffleTracks && !next.walk.empty()) {
            next.walked = (next.walked + 1) % next.walk.size();
            next.at = next.walk[next.walked];
        } else {
            next.at = (at + 1) % count;
        }
        return next;
    }

    switch (order) {
        case SessionOrder::inOrder:
            next.at = at + 1 < count ? std::optional<size_t>(at + 1) : std::nullopt;
            break;
        case SessionOrder::repeatAll:
            next.at = (at + 1) % count;
            break;
        case SessionOrder::repeatOne:
            break;
        case SessionOrder::shuffleTracks:
            if (next.walked + 1 < next.walk.size()) {
                ++next.walked;
            } else {
                next.walk = allRows(count);
                shuffleFrom(next.walk, 0, random);
                next.walked = 0;

                if (count > 1 && next.walk[0] == at)
                    std::swap(next.walk[0], next.walk[1 + random(count - 1)]);
            }
            next.at = next.walk[next.walked];
            break;
        case SessionOrder::random:
            next.at = drawnBeside(at, count, random);
            break;
    }

    return next;
}

std::optional<SessionOrder> sessionOrderNamed(const std::string& jeanMode) {
    const auto* const found =
        std::find_if(std::begin(kOrders), std::end(kOrders),
                     [&jeanMode](const OrderName& order) { return jeanMode == order.name; });

    if (found == std::end(kOrders))
        return std::nullopt;

    return found->order;
}

std::string modeNameOf(SessionOrder order) {
    const auto* const found =
        std::find_if(std::begin(kOrders), std::end(kOrders),
                     [order](const OrderName& named) { return named.order == order; });

    if (found == std::end(kOrders))
        return {};

    return found->name;
}

std::vector<std::string> sessionPlaybackModes() {
    std::vector<std::string> names;
    std::transform(std::begin(kOrders), std::end(kOrders), std::back_inserter(names),
                   [](const OrderName& order) { return std::string(order.name); });
    return names;
}

}  // namespace jean
