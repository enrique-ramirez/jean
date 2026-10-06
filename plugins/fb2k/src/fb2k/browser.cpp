#include "fb2k/PCH.h"

#include "fb2k/browser.h"

#include "core/log.h"
#include "fb2k/strings.h"

#include <shellapi.h>

namespace jean {

void openInBrowser(const std::string& url) {
    // ShellExecuteW answers an HINSTANCE in name only: 32 or below is an error code.
    const auto result = reinterpret_cast<INT_PTR>(
        ShellExecuteW(nullptr, L"open", toWide(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL));

    if (result <= 32)
        logError("could not open " + url + " in the default browser (ShellExecute answered " +
                 std::to_string(result) + ")");
}

}  // namespace jean
