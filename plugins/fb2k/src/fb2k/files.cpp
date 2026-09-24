#include "fb2k/PCH.h"

#include "fb2k/files.h"

namespace jean {

std::string readTextFile(const std::string& path, size_t maxBytes) {
    file_ptr f;
    filesystem::g_open(f, path.c_str(), filesystem::open_mode_read, fb2k::noAbort);

    const auto size = f->get_size_ex(fb2k::noAbort);
    if (size == 0 || size > maxBytes)
        return std::string();

    std::string text;
    text.resize(static_cast<size_t>(size));
    f->read_object(&text[0], static_cast<t_size>(size), fb2k::noAbort);
    return text;
}

void writeTextFile(const std::string& path, const std::string& text) {
    file_ptr f;
    filesystem::g_open_write_new(f, path.c_str(), fb2k::noAbort);
    f->write_string_raw(text.c_str(), fb2k::noAbort);
}

void appendTextFile(const std::string& path, const std::string& text, uint64_t limitBytes) {
    file_ptr f;

    try {
        filesystem::g_open(f, path.c_str(), filesystem::open_mode_write_existing, fb2k::noAbort);
    } catch (const std::exception&) {
        filesystem::g_open_write_new(f, path.c_str(), fb2k::noAbort);
        f->write_string_raw(text.c_str(), fb2k::noAbort);
        return;
    }

    const auto size = f->get_size(fb2k::noAbort);
    if (size < limitBytes)
        f->seek(size, fb2k::noAbort);
    else
        f->resize(0, fb2k::noAbort);

    f->write_string_raw(text.c_str(), fb2k::noAbort);
}

}  // namespace jean
