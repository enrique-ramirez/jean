#include "fb2k/PCH.h"

#include "core/audience.h"
#include "core/http_server.h"
#include "core/library.h"
#include "core/log.h"
#include "core/output_hold.h"
#include "core/player_state.h"
#include "core/playlists.h"
#include "core/version.h"
#include "fb2k/artwork.h"
#include "fb2k/autoplaylists.h"
#include "fb2k/config_file.h"
#include "fb2k/config_watch.h"
#include "fb2k/library.h"
#include "fb2k/main_thread.h"
#include "fb2k/paths.h"
#include "fb2k/playback_commands.h"
#include "fb2k/playback_watch.h"
#include "fb2k/player_mute.h"
#include "fb2k/player_outputs.h"
#include "fb2k/playlist_edits.h"
#include "fb2k/playlist_reads.h"
#include "fb2k/playlist_watch.h"
#include "fb2k/queue.h"
#include "fb2k/running_server.h"
#include "fb2k/running_settings.h"
#include "fb2k/streamer.h"
#include "fb2k/tag_writer.h"
#include "fb2k/ticket_mint.h"
#include "fb2k/ui_assets.h"

#include <chrono>
#include <memory>

// Exactly one per DLL: several make foobar2000's update finder read the version as "0"
// and treat the component as permanently out of date.
DECLARE_COMPONENT_VERSION(
    jean::kComponentName, jean::kVersion,
    "Serves Jean and its HTTP API: playback, playlists, the play queue, the media "
    "library, cover art, tag writing, autoplaylists and audio streaming.\n"
    "https://github.com/enrique-ramirez/foo_jean");

VALIDATE_COMPONENT_FILENAME("foo_jean.dll");

namespace {

using namespace jean;

constexpr double kPcmBufferSeconds = 3.0;

// Built regardless of streamingEnabled, which a reload flips with no restart: routes_stream.cpp
// answers 503 while it is off rather than this never having a source to open.
std::unique_ptr<Streamer> makeStreamer(const Settings& settings, PlayerStateStore& playerState) {
    if (settings.maxConcurrentStreams == 0) {
        logInfo("maxConcurrentStreams is 0 in " + configPath() + "; streaming is switched off");
        return nullptr;
    }

    return std::make_unique<Streamer>(settings.opusBitrate, settings.aacBitrate,
                                      kPcmBufferSeconds, playerState);
}

void explainPortCollision() {
    logError("another program on this machine is already listening on that port");
    logError("change \"port\" in " + configPath() + " and restart foobar2000");
}

Player playerUsing(MainThreadQueue& mainThread, const Streamer* streamer, OutputHold& outputHold,
                   LibraryFeed& libraryFeed, PlayerStateStore& playerState,
                   const PlaylistVersions& playlistVersions, const AlbumArt& rowArt) {
    Player player;

    // Static for the life of the process, so read once here rather than on every capabilities
    // request. The foobar2000 SDK documents playback_control's volume as dB against full
    // scale, with 0 the ceiling and volume_mute the floor.
    const auto version = core_version_info_v2::get();
    player.report.name = version->get_name();
    player.report.version = version->get_version_as_text();
    player.report.volumeMin = playback_control::volume_mute;
    player.report.volumeMax = 0;
    player.report.volumeUnit = "db";

    const auto playlists = playlist_manager::get();
    for (t_size index = 0; index < playlists->playback_order_get_count(); ++index)
        player.report.playbackOrders.emplace_back(playlists->playback_order_get_name(index));

    player.playlists.list = makePlaylistLister(mainThread, playlistVersions);
    player.playlists.readRows = makePlaylistRowReader(mainThread, playlistVersions);
    player.playlists.readChangedRows = makeChangedPlaylistRowReader(mainThread, playlistVersions);
    player.playlists.readRowArtwork = makePlaylistRowArtworkReader(mainThread, rowArt);
    player.playlists.create =
        makePlaylistCreator(mainThread, playlistVersions, libraryFeed.ordinalResolver());
    player.playlists.rename = makePlaylistRenamer(mainThread);
    player.playlists.remove = makePlaylistRemover(mainThread);
    player.playlists.move = makePlaylistMover(mainThread);
    player.playlists.copyRows = makePlaylistRowCopier(mainThread, playlistVersions);
    player.playlists.removeRows = makePlaylistRowRemover(mainThread, playlistVersions);
    player.playlists.fill =
        makePlaylistFiller(mainThread, libraryFeed.ordinalResolver(), playlistVersions);
    player.playlists.resolveOwn = makeOwnPlaylistResolver(mainThread, playlistVersions);
    player.playlists.emptyOwn = makeOwnPlaylistEmptier(mainThread, playlistVersions);

    player.autoPlaylists.create = makeAutoPlaylistCreator(mainThread, playlistVersions);
    player.autoPlaylists.update = makeAutoPlaylistUpdater(mainThread, playlistVersions);
    player.autoPlaylists.remove = makeAutoPlaylistRemover(mainThread);
    player.autoPlaylists.preview = makeQueryPreviewer(mainThread);

    player.queue.read = makeQueueReader(mainThread, playerState);
    player.queue.addPlaylistRows = makePlaylistRowQueuer(mainThread, playerState);
    player.queue.addLibraryTracks =
        makeLibraryTrackQueuer(mainThread, libraryFeed.ordinalResolver(), playerState);
    player.queue.moveEntry = makeMoveQueueEntry(mainThread, playerState);
    player.queue.removeEntry = makeRemoveQueueEntry(mainThread, playerState);
    player.queue.clear = makeClearQueue(mainThread);

    player.playback.playPlaylistRow = makePlaylistRowPlayer(mainThread);
    player.playback.commandTransport = makeTransportCommander(mainThread);
    player.playback.seek = makePlaybackSeeker(mainThread);
    player.playback.setOrder = makePlaybackOrderSetter(mainThread);
    player.playback.setVolume = makeVolumeSetter(mainThread);
    player.playback.stepVolume = makeVolumeStepper(mainThread);
    player.playback.setMuted = makeMuteSetter(mainThread);
    player.playback.readPlayingTrack = playingTrackReader(mainThread);

    player.outputs = playerOutputsVia(mainThread);

    player.library.refresh = libraryFeed.refresher();
    player.library.readTrack = libraryFeed.trackColumnReader();
    player.library.readOrdinal = libraryFeed.ordinalTrackColumnReader();
    player.library.readArtwork = libraryFeed.artworkReader();
    player.library.writeTags = makeTagWriter(mainThread, libraryFeed.trackResolver(),
                                             libraryFeed.ordinalResolver(), playlistVersions);

    if (streamer != nullptr) {
        player.stream.open = streamer->opener();
        player.stream.formats = streamer->formats();
        player.stream.readTimeline = [streamer] { return streamer->timeline(); };
    }

    if (outputHold.enabled()) {
        player.stream.outputHeld = [&outputHold] { return outputHold.held(); };
        player.stream.releaseOutput = [&outputHold] { outputHold.release(); };
    }

    player.page.read = readEmbeddedPage;
    player.page.names = embeddedPageNames();
    player.page.readDisk = readWwwPage;

    return player;
}

bool shouldHoldOutput(const Settings& settings, const Streamer* streamer) {
    return settings.muteWhileStreaming && streamer != nullptr;
}

class Plugin {
public:
    Plugin()
        : settings_(loadSettings()),
          streamer_(makeStreamer(settings_, playerState_)),
          audience_(settings_.maxConcurrentStreams, std::chrono::seconds(kMuteLingerSeconds)),
          holdsOutput_(shouldHoldOutput(settings_, streamer_.get())),
          outputHold_(audience_, playerMuteVia(mainThread_), holdsOutput_),
          volumeWatch_(holdsOutput_ ? std::make_unique<PlayerVolumeWatch>(outputHold_) : nullptr),
          libraryFeed_(mainThread_, library_),
          playbackWatch_(mainThread_, playerState_, playlistVersions_, outputHold_,
                         nowPlayingArtwork_),
          outputWatch_(playerState_),
          playlistWatch_(mainThread_, playlistVersions_, playerState_),
          nowPlayingArtworkWatch_(nowPlayingArtwork_),
          server_(settings_, audience_,
                  playerUsing(mainThread_, streamer_.get(), outputHold_, libraryFeed_,
                              playerState_, playlistVersions_, rowArt_),
                  mintTicket, libraryFeed_.enabled() ? &library_ : nullptr, &playerState_,
                  &nowPlayingArtwork_),
          status_(server_.start()),
          configWatch_(server_, settings_) {
        if (status_.listening) {
            logInfo("listening on " + settings_.bindAddress + ":" + std::to_string(settings_.port));
        } else {
            logError(status_.error);
            if (status_.portInUse)
                explainPortCollision();
        }

        publishListenerStatus(status_);

        // Last, so the preferences page only ever sees a configuration this component got
        // as far as trying.
        publishRunningSettings(settings_);
    }

