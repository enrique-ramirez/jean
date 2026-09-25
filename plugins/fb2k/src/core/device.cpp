#include "core/device.h"

#include "core/json.h"
#include "core/text.h"

#include <algorithm>
#include <utility>

namespace jean {

namespace {

std::string trimmed(std::string value) {
    const auto blank = [](unsigned char c) { return c == ' ' || c == '\t'; };

    value.erase(value.begin(), std::find_if_not(value.begin(), value.end(), blank));
    value.erase(std::find_if_not(value.rbegin(), value.rend(), blank).base(), value.end());
    return value;
}

std::string label(std::string value, size_t limit) {
    value = trimmed(std::move(value));
    if (value.size() > limit || !isPrintable(value))
        return {};
    return value;
}

DeviceIdentityRequest refuse(std::string why) {
    DeviceIdentityRequest request;
    request.refusal = std::move(why);
    return request;
}

std::string tooLong(const std::string& field, size_t limit) {
    return field + " may be at most " + std::to_string(limit) + " characters";
}

}  // namespace

DeviceIdentity sanitised(DeviceIdentity device) {
    device.id = label(std::move(device.id), kMaxDeviceIdLength);
    device.name = label(std::move(device.name), kMaxDeviceNameLength);
    return device;
}

DeviceIdentityRequest parseDeviceIdentity(const std::string& body) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuse("body is not a JSON object");

    const auto id = readString(document.value, "deviceId");
    const auto name = readString(document.value, "name");

    if (id.wrongType || name.wrongType)
        return refuse("deviceId and name must be text");

    if (id.value.size() > kMaxDeviceIdLength)
        return refuse(tooLong("deviceId", kMaxDeviceIdLength));

    if (name.value.size() > kMaxDeviceNameLength)
        return refuse(tooLong("name", kMaxDeviceNameLength));

    DeviceIdentityRequest request;
    request.device = DeviceIdentity{id.value, name.value};
    return request;
}

}  // namespace jean
