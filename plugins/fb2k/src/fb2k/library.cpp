#include "fb2k/PCH.h"

#include "fb2k/library.h"

#include "core/log.h"
#include "fb2k/artwork.h"
#include "fb2k/ask_player.h"
#include "fb2k/columns.h"
#include "fb2k/strings.h"

#include <foobar2000/SDK/foosortstring.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace jean {

namespace {

constexpr size_t kMaxPendingDirty = 4096;
constexpr size_t kQuerySlice = 8192;

// Both halves are taken on the main thread: library_manager::get_all_items is main thread
// only, and titleformat_compiler::compile off it is undocumented.
struct Walk {
    metadb_handle_list items;
    std::vector<titleformat_object::ptr> scripts;
};

using WalkPtr = std::shared_ptr<Walk>;

// Ordinal order, and the two ways back into it. Built whole and never altered afterwards,
// so a connection thread reads one through a shared pointer while the worker builds the next.
// `byRelativePath` keys into `relativePaths`, which is why nothing here may be appended to.
struct Ordered {
    metadb_handle_list items;
    std::vector<std::string> relativePaths;
    std::unordered_map<const metadb_handle*, uint32_t> ordinals;
    std::unordered_map<std::string_view, uint32_t> byRelativePath;
    uint64_t structure = 0;
};

using OrderedPtr = std::shared_ptr<const Ordered>;

void formatRow(const metadb_v2::ptr& metadb, const metadb_handle_ptr& item,
               const metadb_v2::rec_t& rec, const std::string& relativePath,
               const std::vector<titleformat_object::ptr>& scripts, pfc::string8& text,
               std::vector<std::string>& values) {
    RelativePathParts parts = splitRelativePath(relativePath);

    values.resize(kSpineFieldCount + scripts.size());
    values[0] = std::move(parts.directory);
    values[1] = std::move(parts.filename);
    values[2] = std::to_string(item->get_subsong_index());

    for (size_t column = 0; column < scripts.size(); ++column) {
        metadb->formatTitle_v2(item, rec, nullptr, text, scripts[column], nullptr);
        values[kSpineFieldCount + column] = toStd(text);
    }
}

LibraryTrackRead trackReadFailure(PlaylistOutcome outcome) {
    LibraryTrackRead read;
    read.outcome = outcome;
    return read;
}

}  // namespace

struct LibraryFeed::State {
    State(MainThreadQueue& mainThread, Library& library, metadb_v2::ptr metadb,
          library_manager::ptr libraryManager, titleformat_compiler::ptr compiler)
        : mainThread_(mainThread),
          library_(library),
          metadb_(std::move(metadb)),
          libraryManager_(std::move(libraryManager)),
          compiler_(std::move(compiler)),
          worker_([this] { run(); }) {}

    void rebuild(std::vector<std::string> columns, RebuildReason why) {
        {
            const std::lock_guard<std::mutex> lock(mutex_);
            queue_.ask(std::move(columns), why);
        }

        wake_.notify_one();
    }

    void refresh() {
        {
            const std::lock_guard<std::mutex> lock(mutex_);
            queue_.dataMoved();
        }

        wake_.notify_one();
    }

    void refreshIfBuilt() {
        if (built_)
            refresh();
    }

    void markDirty(metadb_handle_list_cref items, bool fromHook) {
        if (!built_)
            return;

        {
            const std::lock_guard<std::mutex> lock(mutex_);
            if (dirty_.size() + items.get_count() > kMaxPendingDirty) {
                dirty_.clear();
                hookMarks_ = 0;
                queue_.dataMoved();
            } else {
                for (size_t n = 0, count = items.get_count(); n < count; ++n)
                    dirty_.push_back(items.get_item(n));

                if (fromHook)
                    hookMarks_ += items.get_count();
            }
        }

        wake_.notify_one();
    }

    void markDirty(const metadb_handle_ptr& item) {
        metadb_handle_list one;
        one.add_item(item);
        markDirty(one, false);
    }

    // On a connection thread, so it touches nothing the worker is still writing.
    ArtworkSource artwork(const std::string& relativePath) const {
        const OrderedPtr ordered = order();
        if (!ordered)
            return {};

        const auto found = ordered->byRelativePath.find(relativePath);
        if (found == ordered->byRelativePath.end())
            return {};

        return art_.of(ordered->items[found->second]);
    }