    ~Plugin() {
        configWatch_.stop();

        mainThread_.close();

        forgetListenerStatus();
        forgetRunningSettings();

        if (streamer_)
            streamer_->stop();
        server_.stop();
    }

private:
    const Settings settings_;
    MainThreadQueue mainThread_{foobarMainThread()};

    PlayerStateStore playerState_;
    std::unique_ptr<Streamer> streamer_;
    Audience audience_;
    const bool holdsOutput_;
    OutputHold outputHold_;
    std::unique_ptr<PlayerVolumeWatch> volumeWatch_;
    Library library_;
    LibraryFeed libraryFeed_;
    PlaylistVersions playlistVersions_;
    NowPlayingArtwork nowPlayingArtwork_;
    PlaybackWatch playbackWatch_;

    // Fires at playerState_, so it is declared after it and destroyed before it: the shutdown
    // order every watch here follows.
    OutputWatch outputWatch_;

    PlaylistWatch playlistWatch_;
    NowPlayingArtworkWatch nowPlayingArtworkWatch_;

    // Resolved separately from LibraryFeed's own, because a playlist row's handle never
    // passes through the media library snapshot.
    AlbumArt rowArt_;

    HttpServer server_;
    const ListenerStatus status_;

    ConfigWatch configWatch_;
};

class initquit_jean : public initquit {
public:
    void on_init() override {
        logInfo(std::string(kVersion) + " loaded into " +
                core_version_info::g_get_version_string());

        // A throw here would fail the player's own start.
        try {
            plugin_ = std::make_unique<Plugin>();
        } catch (const std::exception& e) {
            logError(std::string("failed to start: ") + e.what());
        }
    }

    // Not a static destructor: on_quit runs while the service system is still up, and
    // the teardown path writes files through it.
    void on_quit() override { plugin_.reset(); }

private:
    std::unique_ptr<Plugin> plugin_;
};

initquit_factory_t<initquit_jean> g_initquit_jean;

}  // namespace
