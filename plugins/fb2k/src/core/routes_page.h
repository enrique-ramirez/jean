#pragma once

#include "third_party/httplib.h"

#include "core/player.h"

#include <mutex>
#include <set>
#include <string>

// Jean's own page: the build compiled into the component, and what an owner put in www/. See
// ARCHITECTURE.md, *Serving the page*.
namespace jean {

class PageRoutes {
public:
    explicit PageRoutes(const PageCalls& page);

    // Every GET and HEAD outside /api/ reaches this, from the pre-routing filter.
    void serve(const httplib::Request& req, httplib::Response& res) const;

private:
    void serveFromDisk(const httplib::Request& req, httplib::Response& res,
                       const std::string& resolved) const;

    void logReservedNameOnce(const std::string& name) const;

    const PageCalls& page_;

    mutable std::mutex reservedNameLock_;
    mutable std::set<std::string> loggedReservedNames_;
};

}  // namespace jean
