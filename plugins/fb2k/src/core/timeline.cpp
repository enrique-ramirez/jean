#include "core/timeline.h"

#include <algorithm>
#include <utility>

namespace jean {

Timeline::Timeline(size_t keep) : keep_(std::max<size_t>(keep, 1)) {}

void Timeline::setStreamTime(double seconds) {
    const std::lock_guard<std::mutex> held(mutex_);
    streamTime_ = seconds;
}

void Timeline::mark(StreamMark mark) {
    const std::lock_guard<std::mutex> held(mutex_);

    marks_.push_back(std::move(mark));
    while (marks_.size() > keep_)
        marks_.pop_front();
}

double Timeline::streamTime() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return streamTime_;
}

std::vector<StreamMark> Timeline::marks() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return {marks_.begin(), marks_.end()};
}

}  // namespace jean
