#include "core/library_credits.h"
#include "core/library_entities.h"
#include "core/library_groups.h"
#include "core/library_questions.h"
#include "core/library_sets.h"
#include "core/ordinal_sets.h"
#include "core/text.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdlib>
#include <iterator>
#include <numeric>
#include <optional>
#include <string>
#include <utility>
#include <vector>

using nlohmann::json;

namespace jean {

namespace {

constexpr double kExactTitle = 4000;
constexpr double kPrefix = 3000;
constexpr double kWordStart = 2000;
constexpr double kSubstring = 1000;

constexpr std::array<double, kSearchedColumnCount> kFieldWeights{1.0, 0.85, 0.85, 0.6, 0.85};

constexpr double kExactEntity = 6000;
constexpr double kPrefixEntity = 5000;
constexpr double kWordEntity = 4000;

constexpr int64_t kMaxCloseness = 999;

double closenessOf(size_t textLength, size_t queryLength) {
    const auto text = static_cast<int64_t>(textLength);
    const auto query = static_cast<int64_t>(queryLength);
    return static_cast<double>(std::max<int64_t>(0, kMaxCloseness - std::abs(text - query)));
}

double fieldScore(std::string_view text, std::string_view token, size_t tokenLength) {
    const size_t first = text.find(token);
    if (first == std::string_view::npos)
        return 0;

    const double closeness = closenessOf(utf16Length(text), tokenLength);
    if (first == 0)
        return (text.size() == token.size() ? kExactTitle : kPrefix) + closeness;

    for (size_t at = first; at != std::string_view::npos; at = text.find(token, at + 1)) {
        if (!endsInLetterOrNumber(text, at))
            return kWordStart + closeness;
    }
    return kSubstring + closeness;
}

double keyScore(const EntityKey& key, const std::string& query, size_t queryLength) {
    const double closeness = closenessOf(key.length, queryLength);
    if (key.squashed == query)
        return kExactEntity + closeness;
    if (key.squashed.starts_with(query))
        return kPrefixEntity + closeness;
    const bool startsAWord =
        std::any_of(key.words.begin(), key.words.end(),
                    [&](const std::string& word) { return word.starts_with(query); });
    return startsAWord ? kWordEntity + closeness : 0;
}

template <class Entity>
double entityScore(const Entity& entity, const std::string& query, size_t queryLength) {
    const double byName = keyScore(entity.match, query, queryLength);
    if constexpr (requires { entity.sortMatch; }) {
        if (entity.sortMatch)
            return std::max(byName, keyScore(*entity.sortMatch, query, queryLength));
    }
    return byName;
}

struct QueryWords {
    std::vector<std::string> distinct;
    std::vector<size_t> sequence;
};

QueryWords queryWordsOf(const std::vector<std::string>& words) {
    QueryWords query;
    for (const std::string& word : words) {
        auto at = std::find(query.distinct.begin(), query.distinct.end(), word);
        if (at == query.distinct.end()) {
            query.distinct.push_back(word);
            at = std::prev(query.distinct.end());
        }
        const auto index = static_cast<size_t>(at - query.distinct.begin());
        query.sequence.push_back(index);
    }
    return query;
}

struct Field {
    const std::vector<std::string>* texts = nullptr;
    const std::vector<uint32_t>* ids = nullptr;
    double weight = 1;

