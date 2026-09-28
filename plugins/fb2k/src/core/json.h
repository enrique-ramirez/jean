#pragma once

#include "core/text.h"
#include "third_party/json.hpp"

#include <cstddef>
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

// Whether `key`'s text field is present, printable and within `limit`, folding the presence
// check `need` asks for into the one result. Shared by every route that reads a title, a key
// or a query, so what makes one of those acceptable is answered once rather than once per
// caller.
struct TextField {
    std::string why;
    std::string value;

    bool ok() const { return why.empty(); }
};

TextField readText(const nlohmann::json& root, const char* key, size_t limit, Need need);

}  // namespace jean
