#include "support/http.h"

#include "third_party/doctest.h"
#include "third_party/json.hpp"

#include <string>

namespace jean::testing {

std::string ticketFrom(const TestServer& server) {
    const auto response = server.client().Post("/api/stream/ticket", "", "application/json");
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return nlohmann::json::parse(response->body)["ticket"].get<std::string>();
}

std::string scoped(const std::string& path, const std::string& session,
                   const std::string& deviceId) {
    std::string query;
    if (!session.empty())
        query += "session=" + session;
    if (!deviceId.empty())
        query += (query.empty() ? "" : "&") + std::string("deviceId=") + deviceId;
    return query.empty() ? path : path + "?" + query;
}

int statusOf(const httplib::Result& response) {
    return response ? response->status : 0;
}

std::string tagOf(const httplib::Result& response) {
    REQUIRE(response);
    REQUIRE(response->status == 200);
    auto tag = response->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());
    return tag;
}

void checkSameAnswer(const httplib::Result& asked, const httplib::Result& expected) {
    REQUIRE(asked);
    REQUIRE(expected);
    CHECK(asked->status == expected->status);
    CHECK(asked->body == expected->body);
}

}  // namespace jean::testing
