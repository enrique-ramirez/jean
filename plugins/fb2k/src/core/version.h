#pragma once

namespace jean {

// Two of the three consumers are contracts with things outside this repo:
// DECLARE_COMPONENT_VERSION, which foobar2000's update finder reads, and the discovery
// record a client finds this component by. The third is GET /api/status.
constexpr char kComponentName[] = "foo_jean";
constexpr char kVersion[] = "0.1.0";

// Moves only when the HTTP surface changes shape, independently of kVersion. A client reads
// it to decide whether it understands this component, so a patch release MUST NOT move it
// and a breaking change MUST.
constexpr int kApiVersion = 1;

}  // namespace jean
