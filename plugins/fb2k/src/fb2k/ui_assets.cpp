#include "fb2k/PCH.h"

#include "fb2k/ui_assets.h"

#include "core/assets.h"
#include "fb2k/paths.h"
#include "fb2k/strings.h"

#include <filesystem>
#include <fstream>
#include <iterator>
#include <string_view>
#include <system_error>

namespace jean {

std::optional<std::string_view> readEmbeddedPage(const std::string& path) {
    return findEmbeddedFile(generated::embeddedUiFiles(), path);
}

std::vector<std::string> embeddedPageNames() {
    return embeddedRootNames(generated::embeddedUiFiles());
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
        return {DiskPage::Kind::directory, {}};

    if (!fs::is_regular_file(resolved, statEc))
        return {};

    std::ifstream file(resolved, std::ios::binary);
    if (!file)
        return {};

    return {DiskPage::Kind::file,
            std::string(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>())};
}

}  // namespace jean
