#pragma once

#include <pfc/string_conv.h>

#include <algorithm>
#include <string>

namespace jean {

// A pfc::string8 carries its own length and may hold a NUL, so copying through c_str()
// alone would stop at one.
inline std::string toStd(const pfc::string8& text) {
    return std::string(text.c_str(), text.length());
}

// The separator library_manager::get_relative_path writes is undocumented; see
// ARCHITECTURE.md, *Facts about the player*.
inline std::string forwardSlashed(std::string path) {
    std::replace(path.begin(), path.end(), '\\', '/');
    return path;
}

inline std::wstring toWide(const std::string& text) {
    return pfc::stringcvt::string_wide_from_utf8(text.c_str()).get_ptr();
}

inline std::string toUtf8(const std::wstring& text) {
    return pfc::stringcvt::string_utf8_from_wide(text.c_str()).get_ptr();
}

}  // namespace jean