    const std::string& textOf(size_t row) const { return (*texts)[ids ? (*ids)[row] : 0]; }
};

std::array<Field, kSearchedColumnCount> fieldsOf(const Snapshot& snapshot,
                                                 const LibraryRoles& roles,
                                                 const SearchText& text) {
    const auto searched = searchedColumns(roles);
    std::array<Field, kSearchedColumnCount> fields;
    for (size_t at = 0; at < fields.size(); ++at) {
        fields[at].texts = &text.folded[at];
        if (const std::optional<size_t> role = searched[at])
            fields[at].ids = &snapshot.columns[*role].ids;
        fields[at].weight = kFieldWeights[at];
    }
    return fields;
}

template <class Answer, class Compute>
std::vector<Answer> perRow(const Field& field, const std::vector<uint32_t>& rows, Compute compute) {
    const auto& texts = *field.texts;
    std::vector<Answer> answers(rows.size());
    if (rows.size() >= texts.size()) {
        std::vector<Answer> table(texts.size());
        std::transform(texts.begin(), texts.end(), table.begin(), compute);
        for (size_t at = 0; at < rows.size(); ++at)
            answers[at] = table[field.ids ? (*field.ids)[rows[at]] : 0];
    } else {
        for (size_t at = 0; at < rows.size(); ++at)
            answers[at] = compute(field.textOf(rows[at]));
    }
    return answers;
}

std::vector<uint32_t> rowsMatchingEveryWord(const std::array<Field, kSearchedColumnCount>& fields,
                                            const QueryWords& query, size_t rows) {
    std::vector<uint32_t> left(rows);
    std::iota(left.begin(), left.end(), uint32_t{0});

    for (const std::string& word : query.distinct) {
        if (left.empty())
            break;

        std::vector<char> hit(left.size(), 0);
        for (const Field& field : fields) {
            const std::vector<char> holds = perRow<char>(field, left, [&](const std::string& text) {
                return static_cast<char>(text.find(word) != std::string::npos ? 1 : 0);
            });
            std::transform(
                hit.begin(), hit.end(), holds.begin(), hit.begin(),
                [](char had, char has) { return static_cast<char>(had != 0 || has != 0 ? 1 : 0); });
        }

        size_t kept = 0;
        for (size_t at = 0; at < left.size(); ++at) {
            if (hit[at] != 0)
                left[kept++] = left[at];
        }
        left.resize(kept);
    }
    return left;
}

std::vector<double> bestScores(const std::array<Field, kSearchedColumnCount>& fields,
                               const std::string& word, const std::vector<uint32_t>& rows) {
    const size_t length = utf16Length(word);
    std::vector<double> best(rows.size(), 0);
    for (const Field& field : fields) {
        const std::vector<double> scores = perRow<double>(
            field, rows,
            [&](const std::string& text) { return fieldScore(text, word, length) * field.weight; });
        std::transform(best.begin(), best.end(), scores.begin(), best.begin(),
                       [](double had, double has) { return std::max(had, has); });
    }
    return best;
}

json bestOf(const std::vector<uint32_t>& matched,
            const std::array<Field, kSearchedColumnCount>& fields, const QueryWords& query,
            size_t limit) {
    std::vector<double> totals(matched.size(), 0);
    std::vector<std::vector<double>> scoresOfWord(query.distinct.size());
    for (const size_t word : query.sequence) {
        std::vector<double>& scores = scoresOfWord[word];
        if (scores.empty())
            scores = bestScores(fields, query.distinct[word], matched);
        for (size_t at = 0; at < totals.size(); ++at)
            totals[at] += scores[at];
    }

    struct Scored {
        double score;
        size_t position;
    };
    std::vector<Scored> ranked;
    ranked.reserve(matched.size());
    for (size_t position = 0; position < matched.size(); ++position)
        ranked.push_back({totals[position], position});

    const size_t kept = std::min(limit, ranked.size());
    std::partial_sort(ranked.begin(), ranked.begin() + static_cast<std::ptrdiff_t>(kept),
                      ranked.end(), [](const Scored& a, const Scored& b) {
                          return a.score != b.score ? a.score > b.score : a.position < b.position;
                      });

    json best = json::array();
    for (size_t at = 0; at < kept; ++at)
        best.push_back(matched[ranked[at].position]);
    return best;
}

template <class Entity>
struct Ranked {
    size_t total = 0;
    std::vector<const Entity*> top;
};

template <class Entity>
Ranked<Entity> rankedEntities(const std::vector<Entity>& entities, const std::string& query,
                              size_t limit) {
    Ranked<Entity> ranked;
    if (query.empty())
        return ranked;

    struct Scored {
        double score;
        size_t place;
    };
    const size_t queryLength = utf16Length(query);
    std::vector<Scored> admitted;
    for (size_t place = 0; place < entities.size(); ++place) {
        const double score = entityScore(entities[place], query, queryLength);
        if (score >= kWordEntity)
            admitted.push_back({score, place});
    }

    const auto before = [&](const Scored& a, const Scored& b) {
        if (a.score != b.score)
            return a.score > b.score;
        const uint32_t one = entities[a.place].trackCount;
        const uint32_t other = entities[b.place].trackCount;
        return one != other ? one > other : a.place < b.place;
    };
    const size_t kept = std::min(limit, admitted.size());
    std::partial_sort(admitted.begin(), admitted.begin() + static_cast<std::ptrdiff_t>(kept),
                      admitted.end(), before);
    ranked.total = admitted.size();
    for (size_t at = 0; at < kept; ++at)
        ranked.top.push_back(&entities[admitted[at].place]);
    return ranked;
}

json sectionOf(size_t total, json top) {
    return {{"total", total}, {"top", std::move(top)}};
}

json coverOf(const Snapshot& snapshot, std::optional<uint32_t> row) {
    return row ? json(pathOf(snapshot, *row)) : json(nullptr);
}

json artistsSection(const Snapshot& snapshot, const ArtistEntities& artists,
                    const std::string& query, size_t limit) {
    const auto ranked = rankedEntities(artists.entities, query, limit);
    json top = json::array();
    for (const ArtistEntities::Entity* artist : ranked.top) {
        top.push_back({{"name", artist->name},
                       {"trackCount", artist->trackCount},
                       {"guestCount", artist->guestCount},
                       {"albumCount", artist->albumCount},
                       {"cover", coverOf(snapshot, artist->coverRow)}});
    }
    return sectionOf(ranked.total, std::move(top));
}

json albumsSection(const Snapshot& snapshot, const AlbumEntities& albums, const std::string& query,
                   size_t limit) {
    const auto ranked = rankedEntities(albums.entities, query, limit);
    json top = json::array();
    for (const AlbumEntities::Entity* album : ranked.top) {
        top.push_back({{"album", album->album},
                       {"artist", album->artist ? json(*album->artist) : json(nullptr)},
                       {"trackCount", album->trackCount},
                       {"cover", coverOf(snapshot, album->coverRow)}});
    }
    return sectionOf(ranked.total, std::move(top));
}

json genresSection(const GenreEntities& genres, const std::string& query, size_t limit) {
    const auto ranked = rankedEntities(genres.entities, query, limit);
    json top = json::array();
    for (const GenreEntities::Entity* genre : ranked.top)
        top.push_back({{"name", genre->name}, {"trackCount", genre->trackCount}});
    return sectionOf(ranked.total, std::move(top));
}

bool namesAMatchedTrack(const Snapshot& snapshot, const LibraryRoles& roles, const SearchText& text,
                        const std::string& query, const std::vector<uint32_t>& matched) {
    const auto& titles = text.folded[kSearchedTitle];
    std::vector<char> namesIt(titles.size());
    std::transform(titles.begin(), titles.end(), namesIt.begin(),
                   [&](const std::string& title) { return title == query ? 1 : 0; });
    const char none = namesIt.front();
    const auto named = perValue(snapshot, roles.title, std::move(namesIt), none);
    return std::any_of(matched.begin(), matched.end(),
                       [&](uint32_t row) { return named.of(row) != 0; });
}

}  // namespace

json LibraryQuestions::search(const Snapshot& snapshot, const LibraryRoles& roles,
                              std::string_view query, size_t limit, size_t entityLimit,
                              bool splitsCredits) {
    json answer = {{"structure", snapshot.structure},
                   {"revision", snapshot.revision},
                   {"matched", nullptr},
                   {"matchCount", 0},
                   {"figures", figuresDocument({})},
                   {"best", json::array()},
                   {"artists", sectionOf(0, json::array())},
                   {"albums", sectionOf(0, json::array())},
                   {"genres", sectionOf(0, json::array())},
                   {"namesATrack", false}};

    const size_t rows = snapshot.trackCount();
    if (rows == 0)
        return answer;

    const SearchParts parts = searchPartsFor(snapshot, roles, splitsCredits);
    std::vector<std::string> words = foldedWords(query);
    const bool glyphic = searchesMarks(query);
    const std::shared_ptr<const SearchText> text =
        glyphic ? glyphTextFor(snapshot, roles) : parts.text;
    if (glyphic)
        words = {glyphs(query)};

    std::vector<uint32_t> matched;
    if (!words.empty()) {
        const QueryWords asked = queryWordsOf(words);
        const std::array<Field, kSearchedColumnCount> fields = fieldsOf(snapshot, roles, *text);
        matched = rowsMatchingEveryWord(fields, asked, rows);
        answer["matched"] = ordinalSetDocument(matched, rows);
        answer["matchCount"] = matched.size();
        answer["figures"] = figuresDocument(figuresOver(snapshot, roles, matched));
        answer["best"] = bestOf(matched, fields, asked, limit);
    }

    const std::string_view wanted = ecmaTrimmed(query);
    if (wanted.empty())
        return answer;

    const std::string key = nameKey(wanted);
    answer["artists"] = artistsSection(snapshot, *parts.artists, key, entityLimit);
    answer["albums"] = albumsSection(snapshot, *parts.albums, key, entityLimit);
    answer["genres"] = genresSection(*parts.genres, key, entityLimit);
    answer["namesATrack"] =
        !matched.empty() && namesAMatchedTrack(snapshot, roles, *text,
                                               glyphic ? glyphs(wanted) : fold(wanted), matched);
    return answer;
}

}  // namespace jean
