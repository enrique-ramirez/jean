#include "core/routes_docs.h"

#include "core/assets.h"
#include "core/failures.h"
#include "core/http_responses.h"

#include <optional>
#include <string>

namespace jean {

namespace {

constexpr char kContractFile[] = "api/openapi.yaml";
constexpr char kDocsPrefix[] = "api/docs/";
constexpr char kDocsPage[] = "api/docs/index.html";

// Swagger UI draws its icons from data: URLs, which the policy Jean's own page carries in
// core/routes_page.cpp does not allow.
constexpr char kDocsContentPolicy[] =
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; "
    "form-action 'self'; frame-ancestors 'none'";

}  // namespace

DocsRoutes::DocsRoutes(const PageCalls& page) : page_(page) {}

void DocsRoutes::addTo(httplib::Server& server) const {
    server.Get("/api/openapi.yaml", [this](const httplib::Request& req, httplib::Response& res) {
        serve(req, res, kContractFile);
    });

    server.Get("/api/docs", [this](const httplib::Request& req, httplib::Response& res) {
        serve(req, res, kDocsPage);
    });

    server.Get(R"(/api/docs/(.*))", [this](const httplib::Request& req, httplib::Response& res) {
        const std::string file = req.matches[1].str();
        serve(req, res, file.empty() ? std::string(kDocsPage) : kDocsPrefix + file);
    });
}

void DocsRoutes::serve(const httplib::Request& req, httplib::Response& res,
                       const std::string& embeddedPath) const {
    guardDocument(res, kDocsContentPolicy);

    const auto type = pageContentType(embeddedPath);
    const auto bytes = type && page_.read ? page_.read(embeddedPath) : std::nullopt;
    if (!bytes) {
        respondError(res, 404, kNoSuchDocsFile);
        return;
    }

    sendRevalidated(req, res, *bytes, *type);
}

}  // namespace jean
