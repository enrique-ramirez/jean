#include "third_party/doctest.h"

#include "support/platform_seams.h"

#include <map>
#include <set>
#include <string>
#include <vector>

namespace jean::testing {

namespace {

struct PlatformFile {
    std::string path;
    std::set<Seam> allowed;
    std::string why;
};

const std::vector<PlatformFile>& platformFiles() {
    static const std::vector<PlatformFile> files = {
        {"plugins/fb2k/src/core/http_server.cpp",
         {Seam::conditional, Seam::systemHeader},
         "the socket's address option and its error codes, which differ between Windows and POSIX, "
         "and the list of this machine's addresses"},
        {"plugins/fb2k/src/fb2k/aac_encoder.cpp",
         {Seam::systemHeader},
         "Media Foundation, the AAC encoder"},
        {"plugins/fb2k/src/fb2k/aac_encoder_mac.cpp",
         {Seam::platformName, Seam::systemHeader},
         "AudioToolbox, the AAC encoder"},
        {"plugins/fb2k/src/fb2k/browser.cpp",
         {Seam::conditional, Seam::systemHeader},
         "the system call that opens a URL in the user's browser: the shell's open on Windows, "
         "Launch Services on macOS"},
        {"plugins/fb2k/src/fb2k/com_thread.h",
         {Seam::conditional, Seam::systemHeader},
         "COM for a thread, on Windows"},
        {"plugins/fb2k/src/fb2k/preferences.cpp",
         {Seam::systemHeader},
         "the preferences dialogs' Win32 calls: the dialog procedure, its controls and its message "
         "boxes"},
        {"plugins/fb2k/src/fb2k/preferences.rc",
         {Seam::platformName, Seam::systemHeader},
         "the preferences dialogs' layout, a resource script that includes windows.h"},
        {"plugins/fb2k/src/fb2k/preferences_mac.mm",
         {Seam::platformName, Seam::systemHeader},
         "Cocoa, the preferences pages' views and controls"},
        {"plugins/fb2k/src/fb2k/strings.h",
         {Seam::conditional},
         "the separator foobar2000 writes in a library path, which differs by platform"},
        {"plugins/fb2k/src/fb2k/ticket_mint.cpp",
         {Seam::conditional, Seam::systemHeader},
         "the operating system's randomness, for stream tickets"},
    };
    return files;
}

std::string ruleAndList() {
    return " A platform file may hold only the call into the operating system or the player "
           "(plugins/fb2k/CONTRIBUTING.md, section 1). The list is in "
           "plugins/fb2k/tests/platform_seams_test.cpp.";
}

std::vector<std::string> unlistedSeams(const std::vector<PlatformFile>& list,
                                       const std::map<std::string, std::set<Seam>>& found) {
    std::map<std::string, std::set<Seam>> allowed;
    for (const PlatformFile& file : list)
        allowed[file.path] = file.allowed;

    std::vector<std::string> complaints;
    for (const auto& [path, held] : found) {
        for (const Seam seam : held) {
            if (!allowed[path].contains(seam))
                complaints.push_back(path + " holds " + seamName(seam) +
                                     " and is not listed for it. Move the code out or add an "
                                     "entry for it." +
                                     ruleAndList());
        }
    }

    return complaints;
}

std::vector<std::string> staleEntries(const std::vector<PlatformFile>& list,
                                      const std::map<std::string, std::set<Seam>>& found) {
    std::vector<std::string> complaints;
    const auto complain = [&](const std::string& what) {
        complaints.push_back(what + ruleAndList());
    };

    for (const PlatformFile& file : list) {
        if (file.allowed.empty())
            complain(file.path +
                     " is listed for no kind of seam. Give it one or delete its entry.");

        const auto present = found.find(file.path);
        if (present == found.end()) {
            complain(file.path + " is listed but is not in the tree. Delete its entry.");
            continue;
        }

        for (const Seam seam : file.allowed) {
            if (!present->second.contains(seam))
                complain(file.path + " is listed for " + seamName(seam) +
                         " but no longer holds it. Narrow or delete its entry.");
        }
    }

    return complaints;
}

}  // namespace

TEST_CASE("a platform conditional is a seam, whichever of the four it names") {
    for (const char* macro : {"_WIN32", "__APPLE__", "_MSC_VER", "__linux__"}) {
        INFO("macro: ", macro);
        const std::string text = std::string("#ifdef ") + macro + "\n#endif\n";
        CHECK(seamsOf("a.cpp", text) == std::set<Seam>{Seam::conditional});
    }

    CHECK(seamsOf("a.cpp", "#if defined(_WIN32) || defined(__APPLE__)\n#endif\n") ==
          std::set<Seam>{Seam::conditional});
    CHECK(seamsOf("a.cpp", "#elif _MSC_VER >= 1900\n") == std::set<Seam>{Seam::conditional});
}

TEST_CASE("a platform macro counts wherever it is written, comments and strings included") {
    CHECK(seamsOf("a.cpp", "// not on _WIN32\n") == std::set<Seam>{Seam::conditional});
    CHECK(seamsOf("a.cpp", "const char* kName = \"__APPLE__\";\n") ==
          std::set<Seam>{Seam::conditional});
}

TEST_CASE("only the whole macro is a conditional") {
    CHECK(seamsOf("a.cpp", "#ifdef MY_WIN32_THING\n#endif\n").empty());
    CHECK(seamsOf("a.cpp", "#ifdef _WIN32_WINNT\n#endif\n").empty());
    CHECK(seamsOf("a.cpp", "#ifdef __APPLE_CC__\n#endif\n").empty());
    CHECK(seamsOf("a.cpp", "int windows = 1;\n").empty());
}

TEST_CASE("an angle include of a header with an extension is the operating system's") {
    for (const char* header :
         {"unistd.h", "sys/socket.h", "CoreFoundation/CoreFoundation.h", "windows.h", "mfapi.h",
          "someHeaderNobodyListed.h", "string.h", "math.h"}) {
        INFO("header: ", header);
        const std::string text = std::string("#include <") + header + ">\n";
        CHECK(seamsOf("a.cpp", text) == std::set<Seam>{Seam::systemHeader});
    }
}

TEST_CASE("an import of a header is read as an include") {
    CHECK(seamsOf("a.mm", "#import <Foundation/Foundation.h>\n") ==
          std::set<Seam>{Seam::systemHeader, Seam::platformName});
    CHECK(seamsOf("a.cpp", "#import \"x.h\"\n").empty());
}

TEST_CASE("an include is found whatever its spacing or line ending") {
    CHECK(seamsOf("a.cpp", "  #  include   <windows.h>\r\n") == std::set<Seam>{Seam::systemHeader});
    CHECK(seamsOf("a.cpp", "#include <vector>\r\n#include <windows.h>") ==
          std::set<Seam>{Seam::systemHeader});
}

TEST_CASE("the standard library, this tree's own headers and its libraries are not seams") {
    for (const char* include :
         {"<vector>", "<cstring>", "<string_view>", "\"core/text.h\"", "\"windows.h\"",
          "<foobar2000/SDK/foobar2000.h>", "<foobar2000/helpers/input_helpers.h>",
          "<pfc/string_conv.h>", "<opus.h>", "<ogg/ogg.h>"}) {
        INFO("include: ", include);
        const std::string text = std::string("#include ") + include + "\n";
        CHECK(seamsOf("a.cpp", text).empty());
    }
}

TEST_CASE("a header named in prose or after other text on the line is not an include") {
    CHECK(seamsOf("a.cpp", "// #include <windows.h>\n").empty());
    CHECK(seamsOf("a.cpp", "int x;  #include <windows.h>\n").empty());
}

TEST_CASE("a file named for one platform is a seam") {
    for (const char* path : {"x_mac.cpp", "x_win.h", "page.mm", "preferences.rc",
                             "plugins/fb2k/src/fb2k/browser_mac.cpp"}) {
        INFO("path: ", path);
        CHECK(seamsOf(path, "").contains(Seam::platformName));
    }
}

TEST_CASE("a name that only contains mac, win or rc is not named for a platform") {
    for (const char* path : {"machine.cpp", "window.cpp", "format.h", "macro.h", "win.cpp",
                             "src/rc/queue.cpp", "arc.cpp", "plugins/fb2k/src/core/rcs.h"}) {
        INFO("path: ", path);
        CHECK(seamsOf(path, "").empty());
    }
}

TEST_CASE("one file can hold all three seams") {
    CHECK(seamsOf("a_win.cpp", "#ifdef _WIN32\n#include <windows.h>\n#endif\n") ==
          std::set<Seam>{Seam::conditional, Seam::systemHeader, Seam::platformName});
}

TEST_CASE("every platform seam under src/ is listed") {
    for (const std::string& complaint : unlistedSeams(platformFiles(), seamsUnderSource()))
        CHECK_MESSAGE(false, complaint);
}

TEST_CASE("every listed entry still holds what it was listed for") {
    for (const std::string& complaint : staleEntries(platformFiles(), seamsUnderSource()))
        CHECK_MESSAGE(false, complaint);
}

TEST_CASE("an unlisted seam is named for each file that holds it, and a listed one is not") {
    const std::map<std::string, std::set<Seam>> found = {
        {"src/listed.cpp", {Seam::conditional}},
        {"src/partly.cpp", {Seam::conditional, Seam::systemHeader}},
        {"src/clean.cpp", {}},
        {"src/other.cpp", {Seam::platformName}}};
    const std::vector<PlatformFile> list = {{"src/listed.cpp", {Seam::conditional}, ""},
                                            {"src/partly.cpp", {Seam::conditional}, ""}};

    const std::vector<std::string> complaints = unlistedSeams(list, found);

    REQUIRE(complaints.size() == 2);
    CHECK(complaints[0].starts_with("src/other.cpp holds a name for one platform"));
    CHECK(complaints[1].starts_with("src/partly.cpp holds an operating system header"));
}

TEST_CASE("a stale entry is named, whichever way it went stale") {
    const std::map<std::string, std::set<Seam>> found = {{"src/held.cpp", {Seam::conditional}},
                                                         {"src/emptied.cpp", {}}};
    const auto complaintsAbout = [&](const PlatformFile& entry) {
        return staleEntries({entry}, found);
    };

    CHECK(complaintsAbout({"src/held.cpp", {Seam::conditional}, ""}).empty());
    CHECK(complaintsAbout({"src/emptied.cpp", {Seam::conditional}, ""}).size() == 1);
    CHECK(complaintsAbout({"src/gone.cpp", {Seam::conditional}, ""}).size() == 1);
    CHECK(complaintsAbout({"src/held.cpp", {}, ""}).size() == 1);
}

}  // namespace jean::testing
