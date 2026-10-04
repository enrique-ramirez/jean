#include "core/requests_sessions.h"

#include "core/failures.h"
#include "core/json.h"

namespace jean {

SharingRequest parseSharing(const std::string& body) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refused<SharingRequest>(kSharedNotBoolean);

    const auto shared = document.value.find("shared");
    if (shared == document.value.end() || !shared->is_boolean())
        return refused<SharingRequest>(kSharedNotBoolean);

    SharingRequest request;
    request.shared = shared->get<bool>();
    return request;
}

}  // namespace jean
