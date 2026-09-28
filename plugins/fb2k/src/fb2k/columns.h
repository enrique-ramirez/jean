#pragma once

#include "core/library.h"
#include "fb2k/strings.h"

#include <foobar2000/SDK/foobar2000.h>

#include <algorithm>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace jean {

// foobar2000 bounds what $repeat and $pad produce, and nothing bounds a script doubling a variable
// with $puts. Its formatter appends what a script produces to the
// pfc::string_base it is handed, so holding back what arrives past the cap keeps that script from
// growing the text at all. One byte past the cap is kept so that value() can tell a value that
// reached the cap from one that stopped there.
class CappedText : public pfc::string_base {
public:
    const char* get_ptr() const override { return text_.get_ptr(); }
    t_size get_length() const override { return text_.get_length(); }

    void add_string(const char* text, t_size length) override {
        const t_size held = text_.get_length();
        const t_size room = kHeldBytes > held ? kHeldBytes - held : 0;
        text_.add_string(text, std::min(pfc::strlen_max(text, length), room));
    }

    void set_string(const char* text, t_size length) override {
        text_.reset();
        add_string(text, length);
    }

    void truncate(t_size length) override { text_.truncate(length); }
    char* lock_buffer(t_size length) override { return text_.lock_buffer(length); }
    void unlock_buffer() override { text_.unlock_buffer(); }

    std::string value() const {
        return cappedColumnValue(std::string_view(text_.get_ptr(), text_.get_length()));
    }

private:
    static constexpr t_size kHeldBytes = kMaxColumnValueBytes + 1;
    pfc::string8 text_;
};

inline std::vector<titleformat_object::ptr> compiledColumns(
    const titleformat_compiler::ptr& compiler, const std::vector<std::string>& columns) {
    std::vector<titleformat_object::ptr> scripts;
    scripts.reserve(columns.size());
    for (const std::string& column : columns) {
        titleformat_object::ptr script;
        compiler->compile_safe_ex(script, column.c_str(), kUnresolved);
        scripts.push_back(std::move(script));
    }

    return scripts;
}

inline std::vector<std::string> formattedColumns(
    const metadb_handle_ptr& handle, const std::vector<titleformat_object::ptr>& scripts) {
    std::vector<std::string> values(scripts.size(), kUnresolved);

    metadb_info_container::ptr info;
    if (!handle->get_info_ref(info))
        return values;

    CappedText text;
    for (size_t column = 0; column < scripts.size(); ++column) {
        handle->format_title_from_external_info(info->info(), nullptr, text, scripts[column],
                                                nullptr);
        values[column] = text.value();
    }

    return values;
}

inline std::vector<std::string> formattedPlayingColumns(
    const metadb_handle_ptr& track, const std::vector<titleformat_object::ptr>& scripts) {
    std::vector<std::string> values(scripts.size(), kUnresolved);

    const auto playback = playback_control::get();
    CappedText text;
    for (size_t column = 0; column < scripts.size(); ++column) {
        playback->playback_format_title_ex(track, nullptr, text, scripts[column], nullptr,
                                           playback_control::display_level_titles);
        values[column] = text.value();
    }

    return values;
}

}  // namespace jean
