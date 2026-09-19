#include "fb2k/PCH.h"

#include "core/audience.h"
#include "core/http_server.h"
#include "core/library.h"
#include "core/log.h"
#include "core/output_hold.h"
#include "core/player_state.h"
#include "core/playlists.h"
#include "core/version.h"
#include "fb2k/advertise.h"
#include "fb2k/artwork.h"
#include "fb2k/config_file.h"
#include "fb2k/library.h"
#include "fb2k/main_thread.h"
#include "fb2k/paths.h"
#include "fb2k/playback_watch.h"
#include "fb2k/player_mute.h"
#include "fb2k/playlists.h"
#include "fb2k/queue.h"
#include "fb2k/running_server.h"
#include "fb2k/running_settings.h"
#include "fb2k/streamer.h"
#include "fb2k/tag_writer.h"
#include "fb2k/token.h"

#include <chrono>
#include <memory>

// Exactly one per DLL: several make foobar2000's update finder read the version as "0"
// and treat the component as permanently out of date.
DECLARE_COMPONENT_VERSION(
    jean::kComponentName, jean::kVersion,
    "Exposes over HTTP the things beefweb does not: tag writing, autoplaylists, "
    "and audio streaming.\n"
    "https://github.com/enrique-ramirez/foo_jean");

VALIDATE_COMPONENT_FILENAME("foo_jean.dll");