    // Ordinals run in relative-path order with the tie broken by subsong, so every subsong of
    // one file follows the lowest ordinal at its path, which is the one `byRelativePath` keeps.
    // See ARCHITECTURE.md, *The media library*.
    //
    // The whole run is walked rather than stopped at the first match: two media library roots
    // can hold one relative path, and whichever of the two sorts first is not an answer.
    LibraryTrackResolution trackAt(const std::string& relativePath, uint32_t subsong) const {
        const OrderedPtr ordered = order();
        if (!ordered)
            return {};

        const auto found = ordered->byRelativePath.find(relativePath);
        if (found == ordered->byRelativePath.end())
            return {};

        LibraryTrackResolution at;
        const size_t count = ordered->items.get_count();
        for (size_t ordinal = found->second;
             ordinal < count && ordered->relativePaths[ordinal] == relativePath; ++ordinal) {
            if (ordered->items[ordinal]->get_subsong_index() != subsong)
                continue;

            if (at.handle.is_valid())
                return LibraryTrackResolution{true, {}};

            at.handle = ordered->items[ordinal];
        }

        return at;
    }

    // On a connection thread like `artwork()`; the columns go to the main thread for the reason
    // core/http_server.h's `LibraryTrackReader` gives.
    LibraryTrackRead readTrackColumns(const std::string& track, uint32_t subsong,
                                      const std::vector<std::string>& columns) const {
        const LibraryTrackResolution at = trackAt(track, subsong);
        if (at.heldTwice)
            return trackReadFailure(PlaylistOutcome::ambiguousAddress);

        const metadb_handle_ptr handle = at.handle;
        if (!handle.is_valid())
            return {};

        return askPlayer<LibraryTrackRead>(
            mainThread_, "reading one library track's columns",
            [handle, columns, compiler = compiler_](const AnswerPtr<LibraryTrackRead>& answer) {
                LibraryTrackRead read;
                read.held = true;
                read.columns = formattedColumns(handle, compiledColumns(compiler, columns));
                answer->set(std::move(read));
            },
            trackReadFailure(PlaylistOutcome::timedOut),
            trackReadFailure(PlaylistOutcome::playerRefused));
    }

    // On a connection thread like readTrackColumns, and for the same reason. Checked against
    // the current structure and count directly, rather than through resolveOrdinals: that
    // resolver folds a stale structure and an ordinal past the end into the same empty answer,
    // which is right for its five other callers and wrong here, where GET /api/track/library
    // must tell a client which one happened.
    LibraryTrackRead readOrdinalColumns(const OrdinalTrackRef& at,
                                        const std::vector<std::string>& columns) const {
        const OrderedPtr ordered = order();
        if (!ordered || ordered->structure != at.structure)
            return trackReadFailure(PlaylistOutcome::structureMoved);

        if (at.ordinal >= ordered->items.get_count())
            return {};

        const metadb_handle_ptr handle = ordered->items[at.ordinal];

        return askPlayer<LibraryTrackRead>(
            mainThread_, "reading one library track's columns by ordinal",
            [handle, columns, compiler = compiler_](const AnswerPtr<LibraryTrackRead>& answer) {
                LibraryTrackRead read;
                read.held = true;
                read.columns = formattedColumns(handle, compiledColumns(compiler, columns));
                answer->set(std::move(read));
            },
            trackReadFailure(PlaylistOutcome::timedOut),
            trackReadFailure(PlaylistOutcome::playerRefused));
    }

    OrdinalResolution resolveOrdinals(uint64_t structure,
                                      const std::vector<uint32_t>& ordinals) const {
        const OrderedPtr ordered = order();
        if (!ordered || ordered->structure != structure)
            return {};

        const size_t count = ordered->items.get_count();

        OrdinalResolution resolved;
        resolved.items.set_size(ordinals.size());
        for (size_t n = 0; n < ordinals.size(); ++n) {
            if (ordinals[n] >= count)
                return {};

            resolved.items[n] = ordered->items[ordinals[n]];
        }

        resolved.structureMatched = true;
        return resolved;
    }

    void stop() {
        {
            const std::lock_guard<std::mutex> lock(mutex_);
            stopping_ = true;
        }

        wake_.notify_one();

        if (worker_.joinable())
            worker_.join();
    }

private:
    void run() {
        try {
            serve();
        } catch (const std::exception& e) {
            logError(std::string("the library snapshot thread stopped: ") + e.what());
        } catch (...) {
            logError("the library snapshot thread stopped with an unknown exception");
        }
    }

