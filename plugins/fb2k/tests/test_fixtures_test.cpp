// scripts/test-fixtures.ps1 copies a corpus kept for the purpose into the tree every live tag
// write is aimed at. Each file in it exists to hold one case: a Vorbis comment, an ID3v2 frame
// and an MP4 atom are three writers inside foobar2000; a mono file and a silent one share a
// library-relative path; one FLAC numbers its subsongs from 1 and another only looks like a cue
// sheet. A copy of somebody's music holds none of those cases, and a tag write aimed at a copy
// of a library is one path mix-up away from the library itself. The corpus lives on the build
// machine, out of this suite's reach, so what is held here is the list the script copies.

#include "third_party/doctest.h"

#include <algorithm>
#include <fstream>
#include <regex>
#include <set>
#include <string>

namespace {

constexpr char kSelf[] = "plugins/fb2k/tests/test_fixtures_test.cpp";

std::string scriptPath() {
    std::string self = __FILE__;
    std::replace(self.begin(), self.end(), '\\', '/');
    const auto tail = self.rfind(kSelf);

    REQUIRE_MESSAGE(tail != std::string::npos, "cannot locate the repository from ", self);
    return self.substr(0, tail) + "plugins/fb2k/scripts/test-fixtures.ps1";
}

std::set<std::string> sourcesCopied() {
    std::ifstream file(scriptPath());
    REQUIRE(file);

    const std::regex source(R"(Source\s*=\s*'([^']+)')");
    std::set<std::string> sources;
    std::string line;
    while (std::getline(file, line)) {
        std::smatch match;
        if (std::regex_search(line, match, source)) {
            sources.insert(match[1]);
        }
    }
    return sources;
}

}  // namespace

TEST_CASE("the fixture corpus is the files made for it, and nothing restocked out of a library") {
    const std::set<std::string> corpus = {
        "cue-99-subsongs.flac", "mono.flac",   "mono.mp3",        "silence.flac",
        "silence.m4a",          "silence.mp3", "vorbis-cue.flac",
    };

    CHECK(sourcesCopied() == corpus);
}
