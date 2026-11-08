#pragma once

#include <map>
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

    std::set<int> statuses;
};

// Every operation contract/openapi.yaml publishes. The spec is the contract and changes in the
// same pass as any route, so a test driven by this cannot quietly omit one -- and a route
// that wants to answer without a credential has to say so in the contract to get away with
// it, where a reviewer will see it.
std::vector<SpecRoute> publishedRoutes();

std::string dialable(const std::string& path);

std::vector<std::string> publishedEnum(const std::string& schema, const std::string& property);

std::vector<std::string> publishedRequired(const std::string& schema,
                                           const std::string& property = {});

// Every `error` a response example shows, with the statuses it is shown under, across every
// route and every shared response a route refers to.
std::map<std::string, std::set<int>> publishedErrorExamples();

// Every schema a response is declared as, with the statuses it answers under, reached the same
// way.
std::map<std::string, std::set<int>> publishedSchemaStatuses();

// The top-level scalars of the example GET /status answers with.
std::map<std::string, std::string> publishedStatusExample();

// The key set of the `player` object inside one of GET /state's named 200 examples, `built`
// or `building`, scoped to the `/state` path's own block so an example of the same name
// under a different route is never read by mistake.
std::set<std::string> publishedStatePlayerExample(const std::string& example);

// The flow sequence `key` holds in one named response example under one path, with each item's
// quotes taken off.
std::vector<std::string> publishedExampleList(const std::string& path, const std::string& example,
                                              const std::string& key);

// A list of names as the contract promises it: in no order, but spelled exactly, so a name whose
// case drifts from the one contract/openapi.yaml shows turns a case red, and so does a repeat.
std::multiset<std::string> inAnyOrder(const std::vector<std::string>& names);

}  // namespace jean::testing
