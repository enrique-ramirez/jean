#include "fb2k/PCH.h"

#include "fb2k/token.h"

#include <numeric>

#ifdef _WIN32
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")
#endif

namespace jean {

namespace {

std::string toHex(const unsigned char* bytes, size_t count) {
    static constexpr char kDigits[] = "0123456789abcdef";

    return std::accumulate(bytes, bytes + count, std::string(),
                           [](std::string out, unsigned char byte) {
                               out.push_back(kDigits[byte >> 4]);
                               out.push_back(kDigits[byte & 0x0f]);
                               return out;
                           });
}

}  // namespace

std::string generateToken() {
#ifdef _WIN32
    unsigned char bytes[32];
    if (BCryptGenRandom(nullptr, bytes, sizeof(bytes), BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0)
        return std::string();

    return toHex(bytes, sizeof(bytes));
#else
    return std::string();
#endif
}

}  // namespace jean
