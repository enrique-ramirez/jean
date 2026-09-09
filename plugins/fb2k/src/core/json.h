#pragma once

#include "third_party/json.hpp"

#include <string>

// Reading JSON that arrived from outside: an HTTP body, a hand-edited config file, a
// playlist property written by some other version of this component. None of it may
// throw, because every caller is either an HTTP handler or a headless start.
namespace jean {

struct JsonObject {
    nlohmann::json value = nlohmann::json::object();

    std::string error;

    bool ok() const { return error.empty(); }
};

JsonObject parseJsonObject(const std::string& text);

// `present` and `wrongType` are answered differently by every caller: one is "you did
// not say", the other is "you said something that is not text".
struct OptionalString {
    std::string value;
    bool present = false;
    bool wrongType = false;
};

OptionalString readString(const nlohmann::json& root, const char* key);

}  // namespace jean
