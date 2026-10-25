#include "fb2k/PCH.h"

#include "core/audience.h"
#include "core/http_server.h"
#include "core/library.h"
#include "core/log.h"
#include "core/main_thread_watch.h"
#include "core/output_hold.h"
#include "core/player_state.h"
#include "core/playlists.h"
#include "core/version.h"
#include "fb2k/artwork.h"
#include "fb2k/autoplaylists.h"
#include "fb2k/browser.h"
#include "fb2k/config_file.h"
#include "fb2k/config_watch.h"
#include "fb2k/decoder_source.h"
#include "fb2k/library.h"
#include "fb2k/main_thread.h"
#include "fb2k/paths.h"
#include "fb2k/playback_commands.h"
#include "fb2k/playback_watch.h"
#include "fb2k/player_audio_settings.h"
#include "fb2k/player_mute.h"
#include "fb2k/player_outputs.h"
#include "fb2k/playlist_edits.h"
#include "fb2k/playlist_reads.h"
#include "fb2k/playlist_watch.h"
#include "fb2k/queue.h"
#include "fb2k/running_server.h"
#include "fb2k/running_settings.h"
#include "fb2k/session_track.h"
#include "fb2k/streamer.h"
#include "fb2k/tag_writer.h"
#include "fb2k/ticket_mint.h"
#include "fb2k/ui_assets.h"

#include <chrono>
#include <memory>
#include <mutex>

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

    return std::make_unique<Streamer>(
        settings.opusBitrate, settings.aacBitrate, kPcmBufferSeconds,
        [&playerState] { playerState.timelineMarked(); }, engineCapture());
}

// The foobar2000 SDK does not say which thread delivers dsp_config_callback.
std::mutex g_playerAudioMutex;
PlayerAudioSettings* g_playerAudio = nullptr;

void publishPlayerAudio(PlayerAudioSettings* settings) {
    const std::lock_guard<std::mutex> lock(g_playerAudioMutex);
    g_playerAudio = settings;
}

// The foobar2000 SDK registers a dsp_config_callback only as a service, found at load, so it
// reaches the settings through g_playerAudio.
class ChainCallback : public dsp_config_callback {
public:
    void on_core_settings_change(const dsp_chain_config& chain) override {
        const std::lock_guard<std::mutex> lock(g_playerAudioMutex);
        if (g_playerAudio != nullptr)
            g_playerAudio->chainChanged(chain);
    }
};

service_factory_single_t<ChainCallback> g_chainCallback;

class PlayerAudioWatch : public replaygain_core_settings_notify {
public:
    explicit PlayerAudioWatch(PlayerAudioSettings& settings)
        : settings_(settings), replayGain_(replaygain_manager_v2::tryGet()) {
        publishPlayerAudio(&settings_);
        if (replayGain_.is_valid())
            replayGain_->add_notify(this);
    }

    ~PlayerAudioWatch() {
        if (replayGain_.is_valid())
            replayGain_->remove_notify(this);
        publishPlayerAudio(nullptr);
    }

    void on_changed(const t_replaygain_config& config) override {
        settings_.replayGainChanged(config);
    }

    PlayerAudioWatch(const PlayerAudioWatch&) = delete;
    PlayerAudioWatch& operator=(const PlayerAudioWatch&) = delete;

private:
    PlayerAudioSettings& settings_;
    const replaygain_manager_v2::ptr replayGain_;
};

void explainPortCollision() {
    logError("another program on this machine is already listening on that port");
    logError("change \"port\" in " + configPath() + " and restart foobar2000");
}

