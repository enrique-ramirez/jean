#include "core/json.h"

#include <utility>

namespace jean {

namespace {

OptionalString absent() {
    return OptionalString{};
}

OptionalString notText() {
    OptionalString field;
    field.present = true;
    field.wrongType = true;
    return field;
}

OptionalString given(std::string value) {
    OptionalString field;
    field.value = std::move(value);
    field.present = true;
    return field;
}

}  // namespace

JsonObject parseJsonObject(const std::string& text) {
    JsonObject document;

    try {
        document.value = nlohmann::json::parse(text);
    } catch (const std::exception& e) {
        return {{}, std::string("could not parse it as JSON: ") + e.what()};
    }

    if (!document.value.is_object())
        return {{}, "expected a JSON object"};

    return document;
}

OptionalString readString(const nlohmann::json& root, const char* key) {
    const auto found = root.find(key);
    if (found == root.end())
        return absent();

    if (!found->is_string())
        return notText();

    return given(found->get<std::string>());
}

}  // namespace jean
