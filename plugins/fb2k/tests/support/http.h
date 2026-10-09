#pragma once

#include "support/test_server.h"
#include "third_party/httplib.h"

#include <string>

namespace jean::testing {

std::string ticketFrom(const TestServer& server);

std::string scoped(const std::string& path, const std::string& session,
                   const std::string& deviceId);

int statusOf(const httplib::Result& response);

std::string tagOf(const httplib::Result& response);

void checkSameAnswer(const httplib::Result& asked, const httplib::Result& expected);

}  // namespace jean::testing