namespace {

using namespace jean;

constexpr double kPcmBufferSeconds = 3.0;

std::unique_ptr<Streamer> makeStreamer(const Settings& settings) {
    if (!settings.streamingEnabled || settings.maxConcurrentStreams == 0) {
        logInfo("streaming is switched off in " + configPath());
        return nullptr;
    }

    return std::make_unique<Streamer>(settings.opusBitrate, settings.aacBitrate, kPcmBufferSeconds);
}

void explainPortCollision() {
    logError(
        "foo_jean runs alongside foo_beefweb rather than replacing it, "
        "so they need separate ports");
    logError("change \"port\" in " + configPath() + " and restart foobar2000");
}

Player playerUsing(MainThreadQueue& mainThread, const Settings& settings, const Streamer* streamer,
                   OutputHold& outputHold, LibraryFeed& libraryFeed,
                   PlayerStateStore& playerState, const PlaylistVersions& playlistVersions) {
    Player player;
    player.writeTags = makeTagWriter(mainThread);
    player.listPlaylists = makePlaylistLister(mainThread, playlistVersions);
    player.readPlaylistRows = makePlaylistRowReader(mainThread, playlistVersions);
    player.readChangedPlaylistRows =
        makeChangedPlaylistRowReader(mainThread, changedPositionsFrom(playlistVersions));
    player.playPlaylistRow = makePlaylistRowPlayer(mainThread);
    player.readQueue = makeQueueReader(mainThread, playerState);
    player.queuePlaylistRows = makePlaylistRowQueuer(mainThread, playerState);
    player.queueLibraryTracks =
        makeLibraryTrackQueuer(mainThread, libraryFeed.ordinalResolver(), playerState);
    player.moveQueueEntry = makeMoveQueueEntry(mainThread, playerState);
    player.removeQueueEntry = makeRemoveQueueEntry(mainThread, playerState);
    player.clearQueue = makeClearQueue(mainThread);
    player.createAutoPlaylist =
        makeAutoPlaylistCreator(mainThread, playlistVersions, settings.maxAutoPlaylists);
    player.updateAutoPlaylist = makeAutoPlaylistUpdater(mainThread, playlistVersions);
    player.removeAutoPlaylist = makeAutoPlaylistRemover(mainThread);
    player.ownPlaylist = makeOwnPlaylistResolver(mainThread, playlistVersions);
    player.createPlaylist =
        makePlaylistCreator(mainThread, playlistVersions, libraryFeed.ordinalResolver());
    player.renamePlaylist = makePlaylistRenamer(mainThread);
    player.removePlaylist = makePlaylistRemover(mainThread);
    player.movePlaylist = makePlaylistMover(mainThread);
    player.copyPlaylistRows = makePlaylistRowCopier(mainThread, playlistVersions);
    player.removePlaylistRows = makePlaylistRowRemover(mainThread, playlistVersions);
    player.emptyOwnPlaylist = makeOwnPlaylistEmptier(mainThread, playlistVersions);
    player.fill = makePlaylistFiller(mainThread, playlistVersions, libraryFeed.ordinalResolver());
    player.previewQuery = makeQueryPreviewer(mainThread);
    player.refreshLibrary = libraryFeed.refresher();
    player.readArtwork = libraryFeed.artworkReader();

    if (streamer != nullptr) {
        player.openStream = streamer->opener();
        player.streamFormats = streamer->formats();
        player.readTimeline = [streamer] { return streamer->timeline(); };
    }

    if (outputHold.enabled()) {
        player.outputHeld = [&outputHold] { return outputHold.held(); };
        player.releaseOutput = [&outputHold] { outputHold.release(); };
    }

    // Static for the life of the process, so read once here rather than on every capabilities
    // request. The foobar2000 SDK documents playback_control's volume as dB against full
    // scale, with 0 the ceiling and volume_mute the floor.
    const auto version = core_version_info_v2::get();
    player.playerName = version->get_name();
    player.playerVersion = version->get_version_as_text();
    player.volumeMin = playback_control::volume_mute;
    player.volumeMax = 0;
    player.volumeUnit = "db";

    const auto playlists = playlist_manager::get();
    for (t_size index = 0; index < playlists->playback_order_get_count(); ++index)
        player.playbackOrders.emplace_back(playlists->playback_order_get_name(index));

    return player;
}

bool shouldHoldOutput(const Settings& settings, const Streamer* streamer) {
    return settings.muteWhileStreaming && streamer != nullptr;
}

class Plugin {
public:
    Plugin()
        : settings_(loadSettings()),
          streamer_(makeStreamer(settings_)),
          audience_(settings_.maxConcurrentStreams, std::chrono::seconds(kMuteLingerSeconds)),
          holdsOutput_(shouldHoldOutput(settings_, streamer_.get())),
          outputHold_(audience_, playerMuteVia(mainThread_), holdsOutput_),
          volumeWatch_(holdsOutput_ ? std::make_unique<PlayerVolumeWatch>(outputHold_) : nullptr),
          libraryFeed_(mainThread_, library_),
          playbackWatch_(mainThread_, playerState_, playlistVersions_, outputHold_,
                         nowPlayingArtwork_),
          playlistWatch_(mainThread_, playlistVersions_, playerState_),
          nowPlayingArtworkWatch_(nowPlayingArtwork_),
          server_(settings_, audience_,
                  playerUsing(mainThread_, settings_, streamer_.get(), outputHold_, libraryFeed_,
                              playerState_, playlistVersions_),
                  generateToken, libraryFeed_.enabled() ? &library_ : nullptr, &playerState_,
                  &nowPlayingArtwork_),
          status_(server_.start()) {
        if (status_.listening) {
            logInfo("listening on " + settings_.bindAddress + ":" + std::to_string(settings_.port));
        } else {
            logError(status_.error);
            if (status_.portInUse)
                explainPortCollision();
        }

        writeAdvertisement(settings_, status_);

        // Last, so the preferences page only ever sees a configuration this component got
        // as far as trying.
        publishRunningSettings(settings_);

        if (status_.listening)
            publishRunningServer(&server_);
    }

    ~Plugin() {
        mainThread_.close();

        forgetRunningServer();
        forgetRunningSettings();
        removeAdvertisement();

        if (streamer_)
            streamer_->stop();
        server_.stop();
    }

private:
    const Settings settings_;
    MainThreadQueue mainThread_;

    std::unique_ptr<Streamer> streamer_;
    Audience audience_;
    const bool holdsOutput_;
    OutputHold outputHold_;
    std::unique_ptr<PlayerVolumeWatch> volumeWatch_;
    Library library_;
    LibraryFeed libraryFeed_;
    PlayerStateStore playerState_;
    PlaylistVersions playlistVersions_;
    NowPlayingArtwork nowPlayingArtwork_;
    PlaybackWatch playbackWatch_;
    PlaylistWatch playlistWatch_;
    NowPlayingArtworkWatch nowPlayingArtworkWatch_;
    HttpServer server_;
    const ListenerStatus status_;
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
