#include "core/library_credits.h"

#include "core/library_groups.h"
#include "core/text.h"

#include <algorithm>
#include <array>
#include <iterator>

namespace jean {

namespace {

bool wordAt(std::string_view text, size_t at, std::string_view word) {
    if (text.size() - at < word.size())
        return false;
    return std::equal(word.begin(), word.end(), text.begin() + static_cast<std::ptrdiff_t>(at),
                      [](char expected, char actual) {
                          const char lower = actual >= 'A' && actual <= 'Z'
                                                 ? static_cast<char>(actual - 'A' + 'a')
                                                 : actual;
                          return expected == lower;
                      });
}

struct Separator {
    std::string_view word;
    bool dotted;
};

std::optional<size_t> separatorEnd(std::string_view text, size_t from,
                                   std::span<const Separator> words) {
    const size_t start = endOfEcmaWhitespace(text, from);
    if (start == from)
        return std::nullopt;

    for (const Separator& separator : words) {
        if (!wordAt(text, start, separator.word))
            continue;
        const size_t after = start + separator.word.size();
        if (separator.dotted && after < text.size() && text[after] == '.') {
            if (const size_t end = endOfEcmaWhitespace(text, after + 1); end > after + 1)
                return end;
        }
        if (const size_t end = endOfEcmaWhitespace(text, after); end > after)
            return end;
    }
    return std::nullopt;
}

constexpr std::array kFeaturing{Separator{"feat", true}, Separator{"ft", true},
                                Separator{"featuring", false}};

constexpr std::array kJoiners{Separator{"&", false},        Separator{"x", false},
                              Separator{"\xC3\x97", false}, Separator{"vs", true},
                              Separator{"with", false},     Separator{"feat", true},
                              Separator{"ft", true},        Separator{"featuring", false}};

struct Span {
    size_t start = 0;
    size_t end = 0;
};

std::optional<Span> commaJoiner(std::string_view text, size_t from) {
    const size_t comma = endOfEcmaWhitespace(text, from);
    if (comma >= text.size() || text[comma] != ',')
        return std::nullopt;
    const size_t end = endOfEcmaWhitespace(text, comma + 1);
    return end > comma + 1 ? std::optional(Span{from, end}) : std::nullopt;
}

std::optional<Span> nextJoiner(std::string_view text, size_t from) {
    for (size_t at = from; at < text.size(); ++at) {
        if (const auto comma = commaJoiner(text, at))
            return comma;
        if (const auto end = separatorEnd(text, at, kJoiners))
            return Span{at, *end};
    }
    return std::nullopt;
}

std::optional<Span> nextFeaturing(std::string_view text, size_t from) {
    for (size_t at = from; at < text.size(); ++at) {
        if (const auto end = separatorEnd(text, at, kFeaturing))
            return Span{at, *end};
    }
    return std::nullopt;
}

template <class Next>
std::vector<std::string_view> splitBy(std::string_view text, Next next) {
    std::vector<std::string_view> parts;
    size_t from = 0;
    while (const auto found = next(text, from)) {
        parts.push_back(text.substr(from, found->start - from));
        from = found->end;
    }
    parts.push_back(text.substr(from));
    return parts;
}

std::vector<std::string_view> splitAround(std::string_view text, std::string_view delimiter) {
    std::vector<std::string_view> parts;
    size_t from = 0;
    for (size_t at = text.find(delimiter); at != std::string_view::npos;
         at = text.find(delimiter, from)) {
        parts.push_back(text.substr(from, at - from));
        from = at + delimiter.size();
    }
    parts.push_back(text.substr(from));
    return parts;
}

}  // namespace

std::vector<std::string_view> splitOnValues(std::string_view text) {
    return splitAround(text, std::string_view(&kMultiValueSeparator, 1));
}

size_t valueCount(std::string_view raw) {
    return static_cast<size_t>(std::count(raw.begin(), raw.end(), kMultiValueSeparator)) + 1;
}

std::string collapseRepeatedTag(std::string_view value) {
    const std::vector<std::string_view> parts = splitAround(value, ", ");
    if (parts.size() < 2)
        return std::string(value);

    const std::string first = tagKey(parts.front());
    const bool repeated = std::all_of(parts.begin(), parts.end(),
                                      [&](std::string_view part) { return tagKey(part) == first; });
    return std::string(repeated ? parts.front() : value);
}

CreditedArtists creditedArtists(std::string_view artist) {
    CreditedArtists credited;
    if (artist.empty())
        return credited;

    const std::vector<std::string_view> names = splitBy(artist, nextFeaturing);
    for (const std::string_view name : names) {
        std::string collapsed = collapseRepeatedTag(ecmaTrimmed(name));
        if (collapsed.empty())
            continue;
        if (!credited.lead)
            credited.lead = std::move(collapsed);
        else
            credited.guests.push_back(std::move(collapsed));
    }
    return credited;
}

namespace {

using Members = std::vector<Member>;

std::vector<Member> partsOf(std::string_view credit) {
    std::vector<Member> parts;
    const auto add = [&](std::string_view text, bool isGuest) {
        for (const std::string_view piece : splitBy(text, nextJoiner)) {
            const std::string_view name = ecmaTrimmed(piece);
            if (!name.empty())
                parts.push_back({std::string(name), tagKey(name), isGuest});
        }
    };

    const auto featuring = nextFeaturing(credit, 0);
    add(credit.substr(0, featuring ? featuring->start : credit.size()), false);
    if (featuring)
        add(credit.substr(featuring->end), true);
    return parts;
}

bool isGuestKey(const Members& parts, const std::string& key) {
    return std::any_of(parts.begin(), parts.end(),
                       [&](const Member& part) { return part.isGuest && part.key == key; });
}

Members membersFromNames(std::string_view names, const Members& parts) {
    Members members;
    for (const std::string_view piece : splitOnValues(names)) {
        const std::string_view name = ecmaTrimmed(piece);
        if (name.empty())
            continue;
        std::string key = tagKey(name);
        const bool isGuest = isGuestKey(parts, key);
        members.push_back({std::string(name), std::move(key), isGuest});
    }
    return members;
}

Members membersFromIds(std::span<const std::string_view> ids, const Members& parts,
                       const CreditLessons& lessons) {
    Members members;
    for (size_t at = 0; at < ids.size(); ++at) {
        const auto learned = lessons.nameOfId.find(std::string(ids[at]));
        const bool known = learned != lessons.nameOfId.end();
        if (parts.size() == ids.size()) {
            const Named& named = known ? learned->second : Named{parts[at].name, parts[at].key};
            members.push_back({named.name, named.key, parts[at].isGuest});
        } else if (known) {
            members.push_back({learned->second.name, learned->second.key,
                               isGuestKey(parts, learned->second.key)});
        }
    }
    return members;
}

Members membersFromLessons(const Members& parts, const CreditLessons& lessons) {
    Members members;
    std::copy_if(parts.begin(), parts.end(), std::back_inserter(members),
                 [&](const Member& part) { return lessons.standalone.contains(part.key); });
    return members;
}

void learnFrom(const Snapshot& snapshot, std::optional<size_t> creditRole,
               std::optional<size_t> idsRole, CreditLessons& lessons) {
    if (!creditRole)
        return;

    const Column& credit = snapshot.columns[*creditRole];
    std::vector<std::optional<Named>> soleOf(credit.dictionary.values.size());
    std::vector<bool> met(soleOf.size(), false);
    for (const uint32_t id : credit.ids) {
        if (met[id])
            continue;
        met[id] = true;
        const std::string& value = credit.dictionary.values[id];
        if (!isPresent(value))
            continue;
        const CreditedArtists credited = creditedArtists(value);
        if (!credited.lead)
            continue;
        std::string name = collapseRepeatedTag(*credited.lead);
        std::string key = tagKey(name);
        lessons.standalone.insert(key);
        soleOf[id] = Named{std::move(name), std::move(key)};
    }

    if (!idsRole)
        return;

    const Column& ids = snapshot.columns[*idsRole];
    std::vector<uint8_t> single(ids.dictionary.values.size(), 0);
    for (size_t row = 0; row < ids.ids.size(); ++row) {
        const uint32_t idId = ids.ids[row];
        if (single[idId] == 0) {
            const std::string& raw = ids.dictionary.values[idId];
            single[idId] = isPresent(raw) && valueCount(raw) == 1 ? 1 : 2;
        }
        const auto& sole = soleOf[credit.ids[row]];
        if (single[idId] == 1 && sole)
            lessons.nameOfId.emplace(ids.dictionary.values[idId], *sole);
    }
}

}  // namespace

CreditLessons lessonsOf(const Snapshot& snapshot, const LibraryRoles& roles) {
    CreditLessons lessons;
    learnFrom(snapshot, roles.artist, roles.artistIds, lessons);
    learnFrom(snapshot, roles.albumArtist, roles.albumArtistIds, lessons);
    return lessons;
}

Members membersOf(std::string_view credit, std::optional<std::string_view> names,
                  std::optional<std::string_view> ids, const CreditLessons& lessons, bool guesses) {
    const Members parts = partsOf(credit);
    if (names && valueCount(*names) > 1)
        return membersFromNames(*names, parts);

    const std::vector<std::string_view> idList =
        ids ? splitOnValues(*ids) : std::vector<std::string_view>{};
    if (idList.size() > 1)
        return membersFromIds(idList, parts, lessons);
    if (idList.empty() && guesses && parts.size() >= 2)
        return membersFromLessons(parts, lessons);
    return {};
}

}  // namespace jean
