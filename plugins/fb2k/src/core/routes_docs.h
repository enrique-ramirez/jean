#pragma once

#include "third_party/httplib.h"

#include "core/player.h"

#include <string>

namespace jean {

class DocsRoutes {
public:
    explicit DocsRoutes(const PageCalls& page);

    void addTo(httplib::Server& server) const;

private:
    void serve(const httplib::Request& req, httplib::Response& res,
               const std::string& embeddedPath) const;

    const PageCalls& page_;
};

}  // namespace jean
