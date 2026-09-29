#pragma once

#include <memory>
#include <string>

namespace jean {

// Bytes held once and handed to every reader rather than copied to each: a cover, a library
// export. Null where there are none.
using SharedBytes = std::shared_ptr<const std::string>;

}  // namespace jean