Player playerUsing(const Settings& settings, MainThreadQueue& mainThread,
                   MainThreadWatch& mainThreadWatch, const Streamer* streamer,
                   OutputHold& outputHold, LibraryFeed& libraryFeed, PlayerStateStore& playerState,
                   PlaylistVersions& playlistVersions, const AlbumArt& rowArt,
                   const PlayerAudioSettings& playerAudio) {
    Player player;
    player.checkMainThread = [&mainThreadWatch](std::chrono::steady_clock::time_point now) {
        return mainThreadWatch.check(now);
    };

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
    player.playlists.readRole = makePlaylistRoleReader(mainThread);
    player.playlists.readRows = makePlaylistRowReader(mainThread, playlistVersions);
    player.playlists.readChangedRows = makeChangedPlaylistRowReader(mainThread, playlistVersions);
    player.playlists.readTracks =
        makePlaylistTracksReader(mainThread, playlistVersions, libraryFeed.handleOrdinalMapper());
    player.playlists.readRowArtwork = makePlaylistRowArtworkReader(mainThread, rowArt);
    player.playlists.create =
        makePlaylistCreator(mainThread, playlistVersions, libraryFeed.ordinalResolver());
    player.playlists.rename = makePlaylistRenamer(mainThread);
    player.playlists.remove = makePlaylistRemover(mainThread);
    player.playlists.move = makePlaylistMover(mainThread);
    player.playlists.copyRows = makePlaylistRowCopier(mainThread, playlistVersions);
    player.playlists.removeRows = makePlaylistRowRemover(mainThread, playlistVersions);
    player.playlists.moveRows = makePlaylistRowMover(mainThread, playlistVersions);
    player.playlists.sortRows = makePlaylistRowSorter(mainThread, playlistVersions);
    player.playlists.fill =
        makePlaylistFiller(mainThread, libraryFeed.ordinalResolver(), playlistVersions);
    player.playlists.resolveOwn = makeOwnPlaylistResolver(mainThread, playlistVersions);
    player.playlists.emptyOwn = makeOwnPlaylistEmptier(mainThread, playlistVersions);

    player.autoPlaylists.create = makeAutoPlaylistCreator(mainThread, playlistVersions);
    player.autoPlaylists.update = makeAutoPlaylistUpdater(mainThread, playlistVersions);
    player.autoPlaylists.remove = makeAutoPlaylistRemover(mainThread);
    player.autoPlaylists.preview = makeQueryPreviewer(mainThread, libraryFeed.ordinalMatcher());

    player.queue.read = makeQueueReader(mainThread, playerState);
    player.queue.addPlaylistRows = makePlaylistRowQueuer(mainThread, playerState);
    player.queue.addLibraryTracks =
        makeLibraryTrackQueuer(mainThread, libraryFeed.ordinalResolver(), playerState);
    player.queue.moveEntry = makeMoveQueueEntry(mainThread, playerState);
    player.queue.removeEntry = makeRemoveQueueEntry(mainThread, playerState);
    player.queue.clear = makeClearQueue(mainThread);

    player.playback.playPlaylistRow =
        makePlaylistRowPlayer(mainThread, playerState, playlistVersions);
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

        player.sessions.start = [&mainThread, &settings, &playerAudio](Session& session) {
            return startSessionStream(session, mainThread, settings, kPcmBufferSeconds,
                                      playerAudio);
        };
        player.sessions.takePlaylist = makePlaylistTrackTaker(mainThread);
        player.sessions.takeLibrary = makeLibraryTrackTaker(libraryFeed.ordinalResolver());
        player.sessions.readQueue = makeSessionQueueReader();
        player.sessions.readTrack = makeSessionTrackReader(mainThread);
        player.sessions.readArtwork = makeSessionArtworkReader(rowArt);
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
          server_(
              settings_, audience_,
              playerUsing(settings_, mainThread_, mainThreadWatch_, streamer_.get(), outputHold_,
                          libraryFeed_, playerState_, playlistVersions_, rowArt_, playerAudio_),
              mintTicket, libraryFeed_.enabled() ? &library_ : nullptr, &playerState_,
              &nowPlayingArtwork_),
          status_(server_.start()),
          configWatch_(server_, settings_) {
        if (status_.listening) {
            logInfo("listening on " + settings_.bindAddress + ":" + std::to_string(settings_.port));
            if (!status_.heldAddresses.empty())
                logError(heldAddressError(status_.heldAddresses, settings_.port));
            if (status_.portIsShared)
                logInfo(sharedPortNotice(settings_.port));

            const auto browser = browserAtStart(settings_, status_.heldAddresses);
            if (!browser.logLine.empty())
                logInfo(browser.logLine);
            if (browser.url)
                openInBrowser(*browser.url);
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
    MainThreadWatch mainThreadWatch_{mainThread_};

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

    // Declared before server_ and so destroyed after it: the destructor's server_.stop() closes
    // every session, and closing one joins the decoder reading these.
    PlayerAudioSettings playerAudio_;
    PlayerAudioWatch playerAudioWatch_{playerAudio_};

    HttpServer server_;
    const ListenerStatus status_;

    ConfigWatch configWatch_;
};

class InitQuit : public initquit {
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

initquit_factory_t<InitQuit> g_initquit_jean;

}  // namespace
