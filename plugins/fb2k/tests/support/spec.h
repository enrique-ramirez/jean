#pragma once

#include <set>
#include <string>
#include <vector>

namespace jean::testing {

// One operation contract/openapi.yaml publishes.
struct SpecRoute {
    // GET, POST or DELETE, as a client would send it.
    std::string method;

    // As the spec writes it, without the server's /api base and with any {id} still in it.
    std::string path;

    // The spec's own `security: []`, which is how an operation says it needs no token.
    bool needsNoToken = false;

    std::set<int> statuses;
};

// Every operation contract/openapi.yaml publishes. The spec is the contract and changes in the
// same pass as any route, so a test driven by this cannot quietly omit one -- and a route
// that wants to answer without a credential has to say so in the contract to get away with
// it, where a reviewer will see it.
std::vector<SpecRoute> publishedRoutes();

}  // namespace jean::testing
