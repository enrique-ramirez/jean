#pragma once

#include "core/playlists.h"
#include "third_party/json.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

// The set of library ordinals or playlist positions a request names, in whichever one of the
// three forms it chose: `ordinals`, `runs` or `bitset`. See contract/openapi.yaml,
// `FillPlaylistRequest`.
namespace jean {

bool namesOneSelectionForm(const nlohmann::json& root);

struct SelectionResult {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    std::vector<uint32_t> ordinals;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// Every entry is below `limit`, or the whole set is refused. `runs` and `bitset` come back
// sorted ascending because neither can encode any other order; `ordinals` keeps the order given,
// since only it can carry one.
SelectionResult decodeSelection(const nlohmann::json& root, size_t limit);

}  // namespace jean
