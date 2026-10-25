#include "core/library_roles.h"

#include "core/text.h"

#include <algorithm>
#include <utility>

namespace jean {

namespace {

const RoleName* roleNamed(const std::string& name) {
    for (const RoleName& role : kRoleNames) {
        if (name == role.name)
            return &role;
    }
    return nullptr;
}

bool listed(std::span<const std::string_view> names, const std::string& name) {
    return std::find(names.begin(), names.end(), name) != names.end();
}

}  // namespace

RolesAsked rolesAsked(const httplib::Request& req, std::span<const std::string_view> accepted,
                      std::span<const std::string_view> owned) {
    RolesAsked asked;
    const auto refuse = [&asked](LibraryRefusal refusal, std::string detail) {
        asked.refusal = refusal;
        asked.detail = std::move(detail);
        return asked;
    };

    for (const auto& [name, expression] : req.params) {
        if (listed(owned, name))
            continue;

        if (!listed(accepted, name))
            return refuse(LibraryRefusal::badRole, "'" + name + "' is not a role");

        if (expression.empty() || expression.size() > kMaxColumnLength ||
            !isPrintable(expression)) {
            return refuse(LibraryRefusal::badRole,
                          "role '" + name + "' must be printable text of 1 to " +
                              std::to_string(kMaxColumnLength) + " characters");
        }

        if (!asked.expressions.emplace(name, expression).second)
            return refuse(LibraryRefusal::duplicateRole, "role '" + name + "' is named twice");
    }

    return asked;
}

std::string rolesKey(const std::map<std::string, std::string>& roles) {
    std::string key;
    for (const auto& [name, expression] : roles) {
        key += name;
        key += '\0';
        key += expression;
        key += '\0';
    }
    return key;
}

std::optional<LibraryRoles> rolesIn(const Snapshot& snapshot,
                                    const std::map<std::string, std::string>& roles) {
    if (snapshot.columns.size() < kSpineFieldCount)
        return roles.empty() ? std::optional<LibraryRoles>(LibraryRoles{}) : std::nullopt;

    LibraryRoles found;
    for (const auto& [name, expression] : roles) {
        const auto column =
            std::find_if(snapshot.columns.begin() + kSpineFieldCount, snapshot.columns.end(),
                         [&expression](const Column& held) { return held.name == expression; });
        if (column == snapshot.columns.end())
            return std::nullopt;

        found.*roleNamed(name)->field = static_cast<size_t>(column - snapshot.columns.begin());
    }
    return found;
}

RolesVerdict rolesVerdict(const Library::State& state, const std::vector<std::string>& declared,
                          const std::map<std::string, std::string>& expressions) {
    if (!state.ready)
        return {RolesVerdict::notYet, {}};

    const auto& wanted = declared.empty() ? state.columns : declared;
    const auto holds = [](const std::vector<std::string>& columns, const std::string& expression) {
        return std::find(columns.begin(), columns.end(), expression) != columns.end();
    };

    const bool stale = std::any_of(expressions.begin(), expressions.end(), [&](const auto& role) {
        return !holds(state.columns, role.second) && holds(wanted, role.second);
    });
    if (stale)
        return {RolesVerdict::notYet, {}};

    const auto missing =
        std::find_if(expressions.begin(), expressions.end(),
                     [&](const auto& role) { return !holds(state.columns, role.second); });
    if (missing != expressions.end())
        return {RolesVerdict::undeclared, missing->second};

    return {};
}

}  // namespace jean
