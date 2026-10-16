#pragma once

#include "third_party/json.hpp"

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace jean::testing {

// The snapshot and delta format, read the way a browser would rather than the way the component
// wrote it: an offset that is right in the header and wrong in the blob reads as success
// everywhere else. contract/openapi.yaml, *The snapshot format*, is what this implements.
struct Wire {
    nlohmann::json header;
    std::string blob;
    size_t blobStart = 0;
};

Wire decode(const std::string& message);

uint64_t littleEndianAt(const std::string& bytes, size_t offset, size_t width);

// One placed integer array, whether it holds dictionary ids, dictionary ends or ordinals.
std::vector<uint32_t> ids(const Wire& wire, const nlohmann::json& placed);

std::vector<std::string> dictionary(const Wire& wire, const nlohmann::json& dict);

// A column read back row by row, which is what a client ends up drawing.
std::vector<std::string> column(const Wire& wire, const nlohmann::json& placed);

// An empty object when the snapshot has no such column, so a test can say so rather than crash.
nlohmann::json namedColumn(const Wire& wire, const std::string& name);

std::vector<std::string> columnNames(const nlohmann::json& header);

struct HeldColumn {
    std::vector<std::string> dictionary;
    std::vector<uint32_t> ids;
    size_t distinct = 0;
    bool hasUnresolved = false;
    bool allUnresolved = false;
};

struct HeldLibrary {
    uint64_t structure = 0;
    uint64_t revision = 0;
    size_t trackCount = 0;
    std::map<std::string, HeldColumn> spine;
    std::map<std::string, HeldColumn> columns;
};

HeldLibrary held(const Wire& snapshot);

void applyChanges(HeldLibrary& library, const Wire& changes);

void checkSameLibrary(const HeldLibrary& patched, const HeldLibrary& exported);

std::vector<std::vector<std::string>> rowsOf(const HeldLibrary& library,
                                             const std::vector<std::string>& declared);

}  // namespace jean::testing
