// scripts/test-fixtures.ps1 copies a corpus kept for the purpose into the tree every live tag
// write is aimed at. Each file in it exists to hold one case: a Vorbis comment, an ID3v2 frame
// and an MP4 atom are three writers inside foobar2000; a mono file and a silent one share a
// library-relative path; one FLAC numbers its subsongs from 1 and another only looks like a cue
// sheet. A copy of somebody's music holds none of those cases, and a tag write aimed at a copy
// of a library is one path mix-up away from the library itself. The corpus lives on the build
// machine, out of this suite's reach, so what is held here is the list the script copies and the
// SHA-256 it checks each file against before copying.

#include "third_party/doctest.h"

#include "support/repository.h"

#include <fstream>
#include <map>
#include <regex>
#include <string>

namespace {

std::string scriptPath() {
    return jean::testing::repositoryRoot() + "plugins/fb2k/scripts/test-fixtures.ps1";
}

std::map<std::string, std::string> sourcesCopied() {
    std::ifstream file(scriptPath());
    REQUIRE(file);

    const std::regex source(R"(Source\s*=\s*'([^']+)')");
    const std::regex sha256(R"(Sha256\s*=\s*'([^']*)')");
    std::map<std::string, std::string> sources;
    std::string line;
    while (std::getline(file, line)) {
        std::smatch name;
        if (!std::regex_search(line, name, source)) {
            continue;
        }
        std::smatch hash;
        sources[name[1]] = std::regex_search(line, hash, sha256) ? hash[1].str() : std::string();
    }
    return sources;
}

}  // namespace

TEST_CASE("the fixture corpus is the files made for it, and nothing restocked out of a library") {
    const std::map<std::string, std::string> corpus = {
        {"cue-99-subsongs.flac",
         "513FAD18578F3225FAE5DE1BDA8F700415BE6FD8AA1E7AF533B5EB796ED2D461"},
        {"mono.flac", "20539FBBD6AE28CEA2B2182A4C60C6C70CBB710A136199FC83200C4E5FA00B1C"},
        {"mono.mp3", "092C62FEFDD637920F269C1695B18D1C752E3EBA2F69E0E5917CFF9ABAD11721"},
        {"silence.flac", "1E5F07490CF857F7C726465B687C773BB0CC5C3EC4ECFDCF6AA85EB11F607CE7"},
        {"silence.m4a", "9C9DD1312090304A693D1FDE554AF482F1804DF8926F6273CB481BAF746DA98C"},
        {"silence.mp3", "E36C7E2C97371ADBBE93B3EDC39D99EE3B8B32F82A875A0B7E1ED31AAB6BAF87"},
        {"vorbis-cue.flac", "54B5247D5F06744A359F607851A9E16679F5B6DD9B71CFCFFB4518904DC2F9B3"},
    };

    CHECK(sourcesCopied() == corpus);
}
