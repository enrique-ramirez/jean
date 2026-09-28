#include "core/routes_page.h"

#include "core/assets.h"
#include "core/http_responses.h"
#include "core/log.h"
#include "core/text.h"

namespace jean {

namespace {

// See ARCHITECTURE.md, *Serving the page*, for why this and pageIsLongCached differ.
constexpr char kPageRevalidate[] = "no-cache";
constexpr char kPageForAYear[] = "public, max-age=31536000, immutable";

// ui/src/features/now-playing/artistInfo.ts is what reaches the three hosts beyond this origin.
constexpr char kPageContentPolicy[] =
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; "
    "media-src 'self' blob:; font-src 'self'; "
    "connect-src 'self' https://musicbrainz.org https://www.wikidata.org https://en.wikipedia.org; "
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

constexpr char kPagePermissions[] = "camera=(), microphone=(), geolocation=()";

void guardPage(httplib::Response& res) {
    res.set_header("Content-Security-Policy", kPageContentPolicy);
    res.set_header("X-Frame-Options", "DENY");
    res.set_header("Referrer-Policy", "no-referrer");
    res.set_header("Cross-Origin-Opener-Policy", "same-origin");
    res.set_header("Permissions-Policy", kPagePermissions);
}

void answerRevalidated(const httplib::Request& req, httplib::Response& res,
                       const std::string& bytes, const std::string& type) {
    const auto tag = pageTag(bytes);
    res.set_header("Cache-Control", kPageRevalidate);
    res.set_header("ETag", tag);

    if (alreadyHolds(req, tag)) {
        res.status = 304;
        return;
    }

    res.status = 200;
    res.set_content(bytes, type);
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

    if (pageIsLongCached(*resolved)) {
        res.set_header("Cache-Control", kPageForAYear);
        res.status = 200;
        res.set_content(*bytes, *type);
        return;
    }

    answerRevalidated(req, res, *bytes, *type);
}

void PageRoutes::serveFromDisk(const httplib::Request& req, httplib::Response& res,
                               const std::string& resolved) const {
    const auto route = routePage(resolved, page_.names);

    if (route.kind == PageRouteKind::Reserved) {
        logReservedNameOnce(route.name);
        res.status = 404;
        return;
    }

    if (!page_.readDisk) {
        res.status = 404;
        return;
    }

    if (route.kind == PageRouteKind::FolderRoot) {
        const auto folder = page_.readDisk(route.name);
        if (folder.kind != DiskPage::Kind::Directory) {
            res.status = 404;
            return;
        }

        res.status = 301;
        res.set_header("Location", "/" + httplib::encode_path_component(route.name) + "/");
        return;
    }

    const auto type = route.kind == PageRouteKind::DiskLocale
                          ? pageContentType(route.diskPath)
                          : interfaceContentType(route.diskPath);
    if (!type) {
        res.status = 404;
        return;
    }

    const auto page = page_.readDisk(route.diskPath);
    if (page.kind != DiskPage::Kind::File) {
        res.status = 404;
        return;
    }

    answerRevalidated(req, res, page.bytes, *type);
}

void PageRoutes::logReservedNameOnce(const std::string& name) const {
    const std::lock_guard<std::mutex> lock(reservedNameLock_);
    if (!loggedReservedNames_.insert(toLower(name)).second)
        return;

    logInfo("requests under \"" + name +
            "\" are never answered from www/, because that name is one of Jean's own, or is api");
}

}  // namespace jean