    void serve() {
        for (;;) {
            bool rebuilding = false;
            std::vector<std::string> columns;
            std::vector<metadb_handle_ptr> marks;
            size_t marksFromHook = 0;

            {
                std::unique_lock<std::mutex> lock(mutex_);
                wake_.wait(lock,
                           [this] { return stopping_ || queue_.wanted() || !dirty_.empty(); });

                if (stopping_)
                    return;

                rebuilding = queue_.startIfWanted();

                if (rebuilding) {
                    columns = queue_.columns();
                    dirty_.clear();
                    hookMarks_ = 0;
                } else {
                    marks = std::exchange(dirty_, {});
                    marksFromHook = std::exchange(hookMarks_, size_t{0});
                }
            }

            if (!rebuilding) {
                requery(marks, marksFromHook);
                continue;
            }

            build(columns);

            {
                const std::lock_guard<std::mutex> lock(mutex_);
                queue_.finished();
            }
        }
    }

    WalkPtr walkPlayer(const std::vector<std::string>& columns) {
        return askPlayer<WalkPtr>(
            mainThread_, "a media library walk",
            [api = libraryManager_, compiler = compiler_,
             expressions = columns](const AnswerPtr<WalkPtr>& answer) {
                const auto started = std::chrono::steady_clock::now();

                auto walk = std::make_shared<Walk>();
                api->get_all_items(walk->items);

                const auto milliseconds = std::chrono::duration_cast<std::chrono::milliseconds>(
                                              std::chrono::steady_clock::now() - started)
                                              .count();

                walk->scripts = compiledColumns(compiler, expressions);

                logInfo("foobar2000 listed " + std::to_string(walk->items.get_count()) +
                        " library track(s) in " + std::to_string(milliseconds) +
                        " ms of main thread");

                answer->set(std::move(walk));
            },
            nullptr, nullptr);
    }

    void build(const std::vector<std::string>& columns) {
        library_.reportBuild({BuildPhase::listing, 0, 0});

        if (!walkAndInstall(columns))
            library_.endBuild();
    }

    bool walkAndInstall(const std::vector<std::string>& columns) {
        const WalkPtr walk = walkPlayer(columns);
        if (!walk || stopping_)
            return false;

        const size_t count = walk->items.get_count();
        library_.reportBuild({BuildPhase::ordering, 0, count});

        std::vector<TrackOrder> tracks(count);
        std::vector<std::string> paths(count);
        std::vector<fb2k::sortString_t> sortKeys(count);
        pfc::string8 relative;
        for (size_t n = 0; n < count && !stopping_; ++n) {
            const metadb_handle_ptr& item = walk->items[n];
            if (!libraryManager_->get_relative_path(item, relative))
                relative = "";

            // Keyed off the unnormalised path on purpose: the separator weighs in
            // foobar2000's comparison. See ARCHITECTURE.md, *Facts about the player*.
            sortKeys[n] = fb2k::makeSortString(relative.c_str());
            paths[n] = forwardSlashed(toStd(relative));
            tracks[n].subsong = item->get_subsong_index();
            tracks[n].canonicalPath = item->get_path();
        }

        if (stopping_)
            return false;

        const std::vector<size_t> order = ordinalOrder(tracks, [&sortKeys](size_t a, size_t b) {
            return fb2k::sortStringCompare(sortKeys[a], sortKeys[b]);
        });

        const auto ordered = std::make_shared<Ordered>();
        ordered->items.set_size(count);
        ordered->relativePaths.assign(count, std::string());
        ordered->ordinals.reserve(count);
        ordered->byRelativePath.reserve(count);

        for (size_t ordinal = 0; ordinal < count; ++ordinal) {
            const size_t track = order[ordinal];
            ordered->items[ordinal] = walk->items[track];
            ordered->relativePaths[ordinal] = std::move(paths[track]);
            ordered->ordinals.emplace(ordered->items[ordinal].get_ptr(),
                                      static_cast<uint32_t>(ordinal));
        }

        // After every path is in place, because the keys are views into that vector. Two
        // subsongs of one file share a path, and the lower ordinal is the one kept.
        for (size_t ordinal = 0; ordinal < count; ++ordinal)
            ordered->byRelativePath.emplace(ordered->relativePaths[ordinal],
                                            static_cast<uint32_t>(ordinal));

        scripts_ = walk->scripts;

        library_.reportBuild({BuildPhase::formatting, 0, count});
        LibraryBuilder builder(columns, count);
        evaluate(*ordered, builder);
        if (stopping_)
            return false;

        library_.replace(builder.finish());
        ordered->structure = library_.state().structure;
        publish(ordered);
        built_ = true;

        logInfo("built a library snapshot of " + std::to_string(count) + " track(s) and " +
                std::to_string(columns.size()) + " client column(s)");
        return true;
    }

