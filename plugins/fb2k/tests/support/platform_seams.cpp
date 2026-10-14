#include "support/platform_seams.h"

#include "support/repository.h"

#include "third_party/doctest.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstddef>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string_view>
#include <system_error>

namespace jean::testing {

namespace {

constexpr char kSource[] = "plugins/fb2k/src";

constexpr std::array<std::string_view, 4> kPlatformMacros = {"_WIN32", "__APPLE__", "_MSC_VER",
                                                             "__linux__"};

constexpr std::array<std::string_view, 4> kLibraryPrefixes = {"foobar2000/", "pfc/", "ogg/",
                                                              "opus"};

// #import brings in Objective-C headers and, under MSVC, type libraries.
constexpr std::array<std::string_view, 2> kIncludeDirectives = {"include", "import"};

constexpr std::array<std::string_view, 2> kPlatformSuffixes = {"_mac.", "_win."};
constexpr std::array<std::string_view, 2> kPlatformExtensions = {".mm", ".rc"};

bool isWordChar(char letter) {
    return std::isalnum(static_cast<unsigned char>(letter)) != 0 || letter == '_';
}

bool holdsPlatformMacro(std::string_view text) {
    size_t at = 0;

    while (at < text.size()) {
        if (!isWordChar(text[at])) {
            ++at;
            continue;
        }

        const size_t begin = at;
        while (at < text.size() && isWordChar(text[at]))
            ++at;

        const std::string_view word = text.substr(begin, at - begin);
        if (std::find(kPlatformMacros.begin(), kPlatformMacros.end(), word) !=
            kPlatformMacros.end())
            return true;
    }

    return false;
}

bool isSystemHeader(std::string_view name) {
    if (name.find('.') == std::string_view::npos)
        return false;

    return std::none_of(kLibraryPrefixes.begin(), kLibraryPrefixes.end(),
                        [&](std::string_view prefix) { return name.starts_with(prefix); });
}

std::string_view skipBlanks(std::string_view text) {
    const size_t first = text.find_first_not_of(" \t");
    return first == std::string_view::npos ? std::string_view{} : text.substr(first);
}

size_t directiveLength(std::string_view line) {
    for (const std::string_view word : kIncludeDirectives) {
        if (line.starts_with(word))
            return word.size();
    }

    return 0;
}

std::string_view angleIncludeOf(std::string_view line) {
    line = skipBlanks(line);
    if (!line.starts_with('#'))
        return {};

    line = skipBlanks(line.substr(1));
    const size_t length = directiveLength(line);
    if (length == 0)
        return {};

    line = skipBlanks(line.substr(length));
    if (!line.starts_with('<'))
        return {};

    const size_t close = line.find('>');
    return close == std::string_view::npos ? std::string_view{} : line.substr(1, close - 1);
}

bool holdsSystemHeader(std::string_view text) {
    while (!text.empty()) {
        const size_t newline = text.find('\n');
        const std::string_view line = text.substr(0, newline);

        if (isSystemHeader(angleIncludeOf(line)))
            return true;

        if (newline == std::string_view::npos)
            break;
        text.remove_prefix(newline + 1);
    }

    return false;
}

bool isNamedForAPlatform(std::string_view path) {
    const size_t slash = path.rfind('/');
    const std::string_view name = slash == std::string_view::npos ? path : path.substr(slash + 1);

    const auto inName = [&](std::string_view part) {
        return name.find(part) != std::string_view::npos;
    };
    const auto endsName = [&](std::string_view extension) { return name.ends_with(extension); };

    return std::any_of(kPlatformSuffixes.begin(), kPlatformSuffixes.end(), inName) ||
           std::any_of(kPlatformExtensions.begin(), kPlatformExtensions.end(), endsName);
}

std::string readBinary(const std::filesystem::path& file, const std::string& shown) {
    std::ifstream in(file, std::ios::binary);
    REQUIRE_MESSAGE(in.is_open(), "cannot read ", shown);
    return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

}  // namespace

const char* seamName(Seam seam) {
    switch (seam) {
        case Seam::conditional:
            return "a platform conditional";
        case Seam::systemHeader:
            return "an operating system header";
        case Seam::platformName:
            return "a name for one platform";
    }
    return "";
}

std::set<Seam> seamsOf(const std::string& path, const std::string& text) {
    std::set<Seam> held;

    if (holdsPlatformMacro(text))
        held.insert(Seam::conditional);
    if (holdsSystemHeader(text))
        held.insert(Seam::systemHeader);
    if (isNamedForAPlatform(path))
        held.insert(Seam::platformName);

    return held;
}

std::map<std::string, std::set<Seam>> seamsUnderSource() {
    namespace fs = std::filesystem;

    const fs::path source = fs::path(repositoryRoot()) / kSource;
    std::error_code failed;
    const fs::recursive_directory_iterator walk(source, failed);
    REQUIRE_MESSAGE(!failed, "cannot read ", source.generic_string(), ": ", failed.message());

    std::map<std::string, std::set<Seam>> found;
    for (const fs::directory_entry& entry : walk) {
        if (!entry.is_regular_file(failed))
            continue;

        const std::string path =
            std::string(kSource) + '/' + entry.path().lexically_relative(source).generic_string();
        found[path] = seamsOf(path, readBinary(entry.path(), path));
    }

    return found;
}

}  // namespace jean::testing
