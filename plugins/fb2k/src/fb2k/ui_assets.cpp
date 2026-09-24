#include "fb2k/PCH.h"

#include "fb2k/ui_assets.h"

#include "fb2k/paths.h"
#include "fb2k/strings.h"

// scripts/embed-ui.ps1 writes this from the same walk of ui/dist that writes ui_assets.rc, so
// the ids FindResourceW is asked for here always name what that .rc actually embedded.
#include "fb2k/ui_assets_table.inc"

#include <filesystem>
#include <fstream>
#include <iterator>
#include <system_error>
#include <unordered_map>

namespace jean {

namespace {

const std::unordered_map<std::string, int>& uiAssetIds() {
    static const std::unordered_map<std::string, int> table = [] {
        std::unordered_map<std::string, int> built;
        for (const auto& entry : generated::kUiAssets)
            built.emplace(entry.path, entry.id);
        return built;
    }();

    return table;
}

// core_api::pathInProfile answers a "file://" path, and std::filesystem needs the form Windows
// itself resolves symlinks and junctions against.
std::filesystem::path nativePathOf(const std::string& profilePath) {
    pfc::string8 display;
    filesystem::g_get_display_path(profilePath.c_str(), display);
    return std::filesystem::path(toWide(toStd(display)));
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

}  // namespace

std::optional<std::string> readEmbeddedPage(const std::string& path) {
    const auto& ids = uiAssetIds();
    const auto found = ids.find(path);
    if (found == ids.end())
        return std::nullopt;

    const auto self = core_api::get_my_instance();
    const HRSRC resource =
        FindResourceW(self, MAKEINTRESOURCEW(found->second), generated::kUiAssetResourceType);
    if (!resource)
        return std::nullopt;

    const HGLOBAL loaded = LoadResource(self, resource);
    if (!loaded)
        return std::nullopt;

    const void* data = LockResource(loaded);
    if (!data)
        return std::nullopt;

    return std::string(static_cast<const char*>(data), SizeofResource(self, resource));
}

std::vector<std::string> embeddedPageNames() {
    return {std::begin(generated::kUiRootNames), std::end(generated::kUiRootNames)};
}

DiskPage readWwwPage(const std::string& path) {
    namespace fs = std::filesystem;

    std::error_code ec;
    const fs::path root = fs::canonical(nativePathOf(wwwDir()), ec);
    if (ec)
        return {};

    const fs::path requested = nativePathOf(wwwDir()) / fs::path(toWide(path));
    const fs::path resolved = fs::canonical(requested, ec);
    if (ec || !isWithin(root, resolved))
        return {};

    std::error_code statEc;
    if (fs::is_directory(resolved, statEc))
        return {DiskPage::Kind::Directory, {}};

    if (!fs::is_regular_file(resolved, statEc))
        return {};

    std::ifstream file(resolved, std::ios::binary);
    if (!file)
        return {};

    return {DiskPage::Kind::File,
        std::string(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>())};
}

}  // namespace jean
