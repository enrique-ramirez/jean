#include "fb2k/PCH.h"

#include "fb2k/ticket_mint.h"

#include "core/text.h"

#include <array>

#ifdef _WIN32
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")
#else
#include <stdlib.h>
#endif

namespace jean {

std::string mintTicket() {
    std::array<unsigned char, 32> bytes{};
#ifdef _WIN32
    if (BCryptGenRandom(nullptr, bytes.data(), static_cast<ULONG>(bytes.size()),
                        BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0)
        return std::string();
#else
    arc4random_buf(bytes.data(), bytes.size());
#endif

    return toHex(bytes);
}

}  // namespace jean
