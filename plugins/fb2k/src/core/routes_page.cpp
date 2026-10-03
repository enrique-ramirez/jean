#include "core/routes_page.h"

#include "core/assets.h"
#include "core/http_responses.h"
#include "core/log.h"
#include "core/text.h"

#include <string_view>
#include <utility>

namespace jean {

namespace {

// See ARCHITECTURE.md, *Serving the page*, for why this and pageIsLongCached differ.
constexpr char kPageRevalidate[] = "no-cache";
constexpr char kPageForAYear[] = "public, max-age=31536000, immutable";

// ui/src/domain/artist/artistInfo.ts reaches the three hosts of artist information, and
// ui/src/features/now-playing/lrclib.ts reaches LRCLIB; no other file reaches beyond this origin.
constexpr char kPageContentPolicy[] =
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; "
    "media-src 'self' blob:; font-src 'self'; "
    "connect-src 'self' https://musicbrainz.org https://www.wikidata.org https://en.wikipedia.org "
    "https://lrclib.net; "
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

constexpr char kPagePermissions[] = "camera=(), microphone=(), geolocation=()";

void guardPage(httplib::Response& res) {
    res.set_header("Content-Security-Policy", kPageContentPolicy);
    res.set_header("X-Frame-Options", "DENY");
    res.set_header("Referrer-Policy", "no-referrer");
    res.set_header("Cross-Origin-Opener-Policy", "same-origin");
    res.set_header("Permissions-Policy", kPagePermissions);
}

bool answeredAsHeld(const httplib::Request& req, httplib::Response& res, std::string_view bytes) {
    const auto tag = pageTag(bytes);
    res.set_header("Cache-Control", kPageRevalidate);
    res.set_header("ETag", tag);

    if (!alreadyHolds(req, tag))
        return false;

    res.status = 304;
    return true;
}

}  // namespace

PageRoutes::PageRoutes(const PageCalls& page) : page_(page) {}

void PageRoutes::serve(const httplib::Request& req, httplib::Response& res) const {
    guardPage(res);

    const auto resolved = resolvePagePath(req.path);
    if (!resolved) {
        res.status = 404;
        return;
    }

    const auto type = pageContentType(*resolved);
    const auto bytes = type ? page_.read(*resolved) : std::nullopt;
    if (!bytes) {
        serveFromDisk(req, res, *resolved);
        return;
    }

    if (pageIsLongCached(*resolved))
        res.set_header("Cache-Control", kPageForAYear);
    else if (answeredAsHeld(req, res, *bytes))
        return;

    res.status = 200;
    sendLongLived(req, res, *bytes, *type);
}

void PageRoutes::serveFromDisk(const httplib::Request& req, httplib::Response& res,
                               const std::string& resolved) const {
    const auto route = routePage(resolved, page_.names);

    if (route.kind == PageRouteKind::reserved) {
        logReservedNameOnce(route.name);
        res.status = 404;
        return;
    }

    if (!page_.readDisk) {
        res.status = 404;
        return;
    }

    if (route.kind == PageRouteKind::folderRoot) {
        const auto folder = page_.readDisk(route.name);
        if (folder.kind != DiskPage::Kind::directory) {
            res.status = 404;
            return;
        }

        res.status = 301;
        res.set_header("Location", "/" + httplib::encode_path_component(route.name) + "/");
        return;
    }

    const auto type = route.kind == PageRouteKind::diskLocale
                          ? pageContentType(route.diskPath)
                          : interfaceContentType(route.diskPath);
    if (!type) {
        res.status = 404;
        return;
    }

    auto page = page_.readDisk(route.diskPath);
    if (page.kind != DiskPage::Kind::file) {
        res.status = 404;
        return;
    }

    if (answeredAsHeld(req, res, page.bytes))
        return;

    res.status = 200;
    res.set_content(std::move(page.bytes), *type);
}

void PageRoutes::logReservedNameOnce(const std::string& name) const {
    const std::lock_guard<std::mutex> lock(reservedNameLock_);
    if (!loggedReservedNames_.insert(toLower(name)).second)
        return;

    logInfo("requests under \"" + name +
            "\" are never answered from www/, because that name is one of Jean's own, or is api");
}

}  // namespace jean
