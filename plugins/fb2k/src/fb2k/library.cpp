#include "fb2k/PCH.h"

#include "fb2k/library.h"

#include "core/log.h"
#include "fb2k/ask_player.h"
#include "fb2k/strings.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace jean {

namespace {

constexpr size_t kMaxPendingDirty = 4096;
constexpr size_t kQuerySlice = 8192;

// The separator library_manager::get_relative_path writes is undocumented and nothing in
// the foobar2000 SDK inspects it.
std::string forwardSlashed(std::string path) {
    std::replace(path.begin(), path.end(), '\\', '/');
    return path;
}

// Both halves are taken on the main thread: library_manager::get_all_items is main thread
// only, and titleformat_compiler::compile off it is undocumented.
struct Walk {
    metadb_handle_list items;
    std::vector<titleformat_object::ptr> scripts;
};

using WalkPtr = std::shared_ptr<Walk>;

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

    void rebuild(std::vector<std::string> columns) {
        {
            const std::lock_guard<std::mutex> lock(mutex_);

            const bool alreadyBuildingThis = building_.has_value() && *building_ == columns;
            if (alreadyBuildingThis && !rebuildWanted_)
                return;

            asked_ = std::move(columns);
            rebuildWanted_ = true;
        }

        wake_.notify_one();
    }