    void evaluate(const Ordered& ordered, LibraryBuilder& builder) {
        // One compiled titleformat_object runs on many threads at once; the hook and the
        // output string are what the SDK's own parallel sorts keep per thread.
        struct Worker {
            pfc::string8 text;
            LibraryBuilder::Sink* sink = nullptr;
            std::vector<std::string> values;
        };

        // metadb_v2::queryMultiParallel has no abort_callback, so one call over the whole
        // library would make a quit wait out the rest of it. The SDK documents the call as
        // "faster if used with thousands of items", which a slice still is.
        const size_t count = ordered.items.get_count();
        for (size_t base = 0; base < count && !stopping_; base += kQuerySlice) {
            const pfc::list_partial_ref_t<metadb_handle_ptr> slice(
                ordered.items, base, std::min<size_t>(kQuerySlice, count - base));

            metadb_->queryMultiParallelEx_<Worker>(
                slice, [this, &ordered, &builder, base](size_t index, const metadb_v2::rec_t& rec,
                                                        Worker& worker) {
                    if (worker.sink == nullptr)
                        worker.sink = &builder.sink();

                    const size_t ordinal = base + index;
                    formatRow(metadb_, ordered.items[ordinal], rec, ordered.relativePaths[ordinal],
                              scripts_, worker.text, worker.values);

                    worker.sink->row(ordinal, worker.values);
                });

            library_.reportBuild(
                {BuildPhase::formatting, std::min(base + kQuerySlice, count), count});
        }
    }

    void requery(const std::vector<metadb_handle_ptr>& marks, size_t marksFromHook) {
        const OrderedPtr ordered = order();
        if (!ordered)
            return;

        metadb_handle_list items;
        std::vector<uint32_t> touched;
        std::unordered_set<uint32_t> seen;

        size_t unmatched = 0;

        for (const metadb_handle_ptr& mark : marks) {
            const auto found = ordered->ordinals.find(mark.get_ptr());
            if (found == ordered->ordinals.end()) {
                // Every mark reaching here was a library item when it was queued, per
                // Playback::retire(). A miss is counted rather than rechecked: asking
                // is_item_in_library again would repeat it off the main thread.
                ++unmatched;
                continue;
            }

            if (seen.insert(found->second).second) {
                items.add_item(mark);
                touched.push_back(found->second);
            }
        }

        if (unmatched > 0)
            logError(std::to_string(unmatched) +
                     " library track(s) changed but matched no snapshot ordinal, so either "
                     "the snapshot predates them or foobar2000 handed back a different "
                     "metadb_handle for a track it already had");

        if (items.get_count() == 0)
            return;

        std::vector<RowChange> changes(items.get_count());
        pfc::string8 text;

        metadb_->queryMulti_(items, [&](size_t index, const metadb_v2::rec_t& rec) {
            changes[index].ordinal = touched[index];
            formatRow(metadb_, items[index], rec, ordered->relativePaths[touched[index]], scripts_,
                      text, changes[index].values);
        });

        const uint64_t revision = library_.apply(changes);

        logInfo("re-queried " + std::to_string(changes.size()) + " track(s) at revision " +
                std::to_string(revision) + ", " + std::to_string(marksFromHook) +
                " of them announced by a display hook");
    }

    void publish(OrderedPtr ordered) {
        const std::lock_guard<std::mutex> lock(orderLock_);
        ordered_ = std::move(ordered);
    }

    OrderedPtr order() const {
        const std::lock_guard<std::mutex> lock(orderLock_);
        return ordered_;
    }

    MainThreadQueue& mainThread_;
    Library& library_;

    // Resolved on the main thread at construction: whether fb2k::std_api_get is safe from a
    // worker thread is undocumented. library_manager::get_relative_path is then any-thread,
    // which foobar2000 documents from v2.0 and this feed already requires. is_item_in_library
    // is not, despite the header: see ARCHITECTURE.md, *Facts about the player*. Every call
    // to it stays in Playback::retire().
    const metadb_v2::ptr metadb_;
    const library_manager::ptr libraryManager_;
    const titleformat_compiler::ptr compiler_;

    std::mutex mutex_;
    std::condition_variable wake_;
    std::atomic<bool> stopping_{false};
    std::atomic<bool> built_{false};
    RebuildQueue queue_;
    std::vector<metadb_handle_ptr> dirty_;
    size_t hookMarks_ = 0;

    const AlbumArt art_;

    std::vector<titleformat_object::ptr> scripts_;

    // Read by the worker and by every connection thread answering GET /api/artwork.
    // `Ordered::ordinals` is keyed by pointer because foobar2000 interns one metadb_handle
    // per location, which is why it hands a library callback a list "sorted by pointer value
    // for convenient matching by binary search".
    mutable std::mutex orderLock_;
    OrderedPtr ordered_;

