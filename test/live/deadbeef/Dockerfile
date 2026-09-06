# The second player beefweb supports, which Jean can otherwise only be reasoned about against.
# It is a container because the released beefweb plugin for DeaDBeeF is a Linux x86-64 `.so` and
# always has been -- no release has ever carried a Windows or macOS build of it -- so there is no
# way to run this pairing on a foobar2000 machine or on a mac.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        bzip2 ca-certificates curl xauth xvfb libgtk-3-0 libjpeg62-turbo libpng16-16 \
    && rm -rf /var/lib/apt/lists/*

ARG DEADBEEF=1.10.3
ARG BEEFWEB=0.10

# The static build carries its own codecs and plugins, including `nullout` -- an output needing no
# sound device, without which there is no playback state in here to assert on.
RUN curl -fsSL -o /tmp/ddb.tar.bz2 \
      "https://sourceforge.net/projects/deadbeef/files/Builds/${DEADBEEF}/linux/deadbeef-static_${DEADBEEF}-1_x86_64.tar.bz2/download" \
    && tar xjf /tmp/ddb.tar.bz2 -C /opt \
    && ln -s "/opt/deadbeef-${DEADBEEF}" /opt/deadbeef \
    && rm /tmp/ddb.tar.bz2

RUN curl -fsSL -o /tmp/beefweb.tar.gz \
      "https://github.com/hyperblast/beefweb/releases/download/v${BEEFWEB}/ddb_beefweb-${BEEFWEB}-x86_64.tar.gz" \
    && mkdir -p /root/.local/lib/deadbeef \
    && tar xzf /tmp/beefweb.tar.gz -C /root/.local/lib/deadbeef \
    && rm /tmp/beefweb.tar.gz

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Without a UTF-8 locale beefweb's artwork route fails `iconv` on any non-ascii path, which is most
# of a real library. The base image defaults to POSIX.
ENV HOME=/root LANG=C.UTF-8 LC_ALL=C.UTF-8
EXPOSE 8880
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
