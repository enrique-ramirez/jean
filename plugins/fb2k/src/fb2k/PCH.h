#pragma once

// The SDK, and deliberately nothing else -- not <helpers/foobar2000+atl.h>, which
// the SDK's own components use and which drags in ATL and WTL. See src/README.md.
//
// FOOBAR2000_TARGET_VERSION is left at 80 (foobar2000 1.5), which is the widest
// reach: newer players load older-targeting components, 81 would buy 2.0-only APIs
// and cost everything before it.
#include <foobar2000/SDK/foobar2000.h>
