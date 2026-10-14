#pragma once

#include "core/aac_stream.h"

#include <memory>

namespace jean {

std::unique_ptr<AacCodec> platformAacCodec();

}  // namespace jean
