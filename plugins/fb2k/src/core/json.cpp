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

std::optional<uint32_t> uint32Of(const nlohmann::json& value) {
    if (!value.is_number_unsigned() || !fitsUint32(value.get<uint64_t>()))
        return std::nullopt;
    return value.get<uint32_t>();
}

std::optional<uint32_t> readUint32(const nlohmann::json& root, const char* key) {
    const auto found = root.find(key);
    if (found == root.end())
        return std::nullopt;
    return uint32Of(*found);
}

std::optional<uint64_t> readUint64(const nlohmann::json& root, const char* key) {
    const auto found = root.find(key);
    if (found == root.end() || !found->is_number_unsigned())
        return std::nullopt;
    return found->get<uint64_t>();
}

TextField readText(const nlohmann::json& root, const char* key, size_t limit, Need need) {
    const std::string named = std::string("'") + key + "'";
    const auto field = readString(root, key);

    if (field.wrongType)
        return {named + " must be a string", {}};

    if (need == Need::required && (!field.present || field.value.empty()))
        return {named + " is required", {}};

    if (field.value.size() > limit || !isPrintable(field.value)) {
        return {
            named + " must be printable text of at most " + std::to_string(limit) + " characters",
            {}};
    }

    return {{}, field.value};
}

}  // namespace jean
