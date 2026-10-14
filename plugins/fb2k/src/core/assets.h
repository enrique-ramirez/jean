#pragma once

#include <filesystem>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

// What a request for Jean's own page meets on its way to a file: which path it names relative
// to the build root, whether that shape may be looked up at all, what a client is told the
// bytes are, and how long a browser may keep them. Pure: this half decides, and
// core/routes_page.cpp asks the seam and answers.
namespace jean {

// The path to ask the page seam for, relative to the build root and with no leading slash, for
// the HTTP path `requestPath`. Nullopt for anything the seam must never be asked to resolve: an
// empty result, a second leading slash left behind (as "//etc/passwd" does once the first is
// stripped), a ':' (a Windows drive letter or an alternate stream), a backslash, a NUL, a path
// segment that is "." or "..", or a segment (file name included) ending in a dot or a space,
// which Win32 path normalisation strips before the file is opened. A later seam reading the
// build from disk relies on this to never be handed an absolute or escaping path.
std::optional<std::string> resolvePagePath(const std::string& requestPath);

// The Content-Type to answer `path`'s extension with, keyed by a fixed table, or nullopt where
// the extension is not one this component serves.
std::optional<std::string> pageContentType(const std::string& path);

// See ARCHITECTURE.md, *Serving the page*, for why assets/ never needs asking about again.
bool pageIsLongCached(const std::string& path);

std::string pageTag(std::string_view bytes);

std::optional<std::string> interfaceContentType(const std::string& path);

enum class PageRouteKind {
    diskLocale,
    reserved,
    folderRoot,
    folderFile,
};

struct PageRoute {
    PageRouteKind kind;
    std::string name;
    std::string diskPath;
};

struct EmbeddedFile {
    std::string_view path;
    std::string_view bytes;
};

std::optional<std::string_view> findEmbeddedFile(std::span<const EmbeddedFile> files,
                                                 std::string_view path);

std::vector<std::string> embeddedRootNames(std::span<const EmbeddedFile> files);

bool isWithin(const std::filesystem::path& root, const std::filesystem::path& candidate);

PageRoute routePage(const std::string& resolvedPath, const std::vector<std::string>& pageNames);

}  // namespace jean
