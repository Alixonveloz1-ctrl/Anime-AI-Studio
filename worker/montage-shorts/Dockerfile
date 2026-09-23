FROM python:3.12.10-slim-bookworm
# Fixed Debian snapshot, not a moving apt repository.
RUN printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20250915T000000Z bookworm main\ndeb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20250915T000000Z bookworm-security main\n' > /etc/apt/sources.list \
    && rm -f /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker/montage-shorts/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY shorts /app/shorts
COPY worker/montage-shorts /app/worker/montage-shorts
COPY tests/shorts /app/tests/shorts
ENV PYTHONPATH=/app:/app/worker/montage-shorts PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN useradd --uid 10001 --create-home shorts
USER 10001
ENTRYPOINT ["python", "/app/worker/montage-shorts/runner.py"]
