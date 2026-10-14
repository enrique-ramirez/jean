#include "fb2k/PCH.h"

#include "fb2k/browser.h"

#include "core/log.h"
#include "fb2k/strings.h"

#ifdef _WIN32
#include <shellapi.h>
#else
#include <pfc/CFObject.h>

#include <CoreServices/CoreServices.h>
#endif

namespace jean {

void openInBrowser(const std::string& url) {
#ifdef _WIN32
    // ShellExecuteW answers an HINSTANCE in name only: 32 or below is an error code.
    const auto result = reinterpret_cast<INT_PTR>(
        ShellExecuteW(nullptr, L"open", toWide(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL));

    if (result <= 32)
        logError("could not open " + url + " in the default browser (ShellExecute answered " +
                 std::to_string(result) + ")");
#else
    const auto parsed = pfc::wrapCFObject(
        CFURLCreateWithBytes(kCFAllocatorDefault, reinterpret_cast<const UInt8*>(url.data()),
                             static_cast<CFIndex>(url.size()), kCFStringEncodingUTF8, nullptr));
    if (!parsed) {
        logError("could not open " + url +
                 " in the default browser (CoreFoundation cannot parse it)");
        return;
    }

    const OSStatus status = LSOpenCFURLRef(parsed, nullptr);
    if (status != noErr)
        logError("could not open " + url + " in the default browser (Launch Services answered " +
                 std::to_string(status) + ")");
#endif
}

}  // namespace jean
