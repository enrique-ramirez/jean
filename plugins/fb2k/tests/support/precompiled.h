#pragma once

// tests/main.cpp is left out of the precompiled header: doctest generates its implementation only
// where DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN is defined before the first include of doctest.h.

#include "third_party/doctest.h"
#include "third_party/httplib.h"
#include "third_party/json.hpp"

// cpp-httplib reaches Windows' <rpcndr.h>, which defines small as char, and this header reaches
// files that never asked for cpp-httplib.
#undef small
