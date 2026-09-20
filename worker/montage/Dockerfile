FROM gcr.io/google.com/cloudsdktool/google-cloud-cli:slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY runner.sh /usr/local/bin/anime-studio-runner
RUN chmod +x /usr/local/bin/anime-studio-runner

ENTRYPOINT ["/usr/local/bin/anime-studio-runner"]
