Approved TKO marketing reels.

src/components/VideoShowcase.tsx groups these into CATEGORY sections (each with
a written intro, then the player) and references them by these exact filenames,
served at /videos/<name> on the root-hosted site.

Every file here is real and TKO-branded. There are NO placeholder slots: a reel
either ships or it is not listed in the component. Do not add a filename to
VideoShowcase.tsx before the .mp4 and .jpg are both in this folder.

  START HERE
    tko-whats-new.mp4     + .jpg   "What's New - the app tour"          (1:22)
    tko-platform-tour.mp4 + .jpg   "The full platform tour"             (3:31)

  THE TOURNAMENT
    tko-king.mp4          + .jpg   "TKO King - how the pit works"       (1:25)

  CLANS & IDENTITY
    tko-clan-names.mp4    + .jpg   "Clan names - claim yours"           (0:39)

  SEE IT IN ACTION
    tko-multi-angle.mp4   + .jpg   "Synchronized squad view"            (4:55)
    tko-live-director.mp4 + .jpg   "Influencer live - one AI director"  (0:58)

  ASK TKO
    tko-ask-chat.mp4      + .jpg   "The TKO chat system"                (2:12)
    tko-ask-clip.mp4      + .jpg   "Ask TKO - make me a clip"           (0:47)

.mp4 = H.264/AAC MP4 source. .jpg = poster frame shown before playback; cut it
from the reel's own branded title card (~1.5s in) so the card reads as TKO even
before anyone taps play. Players are preload="none", so nothing downloads until
a visitor actually starts one.

Masters for the three app-footage reels (whats-new / king / clan-names) live in
Desktop\TkoCam_clips as TKO_WhatsNew_1080p.mp4, TKO_King_1080p.mp4 and
TKO_ClanNames_1080p.mp4. Re-copy from there when they are re-cut.

Note: .gcloudignore normally excludes *.mp4, but has explicit negations for
public/videos/ so these ship with the Cloud Run deploy.

History: these were previously named promo-01…promo-05 with titles that no
longer matched their content (promo-01 was labelled "Every Angle" but is the
chat-system reel, etc.). Renamed to content-based slugs so the filename, the
title and the footage agree.