    void refresh() {
        {
            const std::lock_guard<std::mutex> lock(mutex_);
            rebuildWanted_ = true;
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
                rebuildWanted_ = true;
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
            std::vector<metadb_handle_ptr> marks;
            size_t marksFromHook = 0;

            {
                std::unique_lock<std::mutex> lock(mutex_);
                wake_.wait(lock, [this] { return stopping_ || rebuildWanted_ || !dirty_.empty(); });

                if (stopping_)
                    return;

                rebuilding = std::exchange(rebuildWanted_, false);

                if (asked_.has_value()) {
                    columns_ = std::move(*asked_);
                    asked_.reset();
                }

                if (rebuilding) {
                    building_ = columns_;
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

            build();

            {
                const std::lock_guard<std::mutex> lock(mutex_);
                building_.reset();
            }
        }
    }

    WalkPtr walkPlayer() {
        return askPlayer<WalkPtr>(
            mainThread_, "a media library walk",
            [api = libraryManager_, compiler = compiler_,
             expressions = columns_](const AnswerPtr<WalkPtr>& answer) {
                const auto started = std::chrono::steady_clock::now();

                auto walk = std::make_shared<Walk>();
                api->get_all_items(walk->items);

                const auto milliseconds = std::chrono::duration_cast<std::chrono::milliseconds>(
                                              std::chrono::steady_clock::now() - started)
                                              .count();

                for (const std::string& expression : expressions) {
                    titleformat_object::ptr script;
                    compiler->compile_safe_ex(script, expression.c_str(), kUnresolved);
                    walk->scripts.push_back(std::move(script));
                }

                logInfo("foobar2000 listed " + std::to_string(walk->items.get_count()) +
                        " library track(s) in " + std::to_string(milliseconds) +
                        " ms of main thread");

                answer->set(std::move(walk));
            },
            nullptr, nullptr);
    }

    void build() {
        const WalkPtr walk = walkPlayer();
        if (!walk || stopping_)
            return;

        const size_t count = walk->items.get_count();

        std::vector<TrackOrder> tracks(count);
        pfc::string8 relative;
        for (size_t n = 0; n < count && !stopping_; ++n) {
            const metadb_handle_ptr& item = walk->items[n];
            if (!libraryManager_->get_relative_path(item, relative))
                relative = "";

            tracks[n].relativePath = forwardSlashed(toStd(relative));
            tracks[n].subsong = item->get_subsong_index();
            tracks[n].canonicalPath = item->get_path();
        }

        if (stopping_)
            return;

        const std::vector<size_t> order = ordinalOrder(tracks);

        ordered_.set_size(count);
        relativePaths_.assign(count, std::string());
        ordinals_.clear();
        ordinals_.reserve(count);

        for (size_t ordinal = 0; ordinal < count; ++ordinal) {
            const size_t track = order[ordinal];
            ordered_[ordinal] = walk->items[track];
            relativePaths_[ordinal] = std::move(tracks[track].relativePath);
            ordinals_.emplace(ordered_[ordinal].get_ptr(), static_cast<uint32_t>(ordinal));
        }

        scripts_ = walk->scripts;

        LibraryBuilder builder(columns_, count);
        evaluate(builder);
        if (stopping_)
            return;

        library_.replace(builder.finish());
        built_ = true;

        logInfo("built a library snapshot of " + std::to_string(count) + " track(s) and " +
                std::to_string(columns_.size()) + " client column(s)");
    }

    void evaluate(LibraryBuilder& builder) {
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
        const size_t count = ordered_.get_count();
        for (size_t base = 0; base < count && !stopping_; base += kQuerySlice) {
            const pfc::list_partial_ref_t<metadb_handle_ptr> slice(
                ordered_, base, std::min(kQuerySlice, count - base));

            metadb_->queryMultiParallelEx_<Worker>(
                slice,
                [this, &builder, base](size_t index, const metadb_v2::rec_t& rec, Worker& worker) {
                    if (worker.sink == nullptr)
                        worker.sink = &builder.sink();

                    const size_t ordinal = base + index;
                    formatRow(metadb_, ordered_[ordinal], rec, relativePaths_[ordinal], scripts_,
                              worker.text, worker.values);

                    worker.sink->row(ordinal, worker.values);
                });
        }
    }

    void requery(const std::vector<metadb_handle_ptr>& marks, size_t marksFromHook) {
        metadb_handle_list items;
        std::vector<uint32_t> touched;
        std::unordered_set<uint32_t> seen;

        size_t unmatched = 0;

        for (const metadb_handle_ptr& mark : marks) {
            const auto found = ordinals_.find(mark.get_ptr());
            if (found == ordinals_.end()) {
                if (libraryManager_->is_item_in_library(mark))
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
            formatRow(metadb_, items[index], rec, relativePaths_[touched[index]], scripts_, text,
                      changes[index].values);
        });

        const uint64_t revision = library_.apply(changes);

        logInfo("re-queried " + std::to_string(changes.size()) + " track(s) at revision " +
                std::to_string(revision) + ", " + std::to_string(marksFromHook) +
                " of them announced by a display hook");
    }

    MainThreadQueue& mainThread_;
    Library& library_;

    // Resolved on the main thread at construction: whether fb2k::std_api_get is safe from a
    // worker thread is undocumented. library_manager::get_relative_path and
    // is_item_in_library are then any-thread, which foobar2000 documents from v2.0 and this
    // feed already requires.
    const metadb_v2::ptr metadb_;
    const library_manager::ptr libraryManager_;
    const titleformat_compiler::ptr compiler_;

    std::mutex mutex_;
    std::condition_variable wake_;
    std::atomic<bool> stopping_{false};
    std::atomic<bool> built_{false};
    bool rebuildWanted_ = false;
    std::optional<std::vector<std::string>> asked_;
    std::optional<std::vector<std::string>> building_;
    std::vector<metadb_handle_ptr> dirty_;
    size_t hookMarks_ = 0;

    std::vector<std::string> columns_;
    std::vector<titleformat_object::ptr> scripts_;
    metadb_handle_list ordered_;
    std::vector<std::string> relativePaths_;

    // Keyed by pointer because foobar2000 interns one metadb_handle per location, which is
    // why it hands a library callback a list "sorted by pointer value for convenient
    // matching by binary search". `ordered_` holds the references that keep them alive.
    std::unordered_map<const metadb_handle*, uint32_t> ordinals_;

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
    // Unconditionally, because a play count moving is the commonest change and the one a
    // component may not announce: foo_enhanced_playcount writes a local play through
    // metadb_index_manager::set_user_data and dispatches no refresh at all.
    void retire() {
        if (playing_.is_valid())
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

    return
        [state = state_](std::vector<std::string> columns) { state->rebuild(std::move(columns)); };
}

}  // namespace jean
