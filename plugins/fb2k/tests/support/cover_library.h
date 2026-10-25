#pragma once

#include "core/library.h"

#include <string>
#include <vector>

namespace jean::testing {

struct RoleAsked;

constexpr char kRecordSecondTrack[] = "Band/Record/a.flac";
constexpr char kRecordCover[] = "Band/Record/b.flac";
constexpr char kRecordThirdTrack[] = "Band/Record/c.flac";
constexpr char kRecordBonusTrack[] = "Band/Record (bonus)/d.flac";
constexpr char kSecondRecordCover[] = "Other Band/Second Record/01.flac";
constexpr char kSecondRecordSecondTrack[] = "Other Band/Second Record/02.flac";

constexpr char kGoneFromTheLibrary[] = "Band/Record/gone.flac";

const std::vector<RoleAsked>& coverRoles();

std::vector<RoleAsked> coverRolesWith(const RoleAsked& replacement);
std::vector<RoleAsked> coverRolesBut(const std::string& leftOut);

std::vector<std::string> coverColumns();

Snapshot coverSnapshot();

Snapshot coverSnapshotBehind(size_t count);

std::string withRoles(const std::string& path, const std::vector<RoleAsked>& roles);
std::string withCoverRoles(const std::string& path);

}  // namespace jean::testing
