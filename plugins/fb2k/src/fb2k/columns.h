#pragma once

#include "core/library.h"
#include "fb2k/strings.h"

#include <foobar2000/SDK/foobar2000.h>

#include <string>
#include <utility>
#include <vector>

namespace jean {

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

    pfc::string8 text;
    for (size_t column = 0; column < scripts.size(); ++column) {
        handle->format_title_from_external_info(info->info(), nullptr, text, scripts[column],
                                                nullptr);
        values[column] = toStd(text);
    }

    return values;
}

}  // namespace jean
