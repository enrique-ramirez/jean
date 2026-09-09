#pragma once

#include <cstddef>
#include <deque>
#include <mutex>
#include <string>
#include <vector>

namespace jean {

// Where the stream changed what a stream time means: a track starting, or a seek within one.
struct StreamMark {
    double at = 0;
    std::string path;
    int subsong = 0;

    // Where the player was in the track when the mark was taken, so a client can turn
    // stream time into track position without assuming a track starts at zero.
    double position = 0;
};

// What is audible, expressed in the stream's own clock.
//
// A listener cannot get this from the player: beefweb reports where playback is now, and
// the stream a browser is rendering is a second or two behind that. The client turns
// `audio.currentTime` into a track position through these marks.
class Timeline {
public:
    explicit Timeline(size_t keep);

    // Encoder thread.
    void setStreamTime(double seconds);

    // Encoder thread.
    void mark(StreamMark mark);

    double streamTime() const;
    std::vector<StreamMark> marks() const;

    Timeline(const Timeline&) = delete;
    Timeline& operator=(const Timeline&) = delete;

private:
    mutable std::mutex mutex_;
    std::deque<StreamMark> marks_;
    const size_t keep_;
    double streamTime_ = 0;
};

}  // namespace jean