    std::thread worker_;
};

struct LibraryFeed::Watch : library_callback_v2_dynamic_impl_base {
    explicit Watch(std::shared_ptr<State> state) : state_(std::move(state)) {}

    void on_items_added(metadb_handle_list_cref) override { state_->refreshIfBuilt(); }
    void on_items_removed(metadb_handle_list_cref) override { state_->refreshIfBuilt(); }
    void on_library_initialized() override { state_->refreshIfBuilt(); }

    void on_items_modified_v2(metadb_handle_list_cref items, metadb_io_callback_v2_data&) override {
        // `data` is a lazy view whose first get() runs queryMultiSimple over the whole list,
        // synchronously, here on the main thread. Reading one element of a fifty-thousand
        // item change pays for all fifty thousand.
        state_->markDirty(items, library_callback::is_modified_from_hook());
    }

private:
    const std::shared_ptr<State> state_;
};

struct LibraryFeed::Playback : play_callback_impl_base {
    explicit Playback(std::shared_ptr<State> state)
        : play_callback_impl_base(flag_on_playback_new_track | flag_on_playback_stop),
          state_(std::move(state)) {}

    void on_playback_new_track(metadb_handle_ptr track) override {
        retire();
        playing_ = std::move(track);
    }

    void on_playback_stop(play_control::t_stop_reason) override { retire(); }

private:
    // Unconditionally for a library item, because a play count moving is the commonest
    // change and the one a component may not announce: foo_enhanced_playcount writes a
    // local play through metadb_index_manager::set_user_data and dispatches no refresh at
    // all. is_item_in_library runs here, on the main thread this callback already owns, so
    // a stream or a file outside the library folders is never queued for the worker to ask
    // about again off it.
    void retire() {
        if (playing_.is_valid() && library_manager::get()->is_item_in_library(playing_))
            state_->markDirty(playing_);

        playing_.release();
    }

    const std::shared_ptr<State> state_;
    metadb_handle_ptr playing_;
};

LibraryFeed::LibraryFeed(MainThreadQueue& mainThread, Library& library) {
    const auto metadb = metadb_v2::tryGet();
    if (metadb.is_empty()) {
        logError(
            "this foobar2000 has no metadb_v2, so the media library API is off; "
            "it needs foobar2000 2.0 or newer");
        return;
    }

    state_ = std::make_shared<State>(mainThread, library, metadb, library_manager::get(),
                                     titleformat_compiler::get());

    playback_ = std::make_unique<Playback>(state_);

    if (library_manager_v4::tryGet().is_valid()) {
        watch_ = std::make_unique<Watch>(state_);
    } else {
        logError(
            "this foobar2000 reports no media library changes, so the snapshot goes "
            "stale until a track plays or POST /api/library/refresh is called");
    }
}

LibraryFeed::~LibraryFeed() {
    watch_.reset();
    playback_.reset();

    if (state_)
        state_->stop();
}

bool LibraryFeed::enabled() const {
    return state_ != nullptr;
}

LibraryRefresher LibraryFeed::refresher() {
    if (!state_)
        return {};

    return [state = state_](std::vector<std::string> columns, RebuildReason why) {
        state->rebuild(std::move(columns), why);
    };
}

ArtworkReader LibraryFeed::artworkReader() {
    if (!state_)
        return {};

    return [state = state_](const std::string& track) { return state->artwork(track); };
}

OrdinalResolver LibraryFeed::ordinalResolver() {
    if (!state_)
        return {};

    return [state = state_](uint64_t structure, const std::vector<uint32_t>& ordinals) {
        return state->resolveOrdinals(structure, ordinals);
    };
}

LibraryTrackResolver LibraryFeed::trackResolver() {
    if (!state_)
        return {};

    return [state = state_](const std::string& track, uint32_t subsong) {
        return state->trackAt(track, subsong);
    };
}

LibraryTrackReader LibraryFeed::trackColumnReader() {
    if (!state_)
        return {};

    return [state = state_](const std::string& track, uint32_t subsong,
                            const std::vector<std::string>& columns) {
        return state->readTrackColumns(track, subsong, columns);
    };
}

LibraryOrdinalReader LibraryFeed::ordinalTrackColumnReader() {
    if (!state_)
        return {};

    return [state = state_](const OrdinalTrackRef& at, const std::vector<std::string>& columns) {
        return state->readOrdinalColumns(at, columns);
    };
}

}  // namespace jean
