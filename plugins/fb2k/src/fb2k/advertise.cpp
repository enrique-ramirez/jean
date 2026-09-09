#include "fb2k/PCH.h"

#include "fb2k/advertise.h"

#include "core/log.h"
#include "fb2k/files.h"
#include "fb2k/paths.h"

namespace jean {

void writeAdvertisement(const Settings& settings, const ListenerStatus& status) {
    if (!beefwebPresent())
        return;

    try {
        writeTextFile(discoveryRecordPath(), discoveryDocument(settings, status));
    } catch (const std::exception& e) {
        logError(std::string("could not write the discovery record: ") + e.what());
        logError("clients can still reach this component; they will have to be told the port");
    }
}

void removeAdvertisement() {
    try {
        removeFileIfPresent(discoveryRecordPath());
    } catch (const std::exception&) {
    }
}

}  // namespace jean
