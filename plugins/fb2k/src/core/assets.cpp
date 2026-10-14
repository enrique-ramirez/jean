#include "core/assets.h"

#include "core/text.h"

#include <algorithm>
#include <map>
#include <set>

namespace jean {

namespace {

template <typename Predicate>
bool anySegment(const std::string& path, Predicate matches) {
    size_t start = 0;
    while (start <= path.size()) {
        const auto slash = path.find('/', start);
        const auto stop = slash == std::string::npos ? path.size() : slash;
        if (matches(path.substr(start, stop - start)))
            return true;

        if (slash == std::string::npos)
            break;
        start = slash + 1;
    }

    return false;
}

bool hasDotSegment(const std::string& path) {
    return anySegment(path,
                      [](const std::string& segment) { return segment == "." || segment == ".."; });
}

bool hasTrailingDotOrSpaceSegment(const std::string& path) {
    return anySegment(path, [](const std::string& segment) {
        return !segment.empty() && (segment.back() == '.' || segment.back() == ' ');
    });
}

// Windows reads the superscript digits as 1, 2 and 3 in a port name, and drops the spaces
// between a stem and its extension before comparing.
bool isDeviceName(std::string stem) {
    while (!stem.empty() && stem.back() == ' ')
        stem.pop_back();

    const std::string name = toLower(stem);
    if (name == "con" || name == "prn" || name == "aux" || name == "nul" || name == "conin$" ||
        name == "conout$")
        return true;
    if (name.compare(0, 3, "com") != 0 && name.compare(0, 3, "lpt") != 0)
        return false;

    const std::string port = name.substr(3);
    return (port.size() == 1 && port[0] >= '0' && port[0] <= '9') || port == "\xC2\xB9" ||
           port == "\xC2\xB2" || port == "\xC2\xB3";
}

// Windows opens a device for any path segment whose stem is a DOS device name, whatever its
// extension or directory: `www\con.js` is the console, not a file.
bool hasDeviceNameSegment(const std::string& path) {
    return anySegment(path, [](const std::string& segment) {
        return isDeviceName(segment.substr(0, segment.find('.')));
    });
}

std::string extensionOf(const std::string& path) {
    const auto slash = path.find_last_of('/');
    const std::string name = slash == std::string::npos ? path : path.substr(slash + 1);

    const auto dot = name.find_last_of('.');
    return dot == std::string::npos ? std::string() : name.substr(dot);
}

std::string firstSegment(const std::string& path) {
    const auto slash = path.find('/');
    return slash == std::string::npos ? path : path.substr(0, slash);
}

constexpr char kAssetsPrefix[] = "assets/";
constexpr char kLocalesPrefix[] = "locales/";

const std::map<std::string, std::string>& pageTypes() {
    static const std::map<std::string, std::string> table{
        {".html", "text/html; charset=utf-8"}, {".js", "text/javascript"}, {".css", "text/css"},
        {".json", "application/json"},         {".svg", "image/svg+xml"},  {".woff2", "font/woff2"},
    };

    return table;
}

}  // namespace

std::optional<std::string> resolvePagePath(const std::string& requestPath) {
    if (requestPath.empty() || requestPath.front() != '/')
        return std::nullopt;

    std::string relative = requestPath.substr(1);
    if (relative.empty())
        relative = "index.html";

    if (relative.front() == '/')
        return std::nullopt;

    if (relative.find(':') != std::string::npos || relative.find('\\') != std::string::npos ||
        relative.find('\0') != std::string::npos) {
        return std::nullopt;
    }

    if (hasDotSegment(relative))
        return std::nullopt;

    if (hasTrailingDotOrSpaceSegment(relative))
        return std::nullopt;

    if (hasDeviceNameSegment(relative))
        return std::nullopt;

    return relative;
}

std::optional<std::string> pageContentType(const std::string& path) {
    const auto& types = pageTypes();
    const auto found = types.find(extensionOf(path));
    if (found == types.end())
        return std::nullopt;

    return found->second;
}

bool pageIsLongCached(const std::string& path) {
    return path.rfind(kAssetsPrefix, 0) == 0;
}

std::string pageTag(std::string_view bytes) {
    return eTagFor(bytes);
}

std::optional<std::string> interfaceContentType(const std::string& path) {
    static const std::map<std::string, std::string> kTypes = [] {
        std::map<std::string, std::string> table = pageTypes();
        table.insert({
            {".png", "image/png"},
            {".jpg", "image/jpeg"},
            {".webp", "image/webp"},
            {".ico", "image/vnd.microsoft.icon"},
            {".gif", "image/gif"},
            {".woff", "font/woff"},
            {".ttf", "font/ttf"},
            {".txt", "text/plain"},
            {".webmanifest", "application/manifest+json"},
        });
        return table;
    }();

    const auto found = kTypes.find(extensionOf(path));
    if (found == kTypes.end())
        return std::nullopt;

    return found->second;
}

std::optional<std::string_view> findEmbeddedFile(std::span<const EmbeddedFile> files,
                                                 std::string_view path) {
    const auto found = std::find_if(files.begin(), files.end(),
                                    [path](const EmbeddedFile& file) { return file.path == path; });
    if (found == files.end())
        return std::nullopt;

    return found->bytes;
}

std::vector<std::string> embeddedRootNames(std::span<const EmbeddedFile> files) {
    std::set<std::string> names;
    for (const auto& file : files)
        names.emplace(file.path.substr(0, file.path.find('/')));

    return {names.begin(), names.end()};
}

bool isWithin(const std::filesystem::path& root, const std::filesystem::path& candidate) {
    auto rootPart = root.begin();
    auto candidatePart = candidate.begin();
    for (; rootPart != root.end(); ++rootPart, ++candidatePart) {
        if (candidatePart == candidate.end() || *candidatePart != *rootPart)
            return false;
    }

    return true;
}

PageRoute routePage(const std::string& resolvedPath, const std::vector<std::string>& pageNames) {
    if (resolvedPath.rfind(kLocalesPrefix, 0) == 0)
        return {PageRouteKind::diskLocale, {}, resolvedPath};

    const std::string name = firstSegment(resolvedPath);
    const bool reserved =
        equalsIgnoringCase(name, "api") ||
        std::any_of(pageNames.begin(), pageNames.end(),
                    [&name](const std::string& root) { return equalsIgnoringCase(name, root); });
    if (reserved)
        return {PageRouteKind::reserved, name, {}};

    if (name.size() == resolvedPath.size())
        return {PageRouteKind::folderRoot, name, {}};

    const bool namesDirectory = resolvedPath.back() == '/';
    return {PageRouteKind::folderFile, name,
            namesDirectory ? resolvedPath + "index.html" : resolvedPath};
}

}  // namespace jean
